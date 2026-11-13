import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, expect, it } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const agentId = "agent_selected";
const gateway = () =>
	createSdkGateway({ apiKey: "sk-test-private-key", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
const session = (id: string, agent = agentId) => ({
	id,
	agent: { id: agent, version: 1 },
	status: "idle",
	environment_id: "env_shared",
	vault_ids: ["vault_shared"],
	resources: [
		{
			type: "memory_store",
			memory_store_id: "memory_shared",
			access: "read_only",
			instructions: "private instructions",
		},
		{
			type: "github_repository",
			url: "https://user:private-pass@github.com/example/repo?token=private-token#main",
			authorization_token: "private-github-token",
		},
	],
	created_at: "2026-11-09T02:00:00Z",
	updated_at: "2026-11-09T02:00:00Z",
	environment_variables: { API_KEY: "sk-test-private-key" },
	metadata: { private: "do-not-return" },
});

afterEach(() => setDefaultFetch(fetch));

// 保护 Agent → 全量会话 → 全量挂载的 Provider 合同，及只读引用投影；不复测 hooks 映射。
it("遍历两层游标并去重，保留第 100 条后的会话和资源；不读取事件或返回凭据", async () => {
	const calls: URL[] = [];
	const sessions = Array.from({ length: 101 }, (_, index) => session(`session_${index}`));
	const runtimePage = (url: URL) => {
		if (!url.pathname.includes("/session_100/")) return Response.json({ data: [], next_page: null });
		const files = Array.from({ length: 101 }, (_, index) => ({
			id: `resource_${index}`,
			type: "file",
			file_id: `file_${index}`,
			mount_path: `/mnt/session/uploads/${index}.txt`,
			attributes: { secret: "sk-test-private-key" },
		}));
		if (url.searchParams.get("page")) {
			expect(url.searchParams.get("page")).toBe("resources+next/=");
			return Response.json({
				data: [...files.slice(99), { type: "memory_store", memory_store_id: "memory_shared", access: "read_only" }],
				next_page: null,
			});
		}
		return Response.json({ data: files.slice(0, 100), next_page: "resources+next/=" });
	};
	setDefaultFetch(async (input, init) => {
		const url = new URL(String(input));
		calls.push(url);
		expect(init?.method ?? "GET").toBe("GET");
		if (url.pathname.endsWith(`/agents/${agentId}`)) return Response.json({ id: agentId, name: "Selected" });
		if (url.pathname.endsWith("/sessions")) {
			expect(url.searchParams.get("agent_id")).toBe(agentId);
			expect(url.searchParams.get("limit")).toBe("100");
			return Response.json(
				url.searchParams.get("page")
					? { data: sessions.slice(99), next_page: null }
					: { data: sessions.slice(0, 100), next_page: "sessions+next/=" },
			);
		}
		if (url.pathname.endsWith("/resources")) return runtimePage(url);
		const id = url.pathname.split("/").at(-1)!;
		if (/^session_\d+$/.test(id)) return Response.json(session(id));
		throw new Error(`Unexpected endpoint ${url.pathname}`);
	});
	const result = await gateway().getPresetPackAgentResources(agentId);
	expect(result.complete).toBe(true);
	expect(result.sessions).toHaveLength(101);
	const last = result.sessions.at(-1)!;
	expect(last.session_id).toBe("session_100");
	expect(last.resources.filter((resource) => resource.type === "file")).toHaveLength(101);
	expect(last.resources).toContainEqual(expect.objectContaining({ type: "environment", environment_id: "env_shared" }));
	expect(last.resources).toContainEqual(expect.objectContaining({ type: "vault", vault_id: "vault_shared" }));
	expect(last.resources.filter((resource) => resource.memory_store_id === "memory_shared")).toEqual([
		expect.objectContaining({ access: "read_only", sources: ["session", "runtime"] }),
	]);
	expect(last.resources).toContainEqual(
		expect.objectContaining({ type: "github_repository", repository_url: "https://github.com/example/repo" }),
	);
	expect(JSON.stringify(result)).not.toMatch(
		/sk-test-private-key|private instructions|do-not-return|environment_variables|attributes|private-pass|private-token|private-github-token/,
	);
	expect(calls.filter((url) => url.pathname.endsWith("/sessions")).map((url) => url.searchParams.get("page"))).toEqual([
		null,
		"sessions+next/=",
	]);
});

it("单个会话资源读取失败保留其余成功结果，明确 complete=false，不回显上游错误", async () => {
	setDefaultFetch(async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith(`/agents/${agentId}`)) return Response.json({ id: agentId });
		if (url.pathname.endsWith("/sessions"))
			return Response.json({ data: [session("session_ok"), session("session_failed")], next_page: null });
		if (url.pathname.endsWith("/resources")) {
			if (url.pathname.includes("/session_failed/"))
				return Response.json({ error: { message: "sk-test-private-key private provider failure" } }, { status: 403 });
			return Response.json({ data: [{ id: "resource_ok", type: "file", file_id: "file_ok" }], next_page: null });
		}
		return Response.json(session(url.pathname.split("/").at(-1)!));
	});
	const result = await gateway().getPresetPackAgentResources(agentId);
	expect(result.complete).toBe(false);
	expect(result.sessions[0]?.resource_error).toBeUndefined();
	expect(result.sessions[0]?.resources).toContainEqual(expect.objectContaining({ file_id: "file_ok" }));
	expect(result.sessions[1]?.resource_error).toBeTruthy();
	expect(result.sessions[1]?.resources).toContainEqual(expect.objectContaining({ environment_id: "env_shared" }));
	expect(JSON.stringify(result)).not.toMatch(/sk-test-private-key|private provider failure/);
});

