import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogAgentView, PlanResponse } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

function makeApp() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-test-"));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
		KIT_CORS_ORIGINS: "http://localhost:5173",
	});
	const services = createKitServices(config, openDatabase(dataDir));
	return { app: createApp(services), services };
}

const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };

it("智能体版本注册到控制面：已存在历史版本可读，未认证或非法 ID 被拒", async () => {
	const { app, services } = makeApp();
	const path = "/api/admin/remote/agents/agent_mock_designer/versions";
	const headers = { authorization: "Bearer admin-token" };
	const response = await app.request(path, { headers });
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ data: [{ version: 3 }, { version: 2 }, { version: 1 }] });
	services.config.adminPrincipals.push({ token: "version-auditor", role: "auditor" });
	expect((await app.request(path, { headers: { authorization: "Bearer version-auditor" } })).status).toBe(200);
	expect((await app.request(path)).status).toBe(401);
	expect((await app.request("/api/admin/remote/agents/invalid%3Fid/versions", { headers })).status).toBe(400);
	const detail = await app.request(`${path}/1`, { headers });
	expect(detail.status).toBe(200);
	expect(await detail.json()).toMatchObject({
		data: {
			agent_id: "agent_mock_designer",
			version: 1,
			configuration: { model: "qwen-mock-v1", instructions: "这是 designer 的 v1 版本指令。" },
		},
	});
	expect((await app.request(`${path}/1`, { headers: { authorization: "Bearer version-auditor" } })).status).toBe(200);
	expect((await app.request(`${path}/1`)).status).toBe(401);
	for (const version of ["0", "1.5", "latest"]) {
		expect((await app.request(`${path}/${version}`, { headers })).status).toBe(400);
	}
	expect((await app.request(`${path}/4`, { headers })).status).toBe(404);
	expect((await app.request("/api/admin/remote/agents/invalid%3Fid/versions/1", { headers })).status).toBe(400);
});

it("模版保存和列表注册到控制面：管理员可保存读取，未认证不可访问", async () => {
	const { app } = makeApp();
	const headers = { ...json, authorization: "Bearer admin-token" };
	const saved = await app.request("/api/admin/templates", {
		method: "POST",
		headers,
		body: JSON.stringify({
			name: "路由验证模版",
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			remote_environment_id: "env_mock_default",
		}),
	});
	expect(saved.status).toBe(201);
	const { data: template } = (await saved.json()) as { data: { template_id: string } };
	const path = `/api/admin/templates/${template.template_id}`;
	expect((await app.request(path, { headers })).status).toBe(200);
	for (const versionPath of [`${path}/versions`, `${path}/versions/1`]) {
		expect((await app.request(versionPath, { headers })).status).toBe(200);
		expect((await app.request(versionPath)).status).toBe(401);
	}
	expect(await (await app.request("/api/admin/templates", { headers })).json()).toMatchObject({
		data: [{ template_id: template.template_id }],
	});
	expect((await app.request(path)).status).toBe(401);
	expect((await app.request("/api/admin/templates")).status).toBe(401);
});

it("用户组注册到控制面：管理员可查，未认证不可查", async () => {
	const { app } = makeApp();
	const response = await app.request("/api/admin/groups", { headers: { authorization: "Bearer admin-token" } });
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ data: [] });
	expect((await app.request("/api/admin/groups")).status).toBe(401);
});

