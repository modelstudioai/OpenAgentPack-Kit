import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PresetPackPreviewSchema, type PresetPacksPage, PresetPackViewSchema } from "@openagentpack/kit-sdk/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";
import { createPresetPackStore } from "../src/store/preset-packs.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});
const headers = { authorization: "Bearer preset-admin", "content-type": "application/json" };

// 当前两个 UI 入口直接准备配置，不要求保存目录中存在记录，也不能在导入时产生预设包写入。
it("从远端选择直接准备回填配置，不保存预设包或触发 Provider 写操作", async () => {
	const { app, db, gateway, input, file } = await setup();
	const writes = [
		vi.spyOn(gateway, "createSession"),
		vi.spyOn(gateway, "mountSessionResource"),
		vi.spyOn(gateway, "deleteSession"),
	];
	const request = (value: unknown, authorization = headers.authorization) =>
		app.request("/api/admin/preset-packs/preview", {
			method: "POST",
			headers: { ...headers, authorization },
			body: JSON.stringify(value),
		});
	const response = await request(input);
	expect(response.status, await response.clone().text()).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	const preview = PresetPackPreviewSchema.parse(((await response.json()) as { data: unknown }).data);
	expect(preview).toMatchObject({
		remote_agent_id: input.remote_agent_id,
		agent_version: 1,
		remote_environment_id: "env_mock_analysis",
		vault_ids: ["vlt_mock_1"],
	});
	expect(preview.files).toEqual([
		{ file_id: file.file_id, filename: "guide.txt", size: 2, mount_path: "/mnt/guide.txt" },
	]);
	expect(preview).not.toHaveProperty("preset_pack_id");
	expect(preview).not.toHaveProperty("created_at");
	expect(await gateway.getRemoteVault("vlt_mock_3")).not.toBeNull();
	expect((await request({ ...input, resources: [{ type: "vault", resource_id: "vlt_mock_3" }] })).status).toBe(409);
	expect((await request(input, "Bearer preset-auditor")).status).toBe(403);
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_preset_packs").get()).toMatchObject({ count: 0 });
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_templates").get()).toMatchObject({ count: 0 });
	for (const write of writes) expect(write).not.toHaveBeenCalled();
});

