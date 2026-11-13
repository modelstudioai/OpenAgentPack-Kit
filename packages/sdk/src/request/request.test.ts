import { describe, expect, it, vi } from "vitest";
import { createRequest } from "./index.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function pendingBody() {
	const cancel = vi.fn();
	const body = new ReadableStream<Uint8Array>({ cancel });
	return { body, cancel };
}

describe("standalone HTTP request", () => {
	it("保留 URL 前缀，逐请求读取动态鉴权；单次 headers 优先且不注入 Kit 头", async () => {
		let token = "first";
		const calls: { url: string; headers: Headers; method?: string }[] = [];
		const request = createRequest({
			baseUrl: "https://backend.test/prefix///",
			headers: async () => ({ authorization: token, "x-default": "yes" }),
			fetchImpl: async (url, init) => {
				calls.push({ url: String(url), headers: new Headers(init?.headers), method: init?.method });
				return calls.length === 1 ? Response.json({ ok: true }) : new Response(null, { status: 204 });
			},
		});
		await expect(
			request.json("/first", { method: "POST", headers: new Headers({ authorization: "once" }) }),
		).resolves.toEqual({ ok: true });
		token = "second";
		await expect(request.json("second")).resolves.toBeUndefined();
		expect(calls.map(({ url }) => url)).toEqual([
			"https://backend.test/prefix/first",
			"https://backend.test/prefix/second",
		]);
		expect(calls.map(({ headers }) => headers.get("authorization"))).toEqual(["once", "second"]);
		expect(calls[0]?.headers.get("x-default")).toBe("yes");
		expect(calls[0]?.headers.has("x-kit-protocol-version")).toBe(false);
		expect(calls[0]?.method).toBe("POST");
	});

	it("默认 HTTP 错误只含安全状态，不解析正文或重试写入", async () => {
		const { body, cancel } = pendingBody();
		const fetchImpl = vi.fn(async () => new Response(body, { status: 503, statusText: "sensitive" }));
		const request = createRequest({ baseUrl: "/backend", fetchImpl });
		await expect(request.json("/send", { method: "POST" })).rejects.toMatchObject({
			code: "provider_error",
			message: "HTTP 503",
			status: 503,
			retryable: true,
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("自定义 HTTP 映射可读取响应 envelope，成功 response 的 body 交给调用方", async () => {
		const failure = new Error("mapped");
		const request = createRequest({
			baseUrl: "/api",
			fetchImpl: async (url) =>
				String(url).endsWith("/fail")
					? Response.json({ error: "custom" }, { status: 409 })
					: Response.json({ ok: true }),
			mapHttpError: async (response) => {
				expect(await response.json()).toEqual({ error: "custom" });
				return failure;
			},
		});
		await expect(request.json("/fail")).rejects.toBe(failure);
		const response = await request.response("/success");
		expect(await response.json()).toEqual({ ok: true });
	});

	it("取消异步鉴权时不调用 fetch，取消后迟到的 Response 被关闭", async () => {
		const headers = deferred<HeadersInit>();
		const fetchImpl = vi.fn(async () => Response.json({}));
		const abort = new AbortController();
		const request = createRequest({ baseUrl: "/api", headers: () => headers.promise, fetchImpl });
		const response = request.response("/send", { signal: abort.signal });
		abort.abort();
		await expect(response).rejects.toMatchObject({ name: "AbortError" });
		headers.resolve({});
		await tick();
		expect(fetchImpl).not.toHaveBeenCalled();

		const late = deferred<Response>();
		const fetched = vi.fn(() => late.promise);
		const secondAbort = new AbortController();
		const second = createRequest({ baseUrl: "/api", fetchImpl: fetched }).response("/send", {
			signal: secondAbort.signal,
		});
		await vi.waitFor(() => expect(fetched).toHaveBeenCalledOnce());
		secondAbort.abort();
		await expect(second).rejects.toMatchObject({ name: "AbortError" });
		const { body, cancel } = pendingBody();
		late.resolve(new Response(body));
		await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
	});

	it("自定义 fetch 忽略 signal 时，JSON 读取仍可取消并释放 reader", async () => {
		const { body, cancel } = pendingBody();
		const request = createRequest({ baseUrl: "/api", fetchImpl: async () => new Response(body) });
		const abort = new AbortController();
		const result = request.json("/json", { signal: abort.signal });
		await vi.waitFor(() => expect(body.locked).toBe(true));
		abort.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
	});

	it("HTTP 错误映射读取挂起的 body 时，取消同时终止映射并释放底层锁", async () => {
		const { body, cancel } = pendingBody();
		const reading = vi.fn(async (response: Response) => {
			await response.json();
			return new Error("unreachable");
		});
		const request = createRequest({
			baseUrl: "/api",
			fetchImpl: async () => new Response(body, { status: 500 }),
			mapHttpError: reading,
		});
		const abort = new AbortController();
		const result = request.response("/fail", { signal: abort.signal });
		await vi.waitFor(() => expect(reading).toHaveBeenCalledOnce());
		abort.abort();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(body.locked).toBe(false));
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("fetch 刚完成时的取消不会返回成功响应", async () => {
		const fetched = deferred<Response>();
		const started = vi.fn(() => fetched.promise);
		const abort = new AbortController();
		const result = createRequest({ baseUrl: "/api", fetchImpl: started }).response("/race", { signal: abort.signal });
		await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
		void fetched.promise.then(() => abort.abort());
		const { body, cancel } = pendingBody();
		fetched.resolve(new Response(body));
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("JSON 按 UTF-8 分片读取；非法 JSON 失败不掩盖解析错误", async () => {
		const bytes = new TextEncoder().encode('{"text":"你好"}');
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
				controller.close();
			},
		});
		const request = createRequest({ baseUrl: "/api", fetchImpl: async () => new Response(body) });
		await expect(request.json("/json")).resolves.toEqual({ text: "你好" });
		expect(body.locked).toBe(false);
		await expect(
			createRequest({ baseUrl: "/api", fetchImpl: async () => new Response("invalid") }).json("/json"),
		).rejects.toBeInstanceOf(SyntaxError);
	});

	it.each(["request", "stream"] as const)("stream 使用 %s 的 signal，提前结束不重连或重试", async (source) => {
		const { body, cancel } = pendingBody();
		const fetchImpl = vi.fn(async () => new Response(body));
		const request = createRequest({ baseUrl: "/api", fetchImpl });
		const abort = new AbortController();
		const other = new AbortController();
		const stream = request.stream(
			"/events",
			{ signal: source === "request" ? abort.signal : other.signal },
			{ signal: source === "stream" ? abort.signal : other.signal },
		);
		const next = stream.next();
		await vi.waitFor(() => expect(body.locked).toBe(true));
		abort.abort();
		await expect(next).rejects.toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
		expect(fetchImpl).toHaveBeenCalledOnce();
	});
});