it("同一会话同一记忆库的不同权限均保留，供导入时拒绝冲突；相同权限合并来源", async () => {
	setDefaultFetch(async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith(`/agents/${agentId}`)) return Response.json({ id: agentId });
		if (url.pathname.endsWith("/sessions")) return Response.json({ data: [session("session_one")], next_page: null });
		if (url.pathname.endsWith("/resources"))
			return Response.json({
				data: ["read_only", "read_write"].map((access) => ({
					type: "memory_store",
					memory_store_id: "memory_shared",
					access,
				})),
				next_page: null,
			});
		return Response.json(session("session_one"));
	});
	const result = await gateway().getPresetPackAgentResources(agentId);
	expect(result.complete).toBe(true);
	expect(result.sessions[0]?.resources.filter((resource) => resource.memory_store_id === "memory_shared")).toEqual([
		{ type: "memory_store", memory_store_id: "memory_shared", access: "read_only", sources: ["session", "runtime"] },
		{ type: "memory_store", memory_store_id: "memory_shared", access: "read_write", sources: ["runtime"] },
	]);
});

it("会话游标循环拒绝交付截断列表，异常 Agent 绑定不触发资源查询", async () => {
	for (const mode of ["cycle", "foreign"] as const) {
		const calls: string[] = [];
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			calls.push(url.pathname);
			if (url.pathname.endsWith(`/agents/${agentId}`)) return Response.json({ id: agentId });
			return Response.json({
				data: [session("session_one", mode === "foreign" ? "agent_other" : agentId)],
				next_page: mode === "cycle" ? "repeated" : null,
			});
		});
		await expect(gateway().getPresetPackAgentResources(agentId)).rejects.toMatchObject({ code: "provider_error" });
		expect(calls.every((path) => path.endsWith("/sessions") || path.endsWith(`/agents/${agentId}`))).toBe(true);
	}
});

it("运行时分页异常保留已读资源并标记不完整；详情归属改变时不请求资源", async () => {
	for (const mode of ["missing", "cycle", "http-error", "foreign"] as const) {
		let resourceCalls = 0;
		const nextToken = mode === "cycle" ? "repeated" : mode === "http-error" ? "next" : null;
		const detailAgent = mode === "foreign" ? "agent_other" : agentId;
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			if (url.pathname.endsWith(`/agents/${agentId}`)) return Response.json({ id: agentId });
			if (url.pathname.endsWith("/sessions")) return Response.json({ data: [session("session_one")], next_page: null });
			if (url.pathname.endsWith("/resources")) {
				resourceCalls++;
				if (mode === "http-error" && resourceCalls > 1)
					return Response.json({ error: { message: "private provider failure" } }, { status: 403 });
				return Response.json({
					data: [{ id: "resource_partial", type: "file", file_id: "file_partial" }],
					has_more: true,
					next_page: nextToken,
				});
			}
			return Response.json(session("session_one", detailAgent));
		});
		const result = await gateway().getPresetPackAgentResources(agentId);
		expect(result.complete).toBe(false);
		expect(result.sessions[0]?.resource_error).toBeTruthy();
		expect(resourceCalls).toBe(mode === "foreign" ? 0 : mode === "missing" ? 1 : 2);
		expect(result.sessions[0]?.resources.filter((resource) => resource.file_id === "file_partial")).toHaveLength(
			mode === "foreign" ? 0 : 1,
		);
	}
});

it("取消查询后不继续读取后续会话或资源；非法 Agent ID 不触发网络", async () => {
	const controller = new AbortController();
	let calls = 0;
	setDefaultFetch(async (input) => {
		calls++;
		if (String(input).includes(`/agents/${agentId}`)) return Response.json({ id: agentId });
		controller.abort();
		return Response.json({ data: [session("session_one")], next_page: "more" });
	});
	await expect(gateway().getPresetPackAgentResources(agentId, controller.signal)).rejects.toMatchObject({
		name: "AbortError",
	});
	expect(calls).toBe(2);
	await expect(gateway().getPresetPackAgentResources("../agent")).rejects.toMatchObject({ code: "invalid_request" });
	expect(calls).toBe(2);
});