it("模版编辑注册到控制面：需有效版本基线，auditor不可编辑已存在的模版", async () => {
	const { app, services } = makeApp();
	const input = {
		name: "可编辑模版",
		category: "general" as const,
		remote_agent_id: "agent_mock_assistant",
		remote_environment_id: "env_mock_default",
		files: [],
		memory_stores: [],
		vault_ids: [],
		suggested_prompts: [],
	};
	const template = await services.templates.create(input, "route-test");
	const path = `/api/admin/templates/${template.template_id}`;
	const put = (body: unknown, token: string) =>
		app.request(path, {
			method: "PUT",
			headers: { ...json, authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		});
	services.config.adminPrincipals.push({ token: "edit-auditor", role: "auditor" });
	expect((await app.request(path, { headers: { authorization: "Bearer edit-auditor" } })).status).toBe(200);
	expect((await put({ ...input, base_version: 1 }, "edit-auditor")).status).toBe(403);
	expect((await put(input, "admin-token")).status).toBe(400);
	const response = await put({ ...input, base_version: 1, description: "新版" }, "admin-token");
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({ data: { version: 2, description: "新版" } });
});

it("模版删除路由注册：只读身份不可计划或删除，管理员需确认后删除", async () => {
	const { app, services } = makeApp();
	const template = await services.templates.create(
		{
			name: "删除路由模版",
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			remote_environment_id: "env_mock_default",
			files: [],
			memory_stores: [],
			vault_ids: [],
			suggested_prompts: [],
		},
		"route-test",
	);
	const path = `/api/admin/templates/${template.template_id}`;
	services.config.adminPrincipals.push({ token: "delete-auditor", role: "auditor" });
	const auditor = { ...json, authorization: "Bearer delete-auditor" };
	const admin = { ...json, authorization: "Bearer admin-token" };
	expect((await app.request(path, { headers: auditor })).status).toBe(200);
	expect((await app.request(`${path}/delete/plan`, { method: "POST", headers: auditor })).status).toBe(403);
	expect((await app.request(path, { method: "DELETE", headers: auditor, body: "{}" })).status).toBe(403);
	expect((await app.request(path, { method: "DELETE", headers: admin, body: "{}" })).status).toBe(428);
	const planned = await app.request(`${path}/delete/plan`, { method: "POST", headers: admin });
	expect(planned.status).toBe(200);
	const { data: plan } = (await planned.json()) as { data: PlanResponse };
	expect(
		(
			await app.request(path, {
				method: "DELETE",
				headers: admin,
				body: JSON.stringify({ plan_id: plan.plan_id, confirm_token: plan.confirm_token }),
			})
		).status,
	).toBe(200);
});

it("模版上架路由要求显式确认，管理员确认后可上架且 auditor 不能写", async () => {
	const { app, services } = makeApp();
	const headers = { ...json, authorization: "Bearer admin-token" };
	const template = await services.templates.create(
		{
			name: "上架路由模版",
			category: "general",
			remote_agent_id: "agent_mock_assistant",
			remote_environment_id: "env_mock_default",
			files: [],
			memory_stores: [],
			vault_ids: [],
			suggested_prompts: [],
		},
		"route-test",
	);
	const base = `/api/admin/templates/${template.template_id}/listing`;
	const body = { display_name: "路由上架助手" };
	const post = (path: string, input: unknown, auth = headers) =>
		app.request(path, { method: "POST", headers: auth, body: JSON.stringify(input) });
	services.config.adminPrincipals.push({ token: "route-auditor", role: "auditor" });
	expect(services.templates.get(template.template_id).template_id).toBe(template.template_id);
	expect((await post(`${base}/plan`, body, { ...json, authorization: "Bearer route-auditor" })).status).toBe(403);
	expect((await post(base, body)).status).toBe(428);
	expect((await post(`${base}/plan`, { display_name: " " })).status).toBe(400);
	const planned = await post(`${base}/plan`, body);
	expect(planned.status).toBe(200);
	const { data: plan } = (await planned.json()) as { data: PlanResponse };
	expect((await post(base, { ...body, plan_id: plan.plan_id, confirm_token: plan.confirm_token })).status).toBe(200);
});

it("远端环境列表注册到管理端：已认证可读网关结果，匿名不可读", async () => {
	const { app, services } = makeApp();
	const expected = await services.gateway.listRemoteEnvironments();
	expect(expected.length).toBeGreaterThan(0);
	const path = "/api/admin/remote/environments";
	const response = await app.request(path, { headers: { authorization: "Bearer admin-token" } });
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ data: expected });
	expect((await app.request(path)).status).toBe(401);
});

// 环境抽屉只读同一资源：管理员与审计员可查看，匿名和路径注入被拒，不创建调试会话。
it("远端环境详情注册到管理端：校验读取权限、资源存在性与环境 ID", async () => {
	const { app, services } = makeApp();
	const environment = (await services.gateway.listRemoteEnvironments()).find(
		(item) => item.environment_id === "env_mock_default",
	);
	expect(environment).toBeDefined();
	const createSession = vi.spyOn(services.gateway, "createSession");
	const base = "/api/admin/remote/environments";
	const path = `${base}/env_mock_default`;
	const headers = { authorization: "Bearer admin-token" };
	services.config.adminPrincipals.push({ token: "environment-auditor", role: "auditor" });
	for (const token of ["admin-token", "environment-auditor"]) {
		const response = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			data: { ...environment, configuration: expect.any(Object) },
		});
	}
	expect((await app.request(path)).status).toBe(401);
	expect((await app.request(`${base}/missing_environment`, { headers })).status).toBe(404);
	for (const id of ["invalid%2Fid", "invalid%3Fid"]) {
		expect((await app.request(`${base}/${id}`, { headers })).status).toBe(400);
	}
	expect(createSession).not.toHaveBeenCalled();
});

