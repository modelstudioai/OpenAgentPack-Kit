import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CatalogAgentView,
	type PlanResponse,
	TemplateInputSchema,
	type TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});
const selected = { remote_agent_id: "agent_mock_designer", remote_environment_id: "env_mock_default" };
const headers = { authorization: "Bearer template-admin", "content-type": "application/json" };

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-template-agent-version-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "template-admin",
		KIT_RATE_LIMIT_RPS: "0",
	});
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(config, db);
	const app = createApp(services);
	function write(path: string, body: unknown, method = "POST") {
		return app.request(path, { method, headers, body: JSON.stringify(body) });
	}
	async function save(agentVersion?: number): Promise<TemplateView> {
		const response = await write("/api/admin/templates", {
			category: "general",
			...selected,
			name: "历史智能体版本模版",
			agent_version: agentVersion,
		});
		expect(response.status, await response.clone().text()).toBe(201);
		return ((await response.json()) as { data: TemplateView }).data;
	}
	async function plan(template: TemplateView): Promise<PlanResponse> {
		const response = await write(`/api/admin/templates/${template.template_id}/listing/plan`, {
			display_name: template.name,
		});
		expect(response.status, await response.clone().text()).toBe(200);
		return ((await response.json()) as { data: PlanResponse }).data;
	}
	function listing(template: TemplateView, prepared: PlanResponse) {
		return write(`/api/admin/templates/${template.template_id}/listing`, {
			display_name: template.name,
			plan_id: prepared.plan_id,
			confirm_token: prepared.confirm_token,
		});
	}
	async function employeeSession(entry: CatalogAgentView) {
		const response = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ agent_slug: entry.slug }),
		});
		expect(response.status, await response.clone().text()).toBe(201);
	}
	return { app, services, write, save, plan, listing, employeeSession };
}

