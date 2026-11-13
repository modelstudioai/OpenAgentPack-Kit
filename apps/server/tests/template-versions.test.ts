import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	TemplateInputSchema,
	type TemplateVersionsPage,
	type TemplateVersionView,
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
	vi.useRealTimers();
	for (const close of cleanup.splice(0).reverse()) close();
});
const selected = { remote_agent_id: "agent_mock_assistant", remote_environment_id: "env_mock_analysis" };
const headers = { authorization: "Bearer template-admin", "content-type": "application/json" };

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-template-versions-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "template-admin",
		KIT_ADMIN_TOKENS: "auditor:auditor",
		KIT_RATE_LIMIT_RPS: "0",
	});
	function reopen() {
		const db = openDatabase(dataDir);
		cleanup.push(() => {
			if (db.isOpen) db.close();
		});
		const services = createKitServices(config, db);
		const app = createApp(services);
		function write(path: string, method: "POST" | "PUT", body: unknown, authorization = headers.authorization) {
			return app.request(path, { method, headers: { ...headers, authorization }, body: JSON.stringify(body) });
		}
		async function save(patch: Record<string, unknown> = {}): Promise<TemplateView> {
			const response = await write("/api/admin/templates", "POST", {
				name: "项目助手模版",
				category: "general",
				...selected,
				...patch,
			});
			expect(response.status, await response.clone().text()).toBe(201);
			return ((await response.json()) as { data: TemplateView }).data;
		}
		function edit(template: TemplateView, patch: Record<string, unknown> = {}, authorization?: string) {
			return write(
				`/api/admin/templates/${template.template_id}`,
				"PUT",
				{
					...TemplateInputSchema.strip().parse(template),
					base_version: template.version,
					...patch,
				},
				authorization,
			);
		}
		async function edited(template: TemplateView, patch: Record<string, unknown> = {}): Promise<TemplateView> {
			const response = await edit(template, patch);
			expect(response.status, await response.clone().text()).toBe(200);
			return ((await response.json()) as { data: TemplateView }).data;
		}
		async function publish(template: TemplateView) {
			const input = { display_name: template.name.slice(0, 60) };
			const plan = await services.templates.planListing(template.template_id, input, "test-admin");
			return services.templates.listing(
				template.template_id,
				{ ...input, plan_id: plan.plan_id, confirm_token: plan.confirm_token },
				"test-admin",
			);
		}
		function history(templateId: string) {
			return db
				.prepare(
					"SELECT version,config_json,created_at FROM kit_template_versions WHERE template_id=? ORDER BY version",
				)
				.all(templateId)
				.map((row) => ({
					version: Number(row.version),
					config_json: String(row.config_json),
					created_at: String(row.created_at),
					config: JSON.parse(String(row.config_json)) as Record<string, unknown>,
				}));
		}
		return { app, db, services, save, edit, edited, publish, history, write };
	}
	return { ...reopen(), reopen };
}