it("Session 月度限额注册到控制面；未登录不可读，匿名数据面明确没有成员额度", async () => {
	const { app } = makeApp();
	const path = "/api/admin/usage-limits/policy";
	const response = await app.request(path, { headers: { authorization: "Bearer admin-token" } });
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		data: { limits: { monthly_tokens: null, monthly_active_seconds: null } },
	});
	expect((await app.request(path)).status).toBe(401);
	expect(await (await app.request("/api/kit/usage-limits")).json()).toEqual({ data: null });
});

it("成员创建注册到控制面：管理员可创建并查询，匿名请求被拒", async () => {
	const { app } = makeApp();
	const headers = { ...json, authorization: "Bearer admin-token" };
	const created = await app.request("/api/admin/members", {
		method: "POST",
		headers,
		body: JSON.stringify({ username: "member1", display_name: "成员一", auth_type: "local", password_mode: "auto" }),
	});
	expect(created.status).toBe(201);
	const list = (await (await app.request("/api/admin/members", { headers })).json()) as {
		data: { username: string }[];
	};
	expect(list.data.map((member) => member.username)).toEqual(["member1"]);
	expect((await app.request("/api/admin/members")).status).toBe(401);
});

/** 会话生命周期用例共用的建会话助手（附件块也要用）。 */
async function seedAndCreate(app: ReturnType<typeof makeApp>["app"], subject = "lifecycle") {
	const cookie = `kit_subject=${subject}`;
	const created = await app.request("/api/kit/sessions", {
		method: "POST",
		headers: { ...json, cookie },
		body: JSON.stringify({ agent_slug: "assistant" }),
	});
	const { data } = (await created.json()) as { data: { session_id: string } };
	return { cookie, sessionId: data.session_id };
}

