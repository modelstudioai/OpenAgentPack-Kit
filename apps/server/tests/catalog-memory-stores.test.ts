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
	const dataDir = mkdtempSync(join(tmpdir(), "kit-catalog-memory-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
	});
	const services = createKitServices(config, db);
	const app = createApp(services);
	const create = (memory_stores: unknown[], extra: Record<string, unknown> = {}) =>
		app.request("/api/admin/agents", {
			method: "POST",
			headers: admin,
			body: JSON.stringify({
				slug: "memory-agent",
				display_name: "记忆条目",
				remote_agent_id: "agent_mock_assistant",
				memory_stores,
				...extra,
			}),
		});
	const update = (body: Record<string, unknown>) =>
		app.request("/api/admin/agents/memory-agent", { method: "PUT", headers: admin, body: JSON.stringify(body) });
	return { app, services, create, update, dataDir };
}

describe("上架目录的记忆挂载配置", () => {
	it("只有管理端可列出记忆库；保存权限/说明并持久化，省略保留、[]清空", async () => {
		const { app, services, create, update, dataDir } = setup();
		const path = "/api/admin/remote/memory-stores";
		const list = await app.request(path, { headers: admin });
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({
			data: [
				{ memory_store_id: "memory-guide", name: "项目知识库" },
				{ memory_store_id: "memory-notes", name: "会话笔记" },
			],
		});
		expect((await app.request(path)).status).toBe(401);
		expect((await app.request(path, { headers: { authorization: "Bearer wrong" } })).status).toBe(403);
		const chosen = [
			{ memory_store_id: "memory-guide", instructions: "  优先查阅项目约定  " },
			{ memory_store_id: "memory-notes", access: "read_only" },
		];
		expect((await create(chosen)).status).toBe(201);
		const expected = [
			{ memory_store_id: "memory-guide", access: "read_write", instructions: "优先查阅项目约定" },
			{ memory_store_id: "memory-notes", access: "read_only" },
		];
		expect(services.catalog.getBySlug("memory-agent")?.memory_stores).toEqual(expected);
		expect((await update({ description: "保留记忆配置" })).status).toBe(200);
		const reopened = openDatabase(dataDir);
		cleanup.push(() => reopened.close());
		expect(createCatalogStore(reopened).getBySlug("memory-agent")?.memory_stores).toEqual(expected);
		expect((await update({ memory_stores: [] })).status).toBe(200);
		expect(services.catalog.getBySlug("memory-agent")?.memory_stores).toEqual([]);
	});

	it("新会话采用管理员权限/说明并保留文件与环境，成员不能覆盖；公开目录不暴露配置", async () => {
		const { app, services, create, update } = setup();
		const file = await services.files.upload("uploader", { filename: "guide.txt", bytes: new Uint8Array([1]) });
		const memory = { memory_store_id: "memory-guide", access: "read_only", instructions: "管理员限定的检索说明" };
		expect((await create([memory], { files: [file], remote_environment_id: "env_mock_analysis" })).status).toBe(201);
		services.catalog.setStatus("memory-agent", "listed");
		const createRemote = vi.spyOn(services.gateway, "createSession");
		const mountRemote = vi.spyOn(services.gateway, "mountSessionResource");
		const start = () =>
			app.request("/api/kit/sessions", {
				method: "POST",
				headers: { ...json, cookie: "kit_subject=memory-member" },
				body: JSON.stringify({
					agent_slug: "memory-agent",
					memory_stores: [{ memory_store_id: "memory-notes", access: "read_write" }],
					resources: [{ type: "memory_store", memory_store_id: "memory-notes", access: "read_write" }],
				}),
			});
		expect((await start()).status).toBe(201);
		expect(createRemote).toHaveBeenLastCalledWith({
			agentId: "agent_mock_assistant",
			environmentId: "env_mock_analysis",
			memoryStores: [memory],
		});
		const [agentsResponse, detailResponse, plazaResponse] = await Promise.all(
			["/api/kit/agents", "/api/kit/agents/memory-agent", "/api/kit/plaza"].map((url) =>
				app.request(url, { headers: { cookie: "kit_subject=memory-member" } }),
			),
		);
		if (!agentsResponse || !detailResponse || !plazaResponse) throw new Error("并发目录请求响应缺失");
		for (const response of [agentsResponse, detailResponse, plazaResponse]) expect(response.status).toBe(200);
		const list = await agentsResponse.text();
		expect(list).toContain("记忆条目");
		// 列表与广场不透出记忆配置；详情只投影名称/描述，不含库 ID、访问权限或管理员说明。
		expect(list).not.toContain("memory_stores");
		expect(await plazaResponse.text()).not.toContain("memory_stores");
		const detail = (await detailResponse.json()) as { data: { memory_stores?: unknown } };
		expect(detail.data.memory_stores).toEqual([
			{ name: "项目知识库", description: "沉淀项目约定与文档要点，需要时先查这里。" },
		]);
		const detailBody = JSON.stringify(detail);
		expect(detailBody).not.toContain(memory.instructions);
		expect(detailBody).not.toContain("memory-guide");
		expect(detailBody).not.toContain("read_only");
		expect((await update({ memory_stores: [] })).status).toBe(200);
		expect((await start()).status).toBe(201);
		expect(createRemote.mock.lastCall?.[0]).not.toHaveProperty("memoryStores");
		// 文件不进创建载荷：目录白名单文件由服务层在创建后走运行时挂载
		expect(mountRemote.mock.lastCall?.[1]).toEqual({
			fileId: file.file_id,
			mountPath: "/mnt/session/uploads/guide.txt",
		});
	});

	it("记忆库读取失败时成员详情整体降级省略，不影响详情可用性", async () => {
		const { app, services, create } = setup();
		expect((await create([{ memory_store_id: "memory-guide", access: "read_only" }])).status).toBe(201);
		services.catalog.setStatus("memory-agent", "listed");
		vi.spyOn(services.gateway, "getAgentMemoryStores").mockRejectedValue(
			new KitError("provider_error", "记忆库信息查询失败，请稍后重试", { retryable: true }),
		);
		const response = await app.request("/api/kit/agents/memory-agent", {
			headers: { cookie: "kit_subject=memory-member" },
		});
		expect(response.status).toBe(200);
		const { data } = (await response.json()) as { data: { memory_stores?: unknown } };
		expect(data.memory_stores).toBeUndefined();
	});

	it("拒绝失效/归档库、重复ID、非法权限及数量/说明超限；查询失败不能覆盖已有配置", async () => {
		const { services, create, update } = setup();
		const original = { memory_store_id: "memory-guide", access: "read_only", instructions: "a".repeat(4090) };
		expect((await create([original])).status).toBe(201);
		for (const invalid of [
			[{ memory_store_id: "missing-store" }],
			[original, { ...original, memory_store_id: " memory-guide " }],
			[{ ...original, access: "owner" }],
			[{ ...original, instructions: "a".repeat(4091) }],
			Array.from({ length: 9 }, (_, index) => ({ memory_store_id: `memory-${index}` })),
		])
			expect((await update({ memory_stores: invalid })).status).toBe(400);
		const read = vi.spyOn(services.gateway, "getRemoteMemoryStore").mockResolvedValue(null);
		expect((await update({ memory_stores: [{ memory_store_id: "memory-notes" }] })).status).toBe(400);
		read.mockRejectedValue(new KitError("provider_error", "记忆库信息查询失败，请稍后重试"));
		expect((await update({ memory_stores: [{ memory_store_id: "memory-notes" }] })).status).toBe(502);
		expect(services.catalog.getBySlug("memory-agent")?.memory_stores).toEqual([original]);
	});
});