// 保护本地目录分页和筛选完整性；列表不能查询 Provider 或泄露资源明细，auditor 可读。
it("已保存预设包支持搜索和分页，返回安全摘要且不依赖 Provider 在线", async () => {
	const { app, gateway, db, input, save } = await setup();
	const created = await save(input);
	expect(created.status).toBe(201);
	const preset = PresetPackViewSchema.parse(((await created.json()) as { data: unknown }).data);
	const store = createPresetPackStore(db);
	const saved = [
		preset,
		...Array.from({ length: 12 }, (_, index) => store.create({ ...preset, remote_agent_name: `资料%_${index + 1}` })),
	];
	const ordered = [...saved].sort(
		(a, b) => b.created_at.localeCompare(a.created_at) || b.preset_pack_id.localeCompare(a.preset_pack_id),
	);
	const providerRead = vi.spyOn(gateway, "listRemoteAgents").mockRejectedValue(new Error("offline"));
	const read = async (query: string) => {
		const response = await app.request(`/api/admin/preset-packs${query}`, {
			headers: { authorization: "Bearer preset-auditor" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		return (await response.json()) as PresetPacksPage;
	};
	const first = await read("");
	const last = await read("?limit=10&offset=10");
	expect(first.total).toBe(13);
	expect(first.data.map((item) => item.preset_pack_id)).toEqual(
		ordered.slice(0, 10).map((item) => item.preset_pack_id),
	);
	expect(last.data.map((item) => item.preset_pack_id)).toEqual(ordered.slice(10).map((item) => item.preset_pack_id));
	expect(first.data[0]?.resource_count).toBe(4);
	expect(first.data[0]).not.toHaveProperty("files");
	expect(first.data[0]).not.toHaveProperty("memory_stores");
	expect(first.data[0]).not.toHaveProperty("vault_ids");
	const match = await read(`?search=${encodeURIComponent("资料%_11")}`);
	expect(match.total).toBe(1);
	expect(match.data[0]?.remote_agent_name).toBe("资料%_11");
	expect((await read("?search=AGENT_MOCK_ASSISTANT")).total).toBe(13);
	expect((await read(`?search=${preset.preset_pack_id}`)).data[0]?.preset_pack_id).toBe(preset.preset_pack_id);
	expect(await read("?search=missing")).toEqual({ data: [], total: 0 });
	expect((await app.request("/api/admin/preset-packs")).status).toBe(401);
	for (const query of ["limit=0", "limit=101", "offset=-1", `search=${"x".repeat(201)}`]) {
		expect((await app.request(`/api/admin/preset-packs?${query}`, { headers })).status).toBe(400);
	}
	expect(providerRead).not.toHaveBeenCalled();
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_preset_packs").get()).toMatchObject({ count: 13 });
});
async function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-preset-import-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "preset-admin",
		KIT_ADMIN_TOKENS: "preset-auditor:auditor",
		KIT_RATE_LIMIT_RPS: "0",
	});
	const reopen = () => {
		const db = openDatabase(dataDir);
		cleanup.push(() => db.close());
		const services = createKitServices(config, db);
		return { app: createApp(services), services, db };
	};
	const state = reopen();
	const gateway = state.services.gateway;
	const memory = (await gateway.listRemoteMemoryStores())[0]!;
	const file = await gateway.uploadFile({ filename: "guide.txt", bytes: new Uint8Array([1, 2]) });
	const session = await gateway.createSession({
		agentId: "agent_mock_assistant",
		environmentId: "env_mock_analysis",
		memoryStores: [{ memory_store_id: memory.memory_store_id, access: "read_only" }],
		vaultIds: ["vlt_mock_1", "vlt_mock_2"],
	});
	await gateway.mountSessionResource(session.session_id, { fileId: file.file_id, mountPath: "/mnt/guide.txt" });
	const input = {
		remote_agent_id: "agent_mock_assistant",
		agent_version: 1,
		resources: [
			{ type: "environment", resource_id: "env_mock_analysis" },
			{ type: "file", resource_id: file.file_id },
			{ type: "memory_store", resource_id: memory.memory_store_id },
			{ type: "vault", resource_id: "vlt_mock_1" },
		],
	};
	const save = (value: unknown, authorization = headers.authorization) =>
		state.app.request("/api/admin/preset-packs", {
			method: "POST",
			headers: { ...headers, authorization },
			body: JSON.stringify(value),
		});
	return { ...state, gateway, memory, file, session, input, save, reopen };
}