describe("数据面路由", () => {
	it("GET /api/config 不要求身份；apiBaseUrl 默认空串=同源语义", async () => {
		const { app } = makeApp();
		const res = await app.request("/api/config");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { apiBaseUrl: string; protocolVersion: string } };
		expect(body.data.apiBaseUrl).toBe("");
		expect(body.data.protocolVersion).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("KIT_PUBLIC_BASE_URL 显式覆盖 apiBaseUrl（壳/反代场景）", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "kit-cfg-"));
		const config = loadConfig({
			KIT_GATEWAY: "mock",
			KIT_DATA_DIR: dataDir,
			ADMIN_TOKEN: "t",
			KIT_PUBLIC_BASE_URL: "https://kit.example.com/",
		});
		const app = createApp(createKitServices(config, openDatabase(dataDir)));
		const res = await app.request("/api/config");
		const body = (await res.json()) as { data: { apiBaseUrl: string } };
		expect(body.data.apiBaseUrl).toBe("https://kit.example.com");
	});

	it("未上架 agent 不出现在数据面列表", async () => {
		const { app, services } = makeApp();
		services.catalog.upsert({ slug: "hidden", display_name: "Hidden", remote_agent_id: "agent_1" });
		const before = (await (await app.request("/api/kit/agents")).json()) as { data: { slug: string }[] };
		expect(before.data).toHaveLength(0);
		services.catalog.setStatus("hidden", "listed");
		const after = (await (await app.request("/api/kit/agents")).json()) as { data: { slug: string }[] };
		expect(after.data.map((a) => a.slug)).toEqual(["hidden"]);
	});

	it("agents.get 附带远端资源投影：绑定的 mock agent 返回 tools/skills/mcp_servers", async () => {
		const { app, services } = makeApp();
		services.catalog.upsert({ slug: "assistant", display_name: "Assistant", remote_agent_id: "agent_mock_assistant" });
		services.catalog.setStatus("assistant", "listed");
		const res = await app.request("/api/kit/agents/assistant");
		expect(res.status).toBe(200);
		const { data } = (await res.json()) as {
			data: { resources?: { tools: { name: string }[]; mcp_servers: unknown[] } };
		};
		expect(data.resources?.tools.map((tool) => tool.name)).toEqual(["web_search", "code_interpreter"]);
		expect(data.resources?.mcp_servers).toHaveLength(1);
	});

	it("agents.get 资源降级：未绑定远端或 Provider 失败时省略 resources，不影响详情", async () => {
		const { app, services } = makeApp();
		services.catalog.upsert({ slug: "ghost", display_name: "Ghost", remote_agent_id: "agent_unknown" });
		services.catalog.setStatus("ghost", "listed");
		const unbound = (await (await app.request("/api/kit/agents/ghost")).json()) as {
			data: Record<string, unknown>;
		};
		expect(unbound.data).not.toHaveProperty("resources");

		services.gateway.getRemoteAgentResources = async () => {
			throw new Error("模拟 provider 故障");
		};
		services.catalog.upsert({ slug: "assistant", display_name: "Assistant", remote_agent_id: "agent_mock_assistant" });
		services.catalog.setStatus("assistant", "listed");
		const failed = (await (await app.request("/api/kit/agents/assistant")).json()) as {
			data: Record<string, unknown>;
		};
		expect(failed.data).not.toHaveProperty("resources");
		expect(failed.data.slug).toBe("assistant");
	});

	it("建会话 → 发消息 → SSE 持续到客户端断开且含用户回显", async () => {
		const { app, services } = makeApp();
		services.catalog.upsert({ slug: "assistant", display_name: "Assistant", remote_agent_id: "agent_mock_assistant" });
		services.catalog.setStatus("assistant", "listed");
		const cookie = "kit_subject=tester1";
		const created = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ agent_slug: "assistant", title: "t" }),
		});
		expect(created.status).toBe(201);
		const { data: session } = (await created.json()) as { data: { session_id: string } };

		const sent = await app.request(`/api/kit/sessions/${session.session_id}/messages`, {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ text: "hello", client_message_id: "cm1" }),
		});
		expect(sent.status).toBe(202);

		const stream = await app.request(`/api/kit/sessions/${session.session_id}/stream`, {
			headers: { ...json, cookie },
		});
		expect(stream.status).toBe(200);
		const reader = stream.body!.getReader();
		let text = "";
		while (!text.includes('"status":"idle"')) {
			const chunk = await reader.read();
			if (chunk.done) break;
			text += new TextDecoder().decode(chunk.value);
		}
		await reader.cancel();
		expect(text).toContain("event: reset");
		expect(text).toContain("event: ready");
		expect(text).toContain("event: event");
		expect(text).not.toContain("event: done");
		expect(text).toContain('"role":"user"');
		expect(text).toContain("session_status");
	});

	it("他人会话返回 404（不泄露存在性）", async () => {
		const { app, services } = makeApp();
		services.catalog.upsert({ slug: "assistant", display_name: "Assistant", remote_agent_id: "agent_mock_assistant" });
		services.catalog.setStatus("assistant", "listed");
		const created = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie: "kit_subject=owner" },
			body: JSON.stringify({ agent_slug: "assistant" }),
		});
		const { data: session } = (await created.json()) as { data: { session_id: string } };
		const res = await app.request(`/api/kit/sessions/${session.session_id}`, {
			headers: { cookie: "kit_subject=intruder" },
		});
		expect(res.status).toBe(404);
	});

	it("本人上传的附件下载走服务端代理", async () => {
		const { app, services } = makeApp();
		const file = await services.files.upload("x", {
			filename: "report.md",
			bytes: new TextEncoder().encode("# Report"),
		});
		const res = await app.request(`/api/kit/files/${file.file_id}/download`, {
			headers: { cookie: "kit_subject=x" },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-disposition")).toContain("report.md");
		expect(await res.text()).toBe("# Report");
	});
});

