import { afterEach, describe, expect, it, vi } from "vitest";
import { type MemberView, PROTOCOL_VERSION } from "../protocol/index.ts";
import { createSessionEventChatProvider } from "../providers/session-events/provider.ts";
import {
	createMemberAuthController,
	type MemberAuthController,
	type MemberAuthOptions,
	type StoredMemberSession,
} from "./member-auth.ts";

const controllers: MemberAuthController[] = [];
afterEach(() => {
	for (const controller of controllers.splice(0)) controller.dispose();
	vi.useRealTimers();
});
const member = (username: string): MemberView => ({
	member_id: `member_${username}`,
	username,
	display_name: username,
	auth_type: "local",
	status: "active",
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
});
const json = (data: unknown) => Response.json({ data });
const unauthorized = () =>
	Response.json({ error: { code: "unauthorized", message: "用户名或密码错误", retryable: false } }, { status: 401 });

function setup() {
	let stored: StoredMemberSession | null = null;
	let expiresAt = new Date(Date.now() + 3_600_000).toISOString();
	let logoutFails = false;
	let meFails = false;
	const revoked = new Set<string>();
	const requests: { path: string; authorization: string | null; signal?: AbortSignal | null }[] = [];
	const storage = {
		load: () => stored,
		save: (value: StoredMemberSession | null) => {
			stored = value;
		},
	};
	let override: ((url: URL, init: RequestInit) => Promise<Response> | undefined) | undefined;
	const loginResponse = (init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		if (body.password !== "Correct!123") return unauthorized();
		const token = `kit_member_${body.username}_${requests.length}`;
		return json({ access_token: token, token_type: "Bearer", expires_at: expiresAt, member: member(body.username) });
	};
	const meResponse = (auth: string) => {
		if (meFails) throw new TypeError("offline");
		const username = auth.split("_")[2] as string;
		return json({ identity: { subjectId: `member_${username}` }, member: member(username), expires_at: expiresAt });
	};
	const logoutResponse = (auth: string | null) => {
		if (logoutFails) throw new TypeError("offline");
		revoked.add(auth ?? "");
		return new Response(null, { status: 204 });
	};
	const fetchImpl: typeof fetch = async (input, init = {}) => {
		const url = new URL(String(input));
		const headers = new Headers(init.headers);
		const auth = headers.get("authorization");
		requests.push({ path: url.pathname + url.search, authorization: auth, signal: init.signal });
		const custom = override?.(url, init);
		if (custom) return custom;
		if (url.pathname.endsWith("/login")) return loginResponse(init);
		if (url.pathname.endsWith("/logout")) return logoutResponse(auth);
		if (!auth || revoked.has(auth)) return unauthorized();
		if (url.pathname.endsWith("/me")) return meResponse(auth);
		if (url.pathname.endsWith("/download")) {
			expect(headers.get("x-kit-protocol-version")).toBe(PROTOCOL_VERSION);
			return new Response("file body");
		}
		return json([]);
	};
	const create = (createChatProvider?: MemberAuthOptions["createChatProvider"]) => {
		const controller = createMemberAuthController({
			baseUrl: "https://backend.example/prefix",
			mode: "member",
			storage,
			fetchImpl,
			createChatProvider,
		});
		controllers.push(controller);
		return controller;
	};
	return {
		create,
		storage,
		requests,
		revoked,
		setOverride: (handler: typeof override) => {
			override = handler;
		},
		setLogoutFails: (value: boolean) => {
			logoutFails = value;
		},
		setMeFails: (value: boolean) => {
			meFails = value;
		},
		setExpiry: (value: string) => {
			expiresAt = value;
		},
	};
}
const login = (controller: MemberAuthController, username = "alice") =>
	controller.login({ username, password: "Correct!123" });