describe("模版版本", () => {
	it("默认环境配置可保存上架；从显式环境应用默认环境历史时清除覆盖，员工新会话不传环境 ID", async () => {
		const { app, services, save, edited, publish, history, reopen, write } = setup();
		const environments = vi
			.spyOn(services.gateway, "listRemoteEnvironments")
			.mockRejectedValue(new Error("环境目录暂不可用"));
		const first = await save({ remote_environment_id: undefined, agent_version: 1 });
		for (const key of ["remote_environment_id", "remote_environment_name"]) expect(first).not.toHaveProperty(key);
		const persisted = reopen().services.templates.get(first.template_id);
		expect(persisted).toEqual(first);
		expect(services.templates.list({ limit: 20 }).data[0]).toEqual(first);
		const entry = await publish(first);
		expect(entry.remote_environment_id).toBeNull();
		expect(environments).not.toHaveBeenCalled();
		const create = vi.spyOn(services.gateway, "createSession");
		const start = async () => {
			const response = await app.request("/api/kit/sessions", {
				method: "POST",
				headers: { "content-type": "application/json", cookie: "kit_subject=default-env-employee" },
				body: JSON.stringify({ agent_slug: entry.slug }),
			});
			expect(response.status, await response.clone().text()).toBe(201);
		};
		await start();
		expect(create).toHaveBeenLastCalledWith({ agentId: first.remote_agent_id, agentVersion: 1 });
		environments.mockRestore();
		const second = await edited(first, { remote_environment_id: selected.remote_environment_id });
		expect(services.catalog.get(entry.id)?.remote_environment_id).toBe(selected.remote_environment_id);
		await start();
		expect(create).toHaveBeenLastCalledWith({
			agentId: first.remote_agent_id,
			agentVersion: 1,
			environmentId: selected.remote_environment_id,
		});
		const applied = await write(`/api/admin/templates/${first.template_id}`, "PUT", {
			...TemplateInputSchema.strip().parse(first),
			base_version: second.version,
		});
		expect(applied.status, await applied.clone().text()).toBe(200);
		const { data: third } = (await applied.json()) as { data: TemplateView };
		expect(third.version).toBe(3);
		expect(third.listing?.status).toBe("listed");
		for (const key of ["remote_environment_id", "remote_environment_name"]) expect(third).not.toHaveProperty(key);
		expect(services.catalog.get(entry.id)?.remote_environment_id).toBeNull();
		await start();
		expect(create).toHaveBeenLastCalledWith({ agentId: first.remote_agent_id, agentVersion: 1 });
		const versions = services.templates.versions(first.template_id, { limit: 20 });
		expect(versions.data.map((version) => version.remote_environment_id)).toEqual([
			undefined,
			selected.remote_environment_id,
			undefined,
		]);
		expect(services.templates.version(first.template_id, 1)).not.toHaveProperty("remote_environment_id");
		expect(history(first.template_id).map((version) => version.config.remote_environment_id)).toEqual([
			undefined,
			selected.remote_environment_id,
			undefined,
		]);
	});

	// 历史版本保留完整的资源与展示快照；列表只返回当前版本，重启不丢失或重建版本。
	it("新建为V1，连续编辑追加V2/V3而不改写历史配置", async () => {
		const { services, save, edited, history, reopen } = setup();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-30T01:00:00.000Z"));
		const file = await services.files.upload("admin", { filename: "首版指南.md", bytes: new Uint8Array([1]) });
		const first = await save({
			category: "data",
			agent_version: 1,
			files: [{ file_id: file.file_id, mount_path: "/mnt/guide.md" }],
			description: "首版描述",
			opening_remarks: "首版开场",
			suggested_prompts: ["首版问题"],
			memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "首版说明" }],
			vault_ids: ["vlt_mock_1"],
		});
		expect(first.version).toBe(1);
		expect(first.updated_at).toBe(first.created_at);
		const original = history(first.template_id);
		expect(original).toHaveLength(1);
		expect(original[0]?.config).toMatchObject({
			name: first.name,
			...selected,
			remote_agent_name: "assistant",
			remote_agent_version: 1,
			remote_environment_name: "数据分析环境",
			memory_stores: first.memory_stores,
			vault_ids: ["vlt_mock_1"],
			description: "首版描述",
			opening_remarks: "首版开场",
			suggested_prompts: ["首版问题"],
		});
		vi.setSystemTime(new Date("2026-10-30T02:00:00.000Z"));
		const second = await edited(first, {
			name: "新版助手",
			category: "writing",
			description: "第二版描述",
			remote_agent_id: "agent_mock_designer",
			agent_version: 2,
			remote_environment_id: "env_mock_default",
			files: [],
			vault_ids: ["vlt_mock_2"],
		});
		expect(second).toMatchObject({
			template_id: first.template_id,
			version: 2,
			created_at: first.created_at,
			description: "第二版描述",
		});
		const twoVersions = history(first.template_id);
		expect(twoVersions[0]).toEqual(original[0]);
		vi.setSystemTime(new Date("2026-10-30T03:00:00.000Z"));
		const third = await edited(second, { description: "第三版描述", opening_remarks: "", memory_stores: [] });
		expect(third.version).toBe(3);
		expect(history(first.template_id).slice(0, 2)).toEqual(twoVersions);
		expect(history(first.template_id).map((row) => row.version)).toEqual([1, 2, 3]);
		expect(services.templates.list({ limit: 10 }).data).toEqual([third]);
		const restarted = reopen();
		expect(restarted.services.templates.get(first.template_id)).toEqual(third);
		expect(restarted.history(first.template_id)).toEqual(history(first.template_id));
		await restarted.publish(third);
		const provider = vi.spyOn(restarted.services.gateway, "listRemoteAgents").mockRejectedValue(new Error("offline"));
		const versions = await restarted.app.request(`/api/admin/templates/${first.template_id}/versions`, { headers });
		expect(versions.status).toBe(200);
		expect(await versions.json()).toEqual({
			current_version: 3,
			data: [third, second, first].map((template) => ({
				version: template.version,
				name: template.name,
				category: template.category,
				created_at: template.updated_at,
				remote_agent_id: template.remote_agent_id,
				remote_agent_name: template.remote_agent_name,
				agent_version: template.agent_version,
				remote_agent_version: template.remote_agent_version,
				remote_environment_id: template.remote_environment_id,
				remote_environment_name: template.remote_environment_name,
				files: template.files,
				memory_stores: template.memory_stores,
				vault_ids: template.vault_ids,
			})),
		});
		for (const template of [first, second, third]) {
			const response = await restarted.app.request(
				`/api/admin/templates/${first.template_id}/versions/${template.version}`,
				{ headers },
			);
			expect(response.status, await response.clone().text()).toBe(200);
			const expected = Object.fromEntries(
				Object.entries(template).filter(([key]) => key !== "updated_at" && key !== "listing"),
			);
			expect(await response.json()).toEqual({ data: { ...expected, created_at: template.updated_at } });
		}
		expect(provider).not.toHaveBeenCalled();
	});

	// 独立版本列表须保留每版名称，版本号游标不因后续编辑而重复或跳过较早快照。
	it("历史列表倒序分页，新增版本不干扰游标，摘要与详情仅供管理员身份读取", async () => {
		const { app, services, save, edited } = setup();
		let template = await save({ name: "历史名称 1" });
		for (let version = 2; version <= 4; version += 1)
			template = await edited(template, { name: `历史名称 ${version}` });
		const path = `/api/admin/templates/${template.template_id}/versions`;
		const provider = vi.spyOn(services.gateway, "listRemoteAgentVersions").mockRejectedValue(new Error("offline"));
		const response = await app.request(`${path}?limit=2`, { headers });
		expect(response.status).toBe(200);
		const first = (await response.json()) as TemplateVersionsPage;
		expect(first).toMatchObject({
			current_version: 4,
			data: [
				{ version: 4, name: "历史名称 4", created_at: template.updated_at },
				{ version: 3, name: "历史名称 3" },
			],
		});
		expect(first.next_page_token).toEqual(expect.any(String));
		template = await edited(template, { name: "历史名称 5" });
		const second = await app.request(`${path}?limit=2&page_token=${first.next_page_token}`, { headers });
		expect(await second.json()).toEqual({
			current_version: 5,
			data: [
				expect.objectContaining({ version: 2, name: "历史名称 2", created_at: expect.any(String) }),
				expect.objectContaining({ version: 1, name: "历史名称 1", created_at: template.created_at }),
			],
		});
		const auditor = { authorization: "Bearer auditor" };
		for (const url of [path, `${path}/1`]) {
			const read = await app.request(url, { headers: auditor });
			expect(read.status).toBe(200);
			expect(read.headers.get("cache-control")).toBe("no-store");
			expect((await app.request(url)).status).toBe(401);
		}
		expect(provider).not.toHaveBeenCalled();
	});

	// 游标不可跨模版复用，非法边界不能落到错误版本；不存在的版本不返回当前配置。
	it("拒绝跨模版或无效游标及非法版本，缺失模版和历史版本返回404", async () => {
		const { app, save, edited } = setup();
		const first = await save();
		await edited(first, { name: "第二版" });
		const other = await save({ name: "另一个模版" });
		const path = `/api/admin/templates/${first.template_id}/versions`;
		const otherPath = `/api/admin/templates/${other.template_id}/versions`;
		const page = (await (await app.request(`${path}?limit=1`, { headers })).json()) as TemplateVersionsPage;
		expect(page.next_page_token).toEqual(expect.any(String));
		for (const url of [
			`${otherPath}?page_token=${page.next_page_token}`,
			`${path}?page_token=invalid`,
			`${path}?page_token=${Buffer.from(JSON.stringify({ template_id: first.template_id, before: 0 })).toString("base64url")}`,
			...["0", "101", "1.5", "invalid"].map((limit) => `${path}?limit=${limit}`),
			...["0", "-1", "1.5", "invalid", "9007199254740992"].map((version) => `${path}/${version}`),
		]) {
			const response = await app.request(url, { headers });
			expect(response.status, url).toBe(400);
			expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
		}
		for (const url of [
			`${path}/99`,
			`${otherPath}/2`,
			"/api/admin/templates/missing/versions",
			"/api/admin/templates/missing/versions/1",
		]) {
			const response = await app.request(url, { headers });
			expect(response.status, url).toBe(404);
		}
	});

	// 从真实018之前的列形状升级，已有模版和来源关联仍有效，V1快照只补一次。
	it("旧模版迁移为V1，保留完整配置和现有上架关联", async () => {
		const { save, publish, db, reopen } = setup();
		const template = await save({ description: "迁移前配置", vault_ids: ["vlt_mock_1"] });
		const catalog = await publish(template);
		db.prepare("UPDATE kit_templates SET config_json=json_remove(config_json,'$.category') WHERE template_id=?").run(
			template.template_id,
		);
		const original = db
			.prepare("SELECT config_json,created_at FROM kit_templates WHERE template_id=?")
			.get(template.template_id);
		db.exec(`DROP TABLE kit_template_versions;
			ALTER TABLE kit_templates DROP COLUMN version;
			ALTER TABLE kit_templates DROP COLUMN updated_at;
			DELETE FROM _kit_migrations WHERE id='018_template_versions';`);
		db.close();
		const upgraded = reopen();
		expect(upgraded.services.templates.get(template.template_id)).toMatchObject({
			version: 1,
			category: "general",
			updated_at: template.created_at,
			description: "迁移前配置",
			vault_ids: ["vlt_mock_1"],
			listing: { catalog_id: catalog.id, status: "listed" },
		});
		expect(upgraded.history(template.template_id)).toMatchObject([{ version: 1, ...original }]);
		expect(upgraded.services.templates.list({ limit: 20 }).data[0]?.category).toBe("general");
		expect(upgraded.services.templates.versions(template.template_id, { limit: 20 }).data[0]?.category).toBe("general");
		expect(upgraded.services.templates.version(template.template_id, 1).category).toBe("general");
		expect(upgraded.history(template.template_id)[0]?.config).not.toHaveProperty("category");
		expect(reopen().history(template.template_id)).toEqual(upgraded.history(template.template_id));
	});

	// 并发编辑必须拒绝旧基线，不能丢失胜出者的配置或产生空洞版本。
	it("同一base_version并发保存仅成功一次，过期基线返回409", async () => {
		const { save, edit, services, history } = setup();
		const template = await save();
		const responses = await Promise.all([
			edit(template, { description: "管理员甲" }),
			edit(template, { description: "管理员乙" }),
		]);
		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		const successful = responses.find((response) => response.status === 200);
		if (!successful) throw new Error("Missing successful edit");
		const { data: current } = (await successful.json()) as { data: TemplateView };
		expect(services.templates.get(template.template_id)).toEqual(current);
		expect(history(template.template_id).map((row) => row.version)).toEqual([1, 2]);
		expect((await edit(template, { description: "过期覆盖" })).status).toBe(409);
		expect(services.templates.get(template.template_id)).toEqual(current);
	});

	// 已上架目录自动采用最新模版，但上架状态和运营字段保持；员工已有Session不被重新创建或换资源。
	it("同步已上架条目，新员工会话使用最新配置，旧会话及运营字段保留", async () => {
		const { app, services, save, publish, edited } = setup();
		const oldFile = await services.gateway.uploadFile({ filename: "v1.txt", bytes: new Uint8Array([1]) });
		const newFile = await services.gateway.uploadFile({ filename: "v2.txt", bytes: new Uint8Array([2]) });
		const first = await save({
			files: [{ file_id: oldFile.file_id }],
			memory_stores: [{ memory_store_id: "memory-guide", access: "read_only" }],
			vault_ids: ["vlt_mock_1"],
			description: "旧描述",
			opening_remarks: "旧开场",
			suggested_prompts: ["旧问题"],
		});
		const entry = await publish(first);
		services.catalog.update(entry.id, {
			ordering: 7,
			category: "coding",
			featured: true,
			theme: { accent: "#111111" },
		});
		const create = vi.spyOn(services.gateway, "createSession");
		const mountRemote = vi.spyOn(services.gateway, "mountSessionResource");
		const start = async () => {
			const response = await app.request("/api/kit/sessions", {
				method: "POST",
				headers: { "content-type": "application/json", cookie: "kit_subject=template-employee" },
				body: JSON.stringify({ agent_slug: entry.slug }),
			});
			expect(response.status, await response.clone().text()).toBe(201);
			return ((await response.json()) as { data: { session_id: string } }).data.session_id;
		};
		const oldSessionId = await start();
		const oldSession = services.sessionIndex.get(oldSessionId);
		expect(create).toHaveBeenLastCalledWith(
			expect.objectContaining({
				agentId: first.remote_agent_id,
				environmentId: first.remote_environment_id,
				vaultIds: ["vlt_mock_1"],
			}),
		);
		const second = await edited(first, {
			name: "最新版员工助手",
			category: "data",
			remote_agent_id: "agent_mock_designer",
			remote_environment_id: "env_mock_default",
			files: [{ file_id: newFile.file_id }],
			memory_stores: [{ memory_store_id: "memory-notes", access: "read_write", instructions: "新版说明" }],
			vault_ids: ["vlt_mock_2"],
			description: "新描述",
			opening_remarks: "新开场",
			suggested_prompts: ["新问题"],
		});
		expect(create).toHaveBeenCalledTimes(1);
		expect(second.listing).toMatchObject({
			catalog_id: entry.id,
			slug: entry.slug,
			display_name: second.name,
			status: "listed",
		});
		expect(services.catalog.get(entry.id)).toMatchObject({
			display_name: second.name,
			status: "listed",
			ordering: 7,
			category: "data",
			featured: true,
			theme: { accent: "#111111" },
			remote_agent_id: second.remote_agent_id,
			remote_environment_id: second.remote_environment_id,
			files: second.files,
			memory_stores: second.memory_stores,
			vault_ids: second.vault_ids,
			description: "新描述",
			opening_remarks: "新开场",
			suggested_prompts: ["新问题"],
		});
		expect(services.catalog.get(entry.id)?.remote_agent_version).toBeUndefined();
		const newSessionId = await start();
		expect(newSessionId).not.toBe(oldSessionId);
		expect(create).toHaveBeenLastCalledWith({
			agentId: "agent_mock_designer",
			environmentId: "env_mock_default",
			memoryStores: second.memory_stores,
			vaultIds: ["vlt_mock_2"],
		});
		// 新版本的文件经运行时挂载落到 provider，不进创建载荷
		expect(mountRemote).toHaveBeenCalledWith(expect.anything(), {
			fileId: newFile.file_id,
			mountPath: "/mnt/session/uploads/v2.txt",
		});
		expect(services.sessionIndex.get(oldSessionId)).toEqual(oldSession);
		expect((await services.gateway.getSession(oldSessionId))?.files?.map((file) => file.file_id)).toEqual([
			oldFile.file_id,
		]);
		expect((await services.gateway.getSession(newSessionId))?.files?.map((file) => file.file_id)).toEqual([
			newFile.file_id,
		]);
	});

	// 历史配置通过当前基线保存为新版本；历史不改写、目录状态不变，重复提交不能产生额外版本。
	it.each(["listed", "unlisted"] as const)(
		"应用历史配置生成新版本，同步条目并保留 %s 状态；旧基线不能重复应用",
		async (status) => {
			const { app, services, save, publish, edit, edited, history } = setup();
			const file = await services.gateway.uploadFile({ filename: "历史指南.md", bytes: new Uint8Array([1]) });
			const first = await save({
				name: "历史模版名称",
				category: "writing",
				remote_agent_id: "agent_mock_designer",
				agent_version: 2,
				files: [{ file_id: file.file_id, mount_path: "/mnt/history.md" }],
				memory_stores: [{ memory_store_id: "memory-guide", access: "read_only", instructions: "历史说明" }],
				vault_ids: ["vlt_mock_1"],
				description: "历史描述",
				opening_remarks: "历史开场白",
				suggested_prompts: ["历史示例问题"],
			});
			const second = await edited(first, {
				name: "当前模版名称",
				category: "coding",
				remote_agent_id: "agent_mock_assistant",
				agent_version: 1,
				remote_environment_id: "env_mock_default",
				files: [],
				memory_stores: [],
				vault_ids: [],
				description: "当前描述",
				opening_remarks: "当前开场白",
				suggested_prompts: [],
			});
			const entry = await publish(second);
			if (status === "unlisted") services.catalog.setStatus(entry.slug, status);
			const originalHistory = history(first.template_id);
			const response = await app.request(`/api/admin/templates/${first.template_id}/versions/1`, { headers });
			expect(response.status).toBe(200);
			const { data: historical } = (await response.json()) as { data: TemplateVersionView };
			const historicalConfig = TemplateInputSchema.strip().parse(historical);
			const applied = await edited(second, historicalConfig);
			expect(applied.version).toBe(3);
			expect(TemplateInputSchema.strip().parse(applied)).toEqual(historicalConfig);
			expect(applied.listing).toMatchObject({ catalog_id: entry.id, slug: entry.slug, status });
			expect(history(first.template_id).slice(0, 2)).toEqual(originalHistory);
			expect(history(first.template_id).map((row) => row.version)).toEqual([1, 2, 3]);
			const catalog = services.catalog.get(entry.id);
			expect(catalog).toMatchObject({
				id: entry.id,
				slug: entry.slug,
				status,
				display_name: historicalConfig.name,
				category: "writing",
				remote_agent_id: historicalConfig.remote_agent_id,
				agent_version: 2,
				remote_environment_id: historicalConfig.remote_environment_id,
				files: historicalConfig.files,
				memory_stores: historicalConfig.memory_stores,
				vault_ids: historicalConfig.vault_ids,
				description: historicalConfig.description,
				opening_remarks: historicalConfig.opening_remarks,
				suggested_prompts: historicalConfig.suggested_prompts,
			});
			const appliedHistory = history(first.template_id);
			const stale = await edit(second, historicalConfig);
			expect(stale.status).toBe(409);
			expect(await stale.json()).toMatchObject({ error: { code: "conflict" } });
			expect(services.templates.get(first.template_id)).toEqual(applied);
			expect(history(first.template_id)).toEqual(appliedHistory);
			expect(services.catalog.get(entry.id)).toEqual(catalog);
		},
	);

	// 未上架条目也同步当前配置，但不能通过编辑绕过上架状态；已发出的上架计划不能用于新版本。
	it("未上架保持不可见，编辑使旧上架计划失效，展示名称按60字符同步", async () => {
		const { services, save, publish, edited } = setup();
		const first = await save();
		const entry = await publish(first);
		services.catalog.setStatus(entry.slug, "unlisted");
		const input = { display_name: first.name };
		const plan = await services.templates.planListing(first.template_id, input, "test-admin");
		const second = await edited(first, { name: "长".repeat(64), description: "新描述" });
		expect(services.catalog.get(entry.id)).toMatchObject({
			status: "unlisted",
			display_name: "长".repeat(60),
			description: "新描述",
		});
		expect(services.catalog.listed()).toEqual([]);
		await expect(
			services.templates.listing(
				second.template_id,
				{ ...input, plan_id: plan.plan_id, confirm_token: plan.confirm_token },
				"test-admin",
			),
		).rejects.toMatchObject({ code: "conflict" });
		expect(services.catalog.get(entry.id)?.status).toBe("unlisted");
	});

	// 名称冲突可能来自模板本身或关联目录；资源失效、任何同步失败均不留下部分版本或目录变更。
	it("名称冲突、资源失效和目录同步失败全部回滚，不增加版本", async () => {
		const { services, save, publish, edit, history } = setup();
		const first = await save({ description: "保留内容" });
		const entry = await publish(first);
		const initial = services.templates.get(first.template_id);
		const versions = history(first.template_id);
		const other = await save({ name: "其他模版" });
		const occupied = services.catalog.create({
			slug: "occupied-name",
			display_name: "目录占用名称",
			remote_agent_id: "agent_mock_assistant",
		});
		for (const patch of [
			{ name: other.name },
			{ category: undefined },
			{ category: null },
			{ category: "" },
			{ category: "unknown" },
			{ name: occupied.display_name },
			{ remote_agent_id: "missing-agent" },
			{ remote_environment_id: "missing-environment" },
			{ files: [{ file_id: "missing-file" }] },
			{ memory_stores: [{ memory_store_id: "missing-memory", access: "read_only" }] },
			{ vault_ids: ["missing_vault"] },
		]) {
			const response = await edit(first, patch);
			expect([400, 409]).toContain(response.status);
			expect(services.templates.get(first.template_id)).toEqual(initial);
			expect(history(first.template_id)).toEqual(versions);
			expect(services.catalog.get(entry.id)).toEqual(entry);
		}
		vi.spyOn(services.catalog, "update").mockImplementationOnce(() => {
			throw new Error("catalog sync failed");
		});
		expect((await edit(first, { description: "不能部分提交" })).status).toBe(500);
		expect(services.templates.get(first.template_id)).toEqual(initial);
		expect(history(first.template_id)).toEqual(versions);
		expect(services.catalog.get(entry.id)).toEqual(entry);
		expect(services.audit.list().filter((row) => row.action === "templates.update")).toEqual([]);
	});
});