describe("控制面", () => {
	it("无/错/对 ADMIN_TOKEN 分别 401/403/200", async () => {
		const { app } = makeApp();
		expect((await app.request("/api/admin/agents")).status).toBe(401);
		expect((await app.request("/api/admin/agents", { headers: { authorization: "Bearer wrong" } })).status).toBe(403);
		expect((await app.request("/api/admin/agents", { headers: { authorization: "Bearer admin-token" } })).status).toBe(
			200,
		);
	});

	it("目录 ID 接受原样 Provider ID 并区分大小写，拒绝无效字符且不创建条目", async () => {
		const { app } = makeApp();
		const path = "/api/admin/agents";
		const headers = { ...json, authorization: "Bearer admin-token" };
		const providerId = "agent_01M5YFTK4FPG5XZ046D6MZK59A";
		const ids = [providerId, providerId.toLowerCase()];
		for (const slug of ids) {
			const input = { slug, display_name: slug, remote_agent_id: providerId };
			const created = await app.request(path, { method: "POST", headers, body: JSON.stringify(input) });
			expect(created.status).toBe(201);
			expect(await created.json()).toMatchObject({ data: { ...input, status: "unlisted" } });
		}
		const before = (await (await app.request(path, { headers })).json()) as { data: CatalogAgentView[] };
		expect(before.data.map((entry) => entry.slug)).toEqual(ids);
		const invalid = await app.request(path, {
			method: "POST",
			headers,
			body: JSON.stringify({ slug: "invalid/id", display_name: "非法 ID", remote_agent_id: providerId }),
		});
		expect(invalid.status).toBe(400);
		expect(await (await app.request(path, { headers })).json()).toEqual(before);
	});

	it("新建目录拒绝重复 ID，不覆盖已上架条目；换 ID 后可创建", async () => {
		const { app } = makeApp();
		const path = "/api/admin/agents";
		const headers = { ...json, authorization: "Bearer admin-token" };
		const original = {
			slug: "existing-agent",
			display_name: "原有助手",
			description: "原有描述",
			remote_agent_id: "agent_original",
			remote_agent_version: 1,
		};
		const create = (input: typeof original) =>
			app.request(path, { method: "POST", headers, body: JSON.stringify(input) });
		const created = await create(original);
		expect(created.status).toBe(201);
		expect(await created.json()).toMatchObject({ data: { ...original, status: "unlisted" } });

		const plan = await app.request(`${path}/${original.slug}/plan`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "listing", status: "listed" }),
		});
		expect(plan.status).toBe(200);
		const { data: confirmation } = (await plan.json()) as { data: { plan_id: string; confirm_token: string } };
		const listed = await app.request(`${path}/${original.slug}`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ ...confirmation, status: "listed" }),
		});
		expect(listed.status).toBe(200);
		const before = (await (await app.request(path, { headers })).json()) as { data: CatalogAgentView[] };
		expect(before.data).toHaveLength(1);
		expect(before.data[0]).toMatchObject({ ...original, status: "listed" });

		const replacement = {
			...original,
			display_name: "不应覆盖的助手",
			description: "不应覆盖的描述",
			remote_agent_id: "agent_replacement",
			remote_agent_version: 2,
		};
		const duplicate = await create(replacement);
		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toMatchObject({
			error: { code: "conflict", message: "ID 已存在，请使用其他 ID" },
		});
		expect(await (await app.request(path, { headers })).json()).toEqual(before);

		const retryInput = { ...replacement, slug: "new-agent" };
		const retried = await create(retryInput);
		expect(retried.status).toBe(201);
		expect(await retried.json()).toMatchObject({ data: { ...retryInput, status: "unlisted" } });
		const after = (await (await app.request(path, { headers })).json()) as { data: CatalogAgentView[] };
		expect(after.data).toHaveLength(2);
		expect(after.data.find((entry) => entry.slug === original.slug)).toEqual(before.data[0]);
	});

	it.each(["unlisted", "listed"] as const)("新建目录拒绝与 %s 条目同名，换展示名后可创建", async (status) => {
		const { app, services } = makeApp();
		const path = "/api/admin/agents";
		const headers = { ...json, authorization: "Bearer admin-token" };
		const original = { slug: "existing-agent", display_name: "原有助手", remote_agent_id: "agent_original" };
		const created = await app.request(path, { method: "POST", headers, body: JSON.stringify(original) });
		expect(created.status).toBe(201);
		if (status === "listed") services.catalog.setStatus(original.slug, status);
		const before = (await (await app.request(path, { headers })).json()) as { data: CatalogAgentView[] };
		expect(before.data).toHaveLength(1);
		expect(before.data[0]).toMatchObject({ ...original, status });

		const duplicateInput = { ...original, slug: "new-agent", remote_agent_id: "agent_new" };
		const duplicate = await app.request(path, {
			method: "POST",
			headers,
			body: JSON.stringify(duplicateInput),
		});
		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toMatchObject({
			error: { code: "conflict", message: "展示名已存在，请使用其他展示名" },
		});
		expect(await (await app.request(path, { headers })).json()).toEqual(before);

		const retryInput = { ...duplicateInput, display_name: "新的助手" };
		const retried = await app.request(path, { method: "POST", headers, body: JSON.stringify(retryInput) });
		expect(retried.status).toBe(201);
		expect(await retried.json()).toMatchObject({ data: { ...retryInput, status: "unlisted" } });
	});

	it("编辑目录拒绝其他条目的展示名，保留自身名称保存正常", async () => {
		const { app, services } = makeApp();
		const path = "/api/admin/agents";
		const headers = { ...json, authorization: "Bearer admin-token" };
		for (const label of ["first", "second"]) {
			const created = await app.request(path, {
				method: "POST",
				headers,
				body: JSON.stringify({ slug: `${label}-agent`, display_name: label, remote_agent_id: `agent_${label}` }),
			});
			expect(created.status).toBe(201);
		}
		services.catalog.setStatus("first-agent", "listed");
		const before = (await (await app.request(path, { headers })).json()) as { data: CatalogAgentView[] };
		expect(before.data).toHaveLength(2);
		expect(before.data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ slug: "first-agent", display_name: "first", status: "listed" }),
				expect.objectContaining({ slug: "second-agent", display_name: "second", status: "unlisted" }),
			]),
		);
		const patch = { display_name: "first", description: "更新描述", remote_agent_id: "agent_updated" };
		const duplicate = await app.request(`${path}/second-agent`, {
			method: "PUT",
			headers,
			body: JSON.stringify(patch),
		});
		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toMatchObject({
			error: { code: "conflict", message: "展示名已存在，请使用其他展示名" },
		});
		expect(await (await app.request(path, { headers })).json()).toEqual(before);

		const updated = await app.request(`${path}/second-agent`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ ...patch, display_name: "second" }),
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			data: { ...patch, display_name: "second", slug: "second-agent", status: "unlisted" },
		});
		const after = (await (await app.request(path, { headers })).json()) as { data: CatalogAgentView[] };
		expect(after.data.find((entry) => entry.slug === "first-agent")).toEqual(
			before.data.find((entry) => entry.slug === "first-agent"),
		);
	});

	it("历史同名条目可保留自身名称编辑，也可改为唯一展示名", async () => {
		const { app, services } = makeApp();
		const path = "/api/admin/agents";
		const headers = { ...json, authorization: "Bearer admin-token" };
		for (const label of ["first", "second"]) {
			services.catalog.create({ slug: `${label}-agent`, display_name: label, remote_agent_id: `agent_${label}` });
		}
		const legacyDb = openDatabase(services.config.dataDir);
		// 模拟旧版本已经保存的重复名，跳过新建合同，不要求迁移改写已有数据。
		legacyDb.prepare("UPDATE catalog_agents SET display_name = ?").run("历史助手");
		legacyDb.close();
		const before = (await (await app.request(path, { headers })).json()) as { data: CatalogAgentView[] };
		expect(before.data).toHaveLength(2);
		expect(before.data.map((entry) => entry.display_name)).toEqual(["历史助手", "历史助手"]);

		const unchanged = await app.request(`${path}/first-agent`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ display_name: "历史助手", description: "保留名称更新说明" }),
		});
		expect(unchanged.status).toBe(200);
		expect(await unchanged.json()).toMatchObject({
			data: { slug: "first-agent", display_name: "历史助手", description: "保留名称更新说明" },
		});
		const renamed = await app.request(`${path}/second-agent`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ display_name: "唯一助手" }),
		});
		expect(renamed.status).toBe(200);
		expect(await renamed.json()).toMatchObject({ data: { slug: "second-agent", display_name: "唯一助手" } });
	});

	it.each([
		{ field: "ID", message: "ID 已存在，请使用其他 ID" },
		{ field: "展示名", message: "展示名已存在，请使用其他展示名" },
	])("同 $field 并发新建只有一个成功，保留成功请求的条目", async ({ field, message }) => {
		const { app } = makeApp();
		const path = "/api/admin/agents";
		const headers = { ...json, authorization: "Bearer admin-token" };
		const responses = await Promise.all(
			["first", "second"].map((label) =>
				app.request(path, {
					method: "POST",
					headers,
					body: JSON.stringify({
						slug: field === "ID" ? "shared-id" : `${label}-agent`,
						display_name: field === "展示名" ? "共享助手" : label,
						remote_agent_id: `agent_${label}`,
					}),
				}),
			),
		);
		expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
		const created = (await responses.find((response) => response.status === 201)!.json()) as {
			data: CatalogAgentView;
		};
		expect(await (await app.request(path, { headers })).json()).toEqual({ data: [created.data] });
		expect(await responses.find((response) => response.status === 409)!.json()).toMatchObject({
			error: { code: "conflict", message },
		});
	});
});