describe("本地成员认证生命周期", () => {
	// 保护示例 Provider 的身份隔离：它必须复用当前登录的取消和鉴权边界。
	it("公开请求配置构造的 Provider 随身份失效，旧实例不能借用新账号", async () => {
		const fixture = setup();
		const createProvider = vi.fn<NonNullable<MemberAuthOptions["createChatProvider"]>>((request) =>
			createSessionEventChatProvider({
				request,
				stream: { buildRequest: () => ({ path: "/business/stream" }) },
				sendMessage: {
					buildRequest: ({ body }) => ({
						path: "/business/send",
						init: { method: "POST", body: JSON.stringify(body) },
					}),
					mapResponse: async (response) => (await response.json()).data,
				},
				interrupt: {
					buildRequest: () => ({ path: "/business/stop", init: { method: "POST" } }),
					mapResponse: async (response) => (await response.json()).data,
				},
				toolApprovals: {
					buildRequest: () => ({ path: "/business/approvals" }),
					mapResponse: async (response) => (await response.json()).data,
				},
				submitToolApproval: {
					buildRequest: ({ decision }) => ({
						path: "/business/approvals",
						init: { method: "POST", body: JSON.stringify(decision) },
					}),
					mapResponse: async (response) => (await response.json()).data,
				},
			}),
		);
		fixture.setOverride((url) => {
			if (url.pathname.endsWith("/business/send"))
				return Promise.resolve(json({ session_id: "s", accepted: true, event_ids: ["sent"] }));
			if (url.pathname.endsWith("/business/stream"))
				return Promise.resolve(
					new Response('event: error\ndata: {"code":"unauthorized","message":"expired","retryable":false}\n\n', {
						headers: { "Content-Type": "text/event-stream" },
					}),
				);
			return undefined;
		});
		const controller = fixture.create(createProvider);
		await login(controller);
		const old = controller.getSnapshot().chatProvider!;
		const firstToken = fixture.storage.load()!.access_token;
		await old.sendMessage("s", { text: "hello" });
		expect(fixture.requests.at(-1)?.authorization).toBe(`Bearer ${firstToken}`);
		expect(createProvider).toHaveBeenCalledOnce();
		await controller.logout();
		await login(controller, "bob");
		const before = fixture.requests.length;
		await expect(old.sendMessage("s", { text: "late" })).rejects.toBeDefined();
		expect(fixture.requests).toHaveLength(before);
		const current = controller.getSnapshot().chatProvider!;
		expect(current).not.toBe(old);
		await expect(current.stream("s")).rejects.toMatchObject({ code: "unauthorized" });
		expect(controller.getSnapshot()).toMatchObject({ status: "signed-out", client: null, chatProvider: null });
		expect(fixture.storage.load()).toBeNull();
	});

	it("登录后按后端恢复，下载携带认证与会话证据，退出撤销并永久停止旧client", async () => {
		const fixture = setup();
		const first = fixture.create();
		await first.start();
		expect(first.getSnapshot().status).toBe("signed-out");
		await login(first);
		const token = fixture.storage.load()?.access_token;
		expect(first.getSnapshot().member?.member_id).toBe("member_alice");
		expect(JSON.stringify(fixture.storage.load())).not.toContain("Correct!123");
		first.dispose();
		const restored = fixture.create();
		await restored.start();
		expect(restored.getSnapshot().status).toBe("signed-in");
		const client = restored.getSnapshot().client!;
		expect(await (await client.downloadFile("file 1", { sessionId: "session-1" })).text()).toBe("file body");
		expect(fixture.requests.at(-1)).toMatchObject({
			path: "/prefix/api/kit/files/file%201/download?session_id=session-1",
			authorization: `Bearer ${token}`,
		});
		await restored.logout();
		expect(fixture.revoked.has(`Bearer ${token}`)).toBe(true);
		expect(fixture.storage.load()).toBeNull();
		expect(restored.getSnapshot().client).toBeNull();
		const count = fixture.requests.length;
		await expect(client.agents()).rejects.toThrow();
		expect(fixture.requests).toHaveLength(count);
	});

	it("切换成员后旧请求迟到的401不能踢出新成员，延迟上传也不能借用新token", async () => {
		const fixture = setup();
		const controller = fixture.create();
		await controller.start();
		await login(controller);
		const old = controller.getSnapshot().client!;
		let release!: (response: Response) => void;
		fixture.setOverride((url) =>
			url.pathname.endsWith("/plaza")
				? new Promise((resolve) => {
						release = resolve;
					})
				: undefined,
		);
		const pending = old.plaza().catch((error: unknown) => error);
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		await controller.logout();
		await login(controller, "bob");
		release(unauthorized());
		await pending;
		expect(controller.getSnapshot()).toMatchObject({ status: "signed-in", member: { member_id: "member_bob" } });
		const count = fixture.requests.length;
		await expect(old.uploadFile({ name: "old.txt", bytes: new Uint8Array([1]) })).rejects.toThrow();
		expect(fixture.requests).toHaveLength(count);
		await controller.getSnapshot().client!.agents();
		expect(fixture.requests.at(-1)?.authorization).toContain("kit_member_bob_");
	});

	it("自定义fetch忽略取消时，退出仍关闭已返回响应头的下载和SSE正文", async () => {
		const fixture = setup();
		const controller = fixture.create();
		await login(controller);
		const client = controller.getSnapshot().client!;
		const cancelled: string[] = [];
		fixture.setOverride((url) => {
			if (!url.pathname.endsWith("/download") && !url.pathname.endsWith("/stream")) return undefined;
			const body = new ReadableStream<Uint8Array>({
				cancel: () => {
					cancelled.push(url.pathname);
				},
			});
			return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
		});
		const file = await client.downloadFile("file-alice");
		const reading = file.text().then(
			() => "completed",
			() => "cancelled",
		);
		const stream = client.stream("session-alice").then(
			() => "completed",
			() => "cancelled",
		);
		await vi.waitFor(() => expect(fixture.requests.at(-1)?.path.endsWith("/stream")).toBe(true));
		expect(cancelled).toHaveLength(0);
		await controller.logout();
		expect(await Promise.all([reading, stream])).toEqual(["cancelled", "cancelled"]);
		expect(cancelled).toHaveLength(2);
		expect(controller.getSnapshot().client).toBeNull();
	});

	it.each(["logout", "dispose"] as const)(
		"自定义fetch忽略取消时，%s在响应头返回前结束旧请求并关闭迟到响应",
		async (action) => {
			const fixture = setup();
			const controller = fixture.create();
			await login(controller);
			const client = controller.getSnapshot().client!;
			let release!: (response: Response) => void;
			fixture.setOverride((url) =>
				url.pathname.endsWith("/agents")
					? new Promise((resolve) => {
							release = resolve;
						})
					: undefined,
			);
			let rejection: unknown;
			const pending = client.agents().catch((error: unknown) => {
				rejection = error;
			});
			await vi.waitFor(() => expect(release).toBeTypeOf("function"));
			await controller[action]();
			// 先证明不依赖自定义 fetch 返回即可结束，再交付迟到响应检验资源释放。
			await vi.waitFor(() => expect(rejection).toMatchObject({ name: "AbortError" }));
			await pending;
			const cancel = vi.fn();
			release(new Response(new ReadableStream({ cancel })));
			await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
			if (action === "logout") {
				expect(controller.getSnapshot().status).toBe("signed-out");
				expect(fixture.revoked.size).toBe(1);
			}
		},
	);

	it("错密码不进入业务，额度403保留身份，SSE撤销控制帧使身份失效", async () => {
		const fixture = setup();
		const controller = fixture.create();
		await controller.start();
		await expect(controller.login({ username: "alice", password: "wrong" })).rejects.toMatchObject({
			code: "unauthorized",
		});
		expect(controller.getSnapshot().client).toBeNull();
		await login(controller);
		fixture.setOverride((url) => {
			if (url.pathname.endsWith("/quota"))
				return Promise.resolve(
					Response.json({ error: { code: "quota_exceeded", message: "额度不足", retryable: false } }, { status: 403 }),
				);
			if (url.pathname.endsWith("/stream"))
				return Promise.resolve(
					new Response('event: error\ndata: {"code":"unauthorized","message":"已退出","retryable":false}\n\n', {
						headers: { "content-type": "text/event-stream" },
					}),
				);
			return undefined;
		});
		await expect(controller.getSnapshot().client!.quota()).rejects.toMatchObject({ code: "quota_exceeded" });
		expect(controller.getSnapshot().status).toBe("signed-in");
		await expect(controller.getSnapshot().client!.stream("session-1")).rejects.toMatchObject({ code: "unauthorized" });
		expect(controller.getSnapshot().status).toBe("signed-out");
		expect(fixture.storage.load()).toBeNull();
		fixture.setOverride(undefined);
		await login(controller);
		fixture.revoked.add(`Bearer ${fixture.storage.load()?.access_token}`);
		await expect(controller.getSnapshot().client!.agents()).rejects.toThrow();
		expect(controller.getSnapshot().status).toBe("signed-out");
	});

	it("恢复网络错误不会回退访客，重试可恢复；退出失败立即锁定且可重试撤销", async () => {
		const fixture = setup();
		const first = fixture.create();
		await login(first);
		first.dispose();
		fixture.setMeFails(true);
		const restored = fixture.create();
		await restored.start();
		expect(restored.getSnapshot()).toMatchObject({ status: "error", client: null });
		fixture.setMeFails(false);
		await restored.retry();
		expect(restored.getSnapshot().status).toBe("signed-in");
		fixture.setLogoutFails(true);
		await restored.logout();
		expect(restored.getSnapshot()).toMatchObject({ status: "error", client: null });
		expect(fixture.storage.load()).toBeNull();
		fixture.setLogoutFails(false);
		await restored.retry();
		expect(restored.getSnapshot().status).toBe("signed-out");
	});

	it("到期自动停止客户端；不能持久化新token时撤销并拒绝进入业务", async () => {
		vi.useFakeTimers();
		const fixture = setup();
		fixture.setExpiry(new Date(Date.now() + 1000).toISOString());
		const controller = fixture.create();
		await login(controller);
		await vi.advanceTimersByTimeAsync(1001);
		expect(controller.getSnapshot().status).toBe("signed-out");
		expect(fixture.storage.load()).toBeNull();
		fixture.setExpiry(new Date(Date.now() + 3600_000).toISOString());
		fixture.storage.save = () => {
			throw new Error("storage blocked");
		};
		await expect(login(controller)).rejects.toThrow("无法保存登录状态");
		expect(controller.getSnapshot().client).toBeNull();
		expect(fixture.revoked.size).toBe(1);
	});
});