// 保护选择→本地持久化→重启读取→创建页回填的合同，不能保存未选资源或触发远端写入。
it("只保存所选版本及资源，元数据由服务端校准，重启可读且 auditor 只读", async () => {
	const { app, db, gateway, file, memory, session, input, save, reopen } = await setup();
	const writes = [
		vi.spyOn(gateway, "createSession"),
		vi.spyOn(gateway, "mountSessionResource"),
		vi.spyOn(gateway, "deleteSession"),
	];
	const vaultDetail = vi.spyOn(gateway, "getRemoteVaultDetail");
	expect((await save(input, "Bearer preset-auditor")).status).toBe(403);
	expect(
		(
			await app.request("/api/admin/preset-packs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			})
		).status,
	).toBe(401);
	const response = await save(input);
	expect(response.status, await response.clone().text()).toBe(201);
	expect(response.headers.get("cache-control")).toBe("no-store");
	const preset = PresetPackViewSchema.parse(((await response.json()) as { data: unknown }).data);
	expect(preset).toMatchObject({
		remote_agent_id: input.remote_agent_id,
		agent_version: 1,
		remote_environment_id: "env_mock_analysis",
		remote_environment_name: "数据分析环境",
		vault_ids: ["vlt_mock_1"],
		memory_stores: [{ memory_store_id: memory.memory_store_id, access: "read_only" }],
	});
	expect(preset.files).toEqual([
		{ file_id: file.file_id, filename: "guide.txt", size: 2, mount_path: "/mnt/guide.txt" },
	]);
	expect(JSON.stringify(preset)).not.toContain(session.session_id);
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_preset_packs").get()).toMatchObject({ count: 1 });
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_templates").get()).toMatchObject({ count: 0 });
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_sessions").get()).toMatchObject({ count: 0 });
	for (const write of writes) expect(write).not.toHaveBeenCalled();
	expect(vaultDetail).not.toHaveBeenCalled();
	const restarted = reopen();
	vi.spyOn(restarted.services.gateway, "listRemoteAgents").mockRejectedValue(new Error("offline"));
	const path = `/api/admin/preset-packs/${preset.preset_pack_id}`;
	expect((await restarted.app.request(path)).status).toBe(401);
	const read = await restarted.app.request(path, { headers: { authorization: "Bearer preset-auditor" } });
	expect(read.status).toBe(200);
	expect(read.headers.get("cache-control")).toBe("no-store");
	expect(await read.json()).toEqual({ data: preset });
});

it("拒绝其他智能体的资源、多环境、失效版本和不支持的类型，失败不落库", async () => {
	const { app, db, gateway, input, save } = await setup();
	await gateway.createSession({ agentId: "agent_mock_assistant", environmentId: "env_mock_default" });
	await gateway.createSession({ agentId: "agent_mock_designer", vaultIds: ["vlt_mock_3"] });
	const foreign = await app.request("/api/admin/preset-packs/agents/agent_mock_designer/resources", { headers });
	expect(JSON.stringify(await foreign.json())).toContain("vlt_mock_3");
	const cases = [
		{ ...input, resources: [{ type: "vault", resource_id: "vlt_mock_3" }] },
		{ ...input, resources: [...input.resources, { type: "environment", resource_id: "env_mock_default" }] },
		{ ...input, agent_version: 999 },
		{ ...input, credentials: "untrusted-extra-field" },
	];
	for (const value of cases) expect([400, 409]).toContain((await save(value)).status);
	vi.spyOn(gateway, "getPresetPackAgentResources").mockResolvedValue({
		agent_id: input.remote_agent_id,
		complete: true,
		sessions: [
			{
				session_id: "s1",
				status: "idle",
				resources: [{ type: "github_repository", resource_id: "repo_one", sources: ["session"] }],
			},
		],
	});
	const unsupported = await save({ ...input, resources: [{ type: "github_repository", resource_id: "repo_one" }] });
	expect(unsupported.status).toBe(400);
	expect(await unsupported.text()).toContain("暂不支持");
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_preset_packs").get()).toMatchObject({ count: 0 });
});

it("挂载或权限冲突不静默取第一项；允许只导入智能体且不固化默认环境", async () => {
	const { db, gateway, file, memory, input, save } = await setup();
	const other = await gateway.createSession({
		agentId: input.remote_agent_id,
		memoryStores: [{ memory_store_id: memory.memory_store_id, access: "read_write" }],
	});
	await gateway.mountSessionResource(other.session_id, { fileId: file.file_id, mountPath: "/mnt/another.txt" });
	for (const resource of input.resources.filter((item) => item.type === "file" || item.type === "memory_store")) {
		const rejected = await save({ ...input, resources: [resource] });
		expect(rejected.status).toBe(400);
		expect(await rejected.text()).toContain(resource.type === "file" ? "多个挂载路径" : "不同访问权限");
	}
	expect(db.prepare("SELECT COUNT(*) AS count FROM kit_preset_packs").get()).toMatchObject({ count: 0 });
	const response = await save({ ...input, resources: [] });
	expect(response.status).toBe(201);
	const preset = PresetPackViewSchema.parse(((await response.json()) as { data: unknown }).data);
	expect(preset.remote_environment_id).toBeUndefined();
	expect(preset.files).toEqual([]);
	expect(preset.memory_stores).toEqual([]);
	expect(preset.vault_ids).toEqual([]);
});