describe("会话生命周期与文件（B1/B2）", () => {
	it("archive 闸门：空令牌 400 / 伪造令牌 428 / 有效令牌 200 且状态归档", async () => {
		const { app, services } = makeApp();
		services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		services.catalog.setStatus("assistant", "listed");
		const { cookie, sessionId } = await seedAndCreate(app);

		const noToken = await app.request(`/api/kit/sessions/${sessionId}/archive`, {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ plan_id: "p", confirm_token: "" }),
		});
		expect(noToken.status).toBe(400);

		const forged = await app.request(`/api/kit/sessions/${sessionId}/archive`, {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ plan_id: "p", confirm_token: "forged" }),
		});
		expect(forged.status).toBe(428);

		const plan = await app.request(`/api/kit/sessions/${sessionId}/plan`, {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ action: "archive" }),
		});
		const planBody = (await plan.json()) as { data: { plan_id: string; confirm_token: string; destructive: boolean } };
		expect(planBody.data.destructive).toBe(true);

		const archived = await app.request(`/api/kit/sessions/${sessionId}/archive`, {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ plan_id: planBody.data.plan_id, confirm_token: planBody.data.confirm_token }),
		});
		expect(archived.status).toBe(200);
		const detail = (await (await app.request(`/api/kit/sessions/${sessionId}`, { headers: { cookie } })).json()) as {
			data: { status: string };
		};
		expect(detail.data.status).toBe("archived");

		// 一次性：同一确认令牌重放必须被拒
		const replay = await app.request(`/api/kit/sessions/${sessionId}/archive`, {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ plan_id: planBody.data.plan_id, confirm_token: planBody.data.confirm_token }),
		});
		expect(replay.status).toBe(428);
	});

	it("delete 带令牌后索引移除（再读 404）", async () => {
		const { app, services } = makeApp();
		services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		services.catalog.setStatus("assistant", "listed");
		const { cookie, sessionId } = await seedAndCreate(app);
		const plan = (await (
			await app.request(`/api/kit/sessions/${sessionId}/plan`, {
				method: "POST",
				headers: { ...json, cookie },
				body: JSON.stringify({ action: "delete" }),
			})
		).json()) as { data: { plan_id: string; confirm_token: string } };
		const deleted = await app.request(`/api/kit/sessions/${sessionId}`, {
			method: "DELETE",
			headers: { ...json, cookie },
			body: JSON.stringify({ plan_id: plan.data.plan_id, confirm_token: plan.data.confirm_token }),
		});
		expect(deleted.status).toBe(200);
		expect((await app.request(`/api/kit/sessions/${sessionId}`, { headers: { cookie } })).status).toBe(404);
	});

	it("文件上传 → 下载 roundtrip", async () => {
		const { app } = makeApp();
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/octet-stream" }), "bin.dat");
		const uploaded = await app.request("/api/kit/files", {
			method: "POST",
			headers: { cookie: "kit_subject=uploader" },
			body: form,
		});
		expect(uploaded.status).toBe(201);
		const { data } = (await uploaded.json()) as { data: { file_id: string; filename: string; size: number } };
		expect(data.filename).toBe("bin.dat");
		expect(data.size).toBe(4);
		const downloaded = await app.request(`/api/kit/files/${data.file_id}/download`, {
			headers: { cookie: "kit_subject=uploader" },
		});
		expect(downloaded.status).toBe(200);
		expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
	});

	it("黑名单扩展名上传被拒（.mjs 实测被 provider 415 拒绝，服务端前置拦截）", async () => {
		const { app } = makeApp();
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array([1])], { type: "text/javascript" }), "stylelint.config.mjs");
		const rejected = await app.request("/api/kit/files", {
			method: "POST",
			headers: { cookie: "kit_subject=uploader" },
			body: form,
		});
		expect(rejected.status).toBe(400);
		expect(((await rejected.json()) as { error: { code: string; message: string } }).error).toMatchObject({
			code: "invalid_request",
			message: "不支持的文件类型：.mjs",
		});
	});

	it("文件扫描状态：本人可查，越权 404", async () => {
		const { app } = makeApp();
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array([1])], { type: "application/octet-stream" }), "scan.bin");
		const uploaded = await app.request("/api/kit/files", {
			method: "POST",
			headers: { cookie: "kit_subject=uploader" },
			body: form,
		});
		const { data } = (await uploaded.json()) as { data: { file_id: string } };
		const mine = await app.request(`/api/kit/files/${data.file_id}`, { headers: { cookie: "kit_subject=uploader" } });
		expect(mine.status).toBe(200);
		const status = (await mine.json()) as { data: { file_id: string; status: string | null; available: boolean } };
		expect(status.data.file_id).toBe(data.file_id);
		expect(status.data.available).toBe(true);
		const intruder = await app.request(`/api/kit/files/${data.file_id}`, {
			headers: { cookie: "kit_subject=intruder" },
		});
		expect(intruder.status).toBe(404);
	});

	it("会话运营接口已移除，体验页仍可读取自己的会话和事件", async () => {
		const { app, services } = makeApp();
		services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		services.catalog.setStatus("assistant", "listed");
		const cookie = "kit_subject=timeline";
		const created = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ agent_slug: "assistant" }),
		});
		const { data } = (await created.json()) as { data: { session_id: string } };
		await app.request(`/api/kit/sessions/${data.session_id}/messages`, {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ text: "timeline" }),
		});
		const session = await app.request(`/api/kit/sessions/${data.session_id}`, { headers: { cookie } });
		expect(session.status).toBe(200);
		const timeline = await app.request(`/api/kit/sessions/${data.session_id}/events`, {
			headers: { cookie },
		});
		expect(timeline.status).toBe(200);
		const body = (await timeline.json()) as { data: { type: string }[] };
		expect(body.data.length).toBeGreaterThan(0);
		for (const path of ["/api/admin/sessions", `/api/admin/sessions/${data.session_id}/events`]) {
			expect((await app.request(path, { headers: { authorization: "Bearer admin-token" } })).status).toBe(404);
		}
	});
});

