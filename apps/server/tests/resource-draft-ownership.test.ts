import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOURCE_DRAFT_KEY_HEADER, type ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import { expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const firstKey = "1cdbca71-447b-4ba8-b559-5fc1f7877a1a";
const otherKey = "4e9c73aa-2fe0-4b35-a6c7-c86e1c220095";

async function data<T>(response: Response): Promise<T> {
	return ((await response.json()) as { data: T }).data;
}

// 同一管理员、不同浏览器存储分区不能因打开创建页而丢弃仍在编辑的真实资源。
it("批次清理归属跨服务重启保留；另一浏览器和缺失凭证均不能接管或删除", async () => {
	const root = await mkdtemp(join(tmpdir(), "kit-draft-owner-"));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: root,
		KIT_PROJECT_DIR: join(root, "main"),
		ADMIN_TOKEN: "fixture-admin",
	});
	let db = openDatabase(root);
	let app = createApp(createKitServices(config, db));
	const request = (path: string, method = "GET", key?: string, body?: unknown) =>
		app.request(path, {
			method,
			headers: {
				authorization: "Bearer fixture-admin",
				"content-type": "application/json",
				...(key ? { [RESOURCE_DRAFT_KEY_HEADER]: key } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		});
	try {
		const response = await request("/api/admin/resource-drafts", "POST", firstKey);
		expect(response.status).toBe(200);
		const { data: draft } = (await response.json()) as { data: ResourceDraftView };
		const path = `/api/admin/resource-drafts/${draft.draft_id}/resources`;
		const overview = await data<{ project_revision: string }>(await request(path));
		const created = await request(`${path}/environments`, "POST", undefined, {
			base_revision: overview.project_revision,
			name: "第一窗口未发布的环境",
		});
		expect(created.status).toBe(201);
		const declarations = await data<unknown[]>(await request(`${path}/declarations`));
		expect(declarations).toHaveLength(1);
		db.close();
		db = openDatabase(root);
		app = createApp(createKitServices(config, db));
		for (const key of [otherKey, undefined]) {
			expect((await request("/api/admin/resource-drafts", "POST", key)).status).toBe(409);
			expect((await request(`/api/admin/resource-drafts/${draft.draft_id}/discard`, "POST", key)).status).toBe(409);
		}
		expect((await request("/api/admin/resource-drafts/active", "GET", otherKey)).status).toBe(409);
		expect(await data(await request(`${path}/declarations`))).toEqual(declarations);
		expect((await request("/api/admin/resource-drafts/active", "GET", firstKey)).status).toBe(200);
		const repeated = await request("/api/admin/resource-drafts", "POST", firstKey);
		expect((await data<ResourceDraftView>(repeated)).draft_id).toBe(draft.draft_id);
		const stored = JSON.stringify(db.prepare("SELECT * FROM kit_resource_drafts").all());
		expect(stored).not.toContain(firstKey);
		expect(JSON.stringify(db.prepare("SELECT * FROM kit_audit").all())).not.toContain(firstKey);
		const discarded = await request(`/api/admin/resource-drafts/${draft.draft_id}/discard`, "POST", firstKey);
		expect(discarded.status).toBe(200);
		expect(await data(discarded)).toEqual({ discarded: true });
		expect((await request(`/api/admin/resource-drafts/${draft.draft_id}`)).status).toBe(404);
		const preflight = await app.request("/api/admin/resource-drafts/active", {
			method: "OPTIONS",
			headers: {
				origin: "http://localhost:5174",
				"access-control-request-method": "GET",
				"access-control-request-headers": RESOURCE_DRAFT_KEY_HEADER,
			},
		});
		expect(preflight.headers.get("access-control-allow-headers")).toContain(RESOURCE_DRAFT_KEY_HEADER);
	} finally {
		db.close();
		await rm(root, { recursive: true, force: true });
	}
});

it("两个浏览器同时首次创建时只有一个归属成功，失败方不能复用在途创建结果", async () => {
	const root = await mkdtemp(join(tmpdir(), "kit-draft-owner-race-"));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: root,
		KIT_PROJECT_DIR: join(root, "main"),
		ADMIN_TOKEN: "fixture-admin",
	});
	const db = openDatabase(root);
	const app = createApp(createKitServices(config, db));
	try {
		const results = await Promise.all(
			[firstKey, otherKey].map((key) =>
				app.request("/api/admin/resource-drafts", {
					method: "POST",
					headers: { authorization: "Bearer fixture-admin", [RESOURCE_DRAFT_KEY_HEADER]: key },
				}),
			),
		);
		expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
		expect(db.prepare("SELECT draft_id FROM kit_resource_drafts").all()).toHaveLength(1);
	} finally {
		db.close();
		await rm(root, { recursive: true, force: true });
	}
});
