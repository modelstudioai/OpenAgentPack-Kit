import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { createCatalogStore } from "../src/store/catalog.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});
const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };
const admin = { ...json, authorization: "Bearer admin-token" };

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-catalog-vaults-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(
		loadConfig({ KIT_GATEWAY: "mock", KIT_AUTH_MODE: "anonymous", KIT_DATA_DIR: dataDir, ADMIN_TOKEN: "admin-token" }),
		db,
	);
	const app = createApp(services);
	const create = (vault_ids: unknown[], extra: Record<string, unknown> = {}) =>
		app.request("/api/admin/agents", {
			method: "POST",
			headers: admin,
			body: JSON.stringify({
				slug: "vault-agent",
				display_name: "密钥库条目",
				remote_agent_id: "agent_mock_assistant",
				vault_ids,
				...extra,
			}),
		});
	const update = (body: Record<string, unknown>) =>
		app.request("/api/admin/agents/vault-agent", { method: "PUT", headers: admin, body: JSON.stringify(body) });
	return { app, services, create, update, dataDir };
}

describe("上架目录的密钥库白名单", () => {
	it("只有管理端可列出密钥库；最多10个可保存并持久化，省略保留、[]清空", async () => {
		const { app, services, create, update, dataDir } = setup();
		const path = "/api/admin/remote/vaults";
		const list = await app.request(path, { headers: admin });
		expect(list.status).toBe(200);
		const { data } = (await list.json()) as { data: { vault_id: string; name: string }[] };
		expect(data).toHaveLength(11);
		expect(data[0]).toEqual({ vault_id: "vlt_mock_1", name: "测试密钥库 1" });
		expect((await app.request(path)).status).toBe(401);
		expect((await app.request(path, { headers: { authorization: "Bearer wrong" } })).status).toBe(403);
		const selected = data.slice(0, 10).map(({ vault_id }) => vault_id);
		expect((await create(selected)).status).toBe(201);
		expect((await update({ description: "保留密钥库" })).status).toBe(200);
		const reopened = openDatabase(dataDir);
		cleanup.push(() => reopened.close());
		expect(createCatalogStore(reopened).getBySlug("vault-agent")?.vault_ids).toEqual(selected);
		expect((await update({ vault_ids: [] })).status).toBe(200);
		expect(services.catalog.getBySlug("vault-agent")?.vault_ids).toEqual([]);
	});

	it("新会话只采用目录的密钥库且保留环境/文件/记忆，公开目录不暴露绑定", async () => {
		const { app, services, create, update } = setup();
		const file = await services.files.upload("uploader", { filename: "guide.txt", bytes: new Uint8Array([1]) });
		const memory = { memory_store_id: "memory-guide", access: "read_only", instructions: "查阅约定" };
		expect(
			(
				await create([" vlt_mock_1 "], {
					files: [file],
					remote_environment_id: "env_mock_analysis",
					memory_stores: [memory],
				})
			).status,
		).toBe(201);
		services.catalog.setStatus("vault-agent", "listed");
		const createRemote = vi.spyOn(services.gateway, "createSession");
		const mountRemote = vi.spyOn(services.gateway, "mountSessionResource");
		const start = () =>
			app.request("/api/kit/sessions", {
				method: "POST",
				headers: { ...json, cookie: "kit_subject=vault-member" },
				body: JSON.stringify({ agent_slug: "vault-agent", vault_ids: ["vlt_mock_2"], vaultIds: ["vlt_mock_2"] }),
			});
		expect((await start()).status).toBe(201);
		expect(createRemote).toHaveBeenLastCalledWith({
			agentId: "agent_mock_assistant",
			environmentId: "env_mock_analysis",
			memoryStores: [memory],
			vaultIds: ["vlt_mock_1"],
		});
		// 目录文件经运行时挂载落到 provider，不进创建载荷
		expect(mountRemote).toHaveBeenCalledWith(expect.anything(), {
			fileId: file.file_id,
			mountPath: "/mnt/session/uploads/guide.txt",
		});
		for (const url of ["/api/kit/agents", "/api/kit/agents/vault-agent", "/api/kit/plaza"]) {
			const response = await app.request(url, { headers: { cookie: "kit_subject=vault-member" } });
			expect(response.status).toBe(200);
			const body = await response.text();
			expect(body).toContain("密钥库条目");
			expect(body).not.toContain("vault_ids");
			expect(body).not.toContain("vlt_mock_1");
		}
		expect((await update({ vault_ids: [] })).status).toBe(200);
		expect((await start()).status).toBe(201);
		expect(createRemote.mock.lastCall?.[0]).not.toHaveProperty("vaultIds");
		expect(createRemote.mock.lastCall?.[0].memoryStores).toEqual([memory]);
	});

	it("拒绝失效/归档库、重复及超限；非法ID不能触发凭据子路由，查询失败保留原配置", async () => {
		const { services, create, update } = setup();
		expect((await create(["vlt_mock_1"])).status).toBe(201);
		for (const invalid of [
			["missing-vault"],
			["vlt_mock_1", " vlt_mock_1 "],
			Array.from({ length: 11 }, (_, index) => `vlt_mock_${index + 1}`),
		]) {
			expect((await update({ vault_ids: invalid })).status).toBe(400);
		}
		const lookup = vi.spyOn(services.gateway, "getRemoteVault");
		for (const invalid of [
			"",
			"..",
			"vlt_mock_1/credentials",
			"vlt_mock_1?include=credentials",
			"vlt_mock_1#fragment",
		]) {
			expect((await update({ vault_ids: [invalid] })).status).toBe(400);
		}
		expect(lookup).not.toHaveBeenCalled();
		lookup.mockResolvedValue(null);
		expect((await update({ vault_ids: ["vlt_mock_2"] })).status).toBe(400);
		lookup.mockRejectedValue(new KitError("provider_error", "密钥库信息查询失败，请稍后重试"));
		expect((await update({ vault_ids: ["vlt_mock_2"] })).status).toBe(502);
		expect(services.catalog.getBySlug("vault-agent")?.vault_ids).toEqual(["vlt_mock_1"]);
	});
});