describe("附件挂载语义（B1）", () => {
	async function listAgent(app: ReturnType<typeof makeApp>["app"], services: ReturnType<typeof makeApp>["services"]) {
		services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		services.catalog.setStatus("assistant", "listed");
		return app;
	}

	it("建会话携带 files → 服务端解析 mount_path 并可在详情回显", async () => {
		const { app, services } = makeApp();
		await listAgent(app, services);
		const cookie = "kit_subject=mounts";
		const files = await Promise.all(
			["数据 表.csv", "数据 表.csv", "b.txt"].map((filename) =>
				services.files.upload("mounts", { filename, bytes: new TextEncoder().encode(filename) }),
			),
		);
		const created = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({
				agent_slug: "assistant",
				files: [
					{ file_id: files[0]!.file_id, filename: "数据 表.csv" },
					{ file_id: files[1]!.file_id, filename: "数据 表.csv" },
					{ file_id: files[2]!.file_id, filename: "b.txt", mount_path: "/mnt/custom/b.txt" },
				],
			}),
		});
		expect(created.status).toBe(201);
		const body = (await created.json()) as {
			data: { session_id: string; files: { file_id: string; mount_path: string }[] };
		};
		expect(body.data.files.map((f) => f.mount_path)).toEqual([
			"/mnt/session/uploads/数据_表.csv",
			"/mnt/session/uploads/数据_表-2.csv",
			"/mnt/custom/b.txt",
		]);

		const detail = (await (
			await app.request(`/api/kit/sessions/${body.data.session_id}`, { headers: { cookie } })
		).json()) as {
			data: { files: { file_id: string; mount_path: string }[] };
		};
		expect(detail.data.files).toHaveLength(3);
	});

	it("超过 KIT_UPLOAD_MAX_BYTES 的上传被拒（400），未超限正常 201", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "kit-upload-"));
		const config = loadConfig({
			KIT_GATEWAY: "mock",
			KIT_AUTH_MODE: "anonymous",
			KIT_DATA_DIR: dataDir,
			ADMIN_TOKEN: "t",
			KIT_UPLOAD_MAX_BYTES: "8",
		});
		const app = createApp(createKitServices(config, openDatabase(dataDir)));
		const tooBig = new FormData();
		tooBig.append("file", new Blob([new Uint8Array(9)], { type: "application/octet-stream" }), "big.dat");
		expect(
			(await app.request("/api/kit/files", { method: "POST", headers: { cookie: "kit_subject=up" }, body: tooBig }))
				.status,
		).toBe(400);

		const ok = new FormData();
		ok.append("file", new Blob([new Uint8Array(8)], { type: "application/octet-stream" }), "ok.dat");
		expect(
			(await app.request("/api/kit/files", { method: "POST", headers: { cookie: "kit_subject=up" }, body: ok })).status,
		).toBe(201);
	});

	it("上传 → 建会话挂载 → 下载 roundtrip 一致", async () => {
		const { app, services } = makeApp();
		await listAgent(app, services);
		const cookie = "kit_subject=roundtrip";
		const form = new FormData();
		form.append("file", new Blob([new TextEncoder().encode("hello kit")], { type: "text/plain" }), "note.txt");
		const uploaded = await app.request("/api/kit/files", { method: "POST", headers: { cookie }, body: form });
		const { data: file } = (await uploaded.json()) as { data: { file_id: string } };
		const created = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ agent_slug: "assistant", files: [{ file_id: file.file_id, filename: "note.txt" }] }),
		});
		const { data: session } = (await created.json()) as {
			data: { session_id: string; files: { mount_path: string }[] };
		};
		expect(session.files[0]?.mount_path).toBe("/mnt/session/uploads/note.txt");
		const downloaded = await app.request(`/api/kit/files/${file.file_id}/download`, { headers: { cookie } });
		expect(await downloaded.text()).toBe("hello kit");
	});
});
