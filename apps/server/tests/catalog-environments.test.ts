import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { createCatalogStore } from "../src/store/catalog.ts";
import { openDatabase } from "../src/store/db.ts";

const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };
const admin = { ...json, authorization: "Bearer admin-token" };

it("目录环境持久化并用于后续体验会话；省略保留，null 清除，终端用户不能覆盖", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-catalog-environment-"));
	const db = openDatabase(dataDir);
	try {
		const config = loadConfig({
			KIT_GATEWAY: "mock",
			KIT_AUTH_MODE: "anonymous",
			KIT_DATA_DIR: dataDir,
			ADMIN_TOKEN: "admin-token",
		});
		const services = createKitServices(config, db);
		const app = createApp(services);
		const created = await app.request("/api/admin/agents", {
			method: "POST",
			headers: admin,
			body: JSON.stringify({
				slug: "env-agent",
				display_name: "环境测试",
				remote_agent_id: "agent_mock_assistant",
				remote_environment_id: "env_mock_analysis",
			}),
		});
		expect(created.status).toBe(201);
		expect(createCatalogStore(db).getBySlug("env-agent")?.remote_environment_id).toBe("env_mock_analysis");
		const update = (body: Record<string, unknown>) =>
			app.request("/api/admin/agents/env-agent", { method: "PUT", headers: admin, body: JSON.stringify(body) });
		expect((await update({ description: "仅修改描述" })).status).toBe(200);
		expect(services.catalog.getBySlug("env-agent")?.remote_environment_id).toBe("env_mock_analysis");
		services.catalog.setStatus("env-agent", "listed");
		const createSession = vi.spyOn(services.gateway, "createSession");
		const start = () =>
			app.request("/api/kit/sessions", {
				method: "POST",
				headers: { ...json, cookie: "kit_subject=environment-member" },
				body: JSON.stringify({
					agent_slug: "env-agent",
					remote_environment_id: "env-untrusted",
					environment_id: "env-untrusted",
				}),
			});
		expect((await start()).status).toBe(201);
		expect(createSession).toHaveBeenLastCalledWith({
			agentId: "agent_mock_assistant",
			environmentId: "env_mock_analysis",
		});
		expect((await update({ remote_environment_id: null })).status).toBe(200);
		expect(createCatalogStore(db).getBySlug("env-agent")?.remote_environment_id).toBeNull();
		expect((await start()).status).toBe(201);
		expect(createSession).toHaveBeenLastCalledWith({ agentId: "agent_mock_assistant" });
		expect((await update({ remote_environment_id: "" })).status).toBe(400);
	} finally {
		db.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});

it("已有目录迁移后保持默认环境及空资源配置，再次打开不重复迁移或丢失选择", () => {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-catalog-environment-migration-"));
	let db = openDatabase(dataDir);
	try {
		createCatalogStore(db).create({ slug: "existing", display_name: "历史条目", remote_agent_id: "agent-existing" });
		// 重建升级前的真实表结构与迁移账本，验证增量 ALTER 对已有行的结果。
		db.exec("ALTER TABLE catalog_agents DROP COLUMN remote_environment_id");
		db.exec("ALTER TABLE catalog_agents DROP COLUMN files_json");
		db.exec("ALTER TABLE catalog_agents DROP COLUMN memory_stores_json");
		db.exec("ALTER TABLE catalog_agents DROP COLUMN vault_ids_json");
		db.prepare("DELETE FROM _kit_migrations WHERE id = ?").run("010_catalog_environment");
		db.prepare("DELETE FROM _kit_migrations WHERE id = ?").run("011_catalog_files");
		db.prepare("DELETE FROM _kit_migrations WHERE id = ?").run("012_catalog_memory_stores");
		db.prepare("DELETE FROM _kit_migrations WHERE id = ?").run("013_catalog_vaults");
		db.close();
		db = openDatabase(dataDir);
		const catalog = createCatalogStore(db);
		expect(catalog.getBySlug("existing")).toMatchObject({
			display_name: "历史条目",
			remote_environment_id: null,
			files: [],
			memory_stores: [],
			vault_ids: [],
		});
		const files = [{ file_id: "file-persisted", filename: "guide.txt", mount_path: "/mnt/session/uploads/guide.txt" }];
		const memory_stores = [{ memory_store_id: "memory-persisted", access: "read_only" as const }];
		const vault_ids = ["vlt-persisted"];
		catalog.updateBySlug("existing", { remote_environment_id: "env-persisted", files, memory_stores, vault_ids });
		db.close();
		db = openDatabase(dataDir);
		expect(createCatalogStore(db).getBySlug("existing")?.remote_environment_id).toBe("env-persisted");
		expect(createCatalogStore(db).getBySlug("existing")?.files).toEqual(files);
		expect(createCatalogStore(db).getBySlug("existing")?.memory_stores).toEqual(memory_stores);
		expect(createCatalogStore(db).getBySlug("existing")?.vault_ids).toEqual(vault_ids);
	} finally {
		db.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});
