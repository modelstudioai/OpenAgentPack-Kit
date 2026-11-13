import { PROTOCOL_VERSION } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapClient } from "./kit.ts";

function location(options: { injected?: string; query?: string } = {}) {
	const values = new Map<string, string>();
	vi.stubGlobal("window", {
		location: {
			origin: "https://web.example.test",
			search: options.query ? `?agent=demo&api=${encodeURIComponent(options.query)}` : "?agent=demo",
		},
		__OPENAGENTPACK_KIT__: options.injected ? { apiBaseUrl: options.injected } : undefined,
		sessionStorage: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		},
	});
}

describe("体验页配置与成员认证接线", () => {
	afterEach(() => vi.unstubAllGlobals());

	// 保护宿主/查询参数/公开配置的地址优先级，并禁止认证恢复前发出匿名业务请求。
	it.each([
		{
			injected: "https://HOST.example.test:443/prefix/",
			query: "https://query.example.test",
			probe: "https://host.example.test/prefix",
			target: "https://host.example.test/prefix",
		},
		{
			query: "https://QUERY.example.test:443/prefix/",
			probe: "https://query.example.test/prefix",
			target: "https://query.example.test/prefix",
		},
		{ probe: "https://web.example.test", target: "https://api.example.test/prefix" },
	])("按完整目标地址初始化，旧配置缺少 auth 时要求成员登录：$target", async ({ injected, query, probe, target }) => {
		location({ injected, query });
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({ data: { apiBaseUrl: "https://api.example.test/prefix/", protocolVersion: PROTOCOL_VERSION } }),
			);
		const { controller, baseUrl } = await bootstrapClient(fetchImpl);
		try {
			expect(baseUrl).toBe(target);
			expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${probe}/api/config`);
			expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
			expect(controller.getSnapshot().client).toBeNull();
			await controller.start();
			expect(controller.getSnapshot()).toMatchObject({ status: "signed-out", client: null });
			expect(fetchImpl).toHaveBeenCalledTimes(1);
			expect(new URLSearchParams(window.location.search).get("agent")).toBe("demo");
		} finally {
			controller.dispose();
		}
	});

	it("服务端显式启用 anonymous 模式时保留原访客入口", async () => {
		location();
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
			Response.json({
				data: { apiBaseUrl: "", protocolVersion: PROTOCOL_VERSION, auth: { mode: "anonymous", passwordLogin: true } },
			}),
		);
		const { controller } = await bootstrapClient(fetchImpl);
		try {
			await controller.start();
			expect(controller.getSnapshot().status).toBe("anonymous");
			expect(controller.getSnapshot().client).not.toBeNull();
			expect(controller.getSnapshot().chatProvider).not.toBeNull();
			expect(fetchImpl).toHaveBeenCalledTimes(1);
		} finally {
			controller.dispose();
		}
	});

	it("公开配置协议不兼容时终止初始化，不进行登录恢复或业务请求", async () => {
		location();
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ data: { apiBaseUrl: "", protocolVersion: "1.0.0" } }));
		await expect(bootstrapClient(fetchImpl)).rejects.toThrow("协议版本不兼容");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