describe("模版智能体版本绑定", () => {
	// 文案更新不能把异步校验前的版本绑定写回；并发变更后提示重试并保留已提交的绑定。
	it("目录文案编辑保留版本，校验期间版本变化时拒绝覆盖并可重试", async () => {
		const { services, write } = setup();
		const entry = services.catalog.create({
			slug: "concurrent-agent-version",
			display_name: "并发版本目录",
			remote_agent_id: selected.remote_agent_id,
			agent_version: 1,
		});
		const url = `/api/admin/agents/${entry.slug}`;
		const initial = await write(url, { description: "正常文案更新" }, "PUT");
		expect(initial.status, await initial.clone().text()).toBe(200);
		expect(services.catalog.get(entry.id)).toMatchObject({ agent_version: 1, description: "正常文案更新" });
		const oldVersion = await services.gateway.getRemoteAgentVersion(selected.remote_agent_id, 1);
		const entered = deferred();
		const release = deferred();
		vi.spyOn(services.gateway, "getRemoteAgentVersion").mockImplementationOnce(async () => {
			entered.resolve();
			await release.promise;
			return oldVersion;
		});
		const pending = write(url, { description: "等待校验的旧请求" }, "PUT");
		try {
			await entered.promise;
			services.catalog.update(entry.id, { agent_version: 2 });
		} finally {
			release.resolve();
		}
		const conflict = await pending;
		expect(conflict.status, await conflict.clone().text()).toBe(409);
		expect(services.catalog.get(entry.id)).toMatchObject({ agent_version: 2, description: "正常文案更新" });
		const retry = await write(url, { description: "重新确认后的文案" }, "PUT");
		expect(retry.status, await retry.clone().text()).toBe(200);
		expect(services.catalog.get(entry.id)).toMatchObject({ agent_version: 2, description: "重新确认后的文案" });
	});

	// 保护用户选择的历史版本贯穿保存、调试、上架和员工创建；切回最新必须真正清除目录旧绑定。
	it("固定历史版本贯穿两种会话，编辑回最新版本后清空绑定", async () => {
		const { app, services, write, save, plan, listing, employeeSession } = setup();
		const template = await save(1);
		expect(template).toMatchObject({ agent_version: 1, remote_agent_version: 1, version: 1 });
		const readback = await app.request(`/api/admin/templates/${template.template_id}`, { headers });
		expect(await readback.json()).toMatchObject({ data: { agent_version: 1 } });
		expect(services.templates.list({ limit: 10 }).data[0]?.agent_version).toBe(1);
		const create = vi.spyOn(services.gateway, "createSession");
		const debug = await write("/api/admin/debug/sessions", { ...selected, agent_version: 1 });
		expect(debug.status, await debug.clone().text()).toBe(201);
		expect(create).toHaveBeenLastCalledWith(
			expect.objectContaining({ agentId: selected.remote_agent_id, agentVersion: 1 }),
		);
		const listed = await listing(template, await plan(template));
		expect(listed.status, await listed.clone().text()).toBe(200);
		const { data: entry } = (await listed.json()) as { data: CatalogAgentView };
		expect(entry.agent_version).toBe(1);
		expect(entry.remote_agent_version).toBeUndefined();
		await employeeSession(entry);
		expect(create).toHaveBeenLastCalledWith(
			expect.objectContaining({ agentId: selected.remote_agent_id, agentVersion: 1 }),
		);
		const edited = await write(
			`/api/admin/templates/${template.template_id}`,
			{
				...TemplateInputSchema.strip().parse(template),
				agent_version: undefined,
				base_version: template.version,
			},
			"PUT",
		);
		expect(edited.status, await edited.clone().text()).toBe(200);
		const { data: latest } = (await edited.json()) as { data: TemplateView };
		expect(latest.agent_version).toBeUndefined();
		expect(latest.version).toBe(2);
		const updatedEntry = services.catalog.get(entry.id)!;
		expect(updatedEntry).toMatchObject({ id: entry.id, status: "listed" });
		expect(updatedEntry.agent_version ?? undefined).toBeUndefined();
		await employeeSession(updatedEntry);
		expect(create.mock.calls.at(-1)?.[0].agentVersion).toBeUndefined();
	});

	// 失效版本不能退回最新，也不能创建调试会话、覆盖已存模版或在计划后偷偷上架。
	it("拒绝不存在和计划后失效的版本，保留原配置且不创建会话或目录", async () => {
		const { services, write, save, plan, listing } = setup();
		const template = await save(2);
		const create = vi.spyOn(services.gateway, "createSession");
		for (const [path, body, method] of [
			["/api/admin/debug/sessions", { ...selected, agent_version: 999 }, "POST"],
			["/api/admin/templates", { ...selected, category: "general", name: "无效版本", agent_version: 999 }, "POST"],
			[
				`/api/admin/templates/${template.template_id}`,
				{ ...selected, category: "general", name: template.name, agent_version: 999, base_version: 1 },
				"PUT",
			],
		] as const) {
			const response = await write(path, body, method);
			expect(response.status, await response.clone().text()).toBe(400);
		}
		expect(services.templates.get(template.template_id)).toMatchObject({ version: 1, agent_version: 2 });
		expect(services.templates.list({ limit: 10 }).data).toHaveLength(1);
		const prepared = await plan(template);
		vi.spyOn(services.gateway, "getRemoteAgentVersion").mockResolvedValue(null);
		const rejected = await listing(template, prepared);
		expect(rejected.status, await rejected.clone().text()).toBe(400);
		expect(services.catalog.all()).toEqual([]);
		expect(create).not.toHaveBeenCalled();
	});

	// 旧记录只有展示版本快照，仍跟随最新；历史版本接口故障不得阻断未锁版本的既有流程。
	it("旧模版展示快照不变成运行时锁定，最新版本无需读取历史接口", async () => {
		const { services, write, save, plan, listing, employeeSession } = setup();
		const template = await save();
		expect(template.remote_agent_version).toBe(3);
		expect(template.agent_version).toBeUndefined();
		const versions = vi.spyOn(services.gateway, "listRemoteAgentVersions").mockRejectedValue(new Error("offline"));
		const version = vi.spyOn(services.gateway, "getRemoteAgentVersion").mockRejectedValue(new Error("offline"));
		const create = vi.spyOn(services.gateway, "createSession");
		const debug = await write("/api/admin/debug/sessions", selected);
		expect(debug.status, await debug.clone().text()).toBe(201);
		expect(create.mock.calls.at(-1)?.[0].agentVersion).toBeUndefined();
		const listed = await listing(template, await plan(template));
		expect(listed.status, await listed.clone().text()).toBe(200);
		const { data: entry } = (await listed.json()) as { data: CatalogAgentView };
		expect(entry.remote_agent_version).toBeUndefined();
		expect(entry.agent_version).toBeUndefined();
		await employeeSession(entry);
		expect(create.mock.calls.at(-1)?.[0].agentVersion).toBeUndefined();
		expect(versions).not.toHaveBeenCalled();
		expect(version).not.toHaveBeenCalled();
	});
});
