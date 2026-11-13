import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, expect, vi } from "vitest";
import { createApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createKitServices } from "../../src/services/index.ts";
import { createResourceDraftService } from "../../src/services/resource-drafts.ts";
import { openDatabase } from "../../src/store/db.ts";
import { createResourceDraftStore } from "../../src/store/resource-drafts.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	setDefaultFetch(undefined);
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

export async function fixture(mode: "sdk" | "mock" = "mock", mainName = "main") {
	const root = await mkdtemp(join(tmpdir(), "kit-yaml-draft-"));
	const main = join(root, mainName);
	await mkdir(main);
	await writeFile(join(main, "keep.txt"), "main must remain");
	const config = loadConfig({
		KIT_GATEWAY: mode,
		KIT_DATA_DIR: root,
		KIT_PROJECT_DIR: main,
		ADMIN_TOKEN: "admin-a",
		KIT_ADMIN_TOKENS: "admin-b:admin,audit:auditor",
		KIT_RATE_LIMIT_BURST: "1000",
		BAILIAN_API_KEY: "fixture-provider-secret",
		BAILIAN_BASE_URL: "https://fixtures.invalid/api/v1/agentstudio",
	});
	let db = openDatabase(root);
	let services = createKitServices(config, db);
	let store = createResourceDraftStore(db);
	function install() {
		store = createResourceDraftStore(db);
		services.resourceDrafts = createResourceDraftService({
			config,
			store,
			gateway: services.gateway,
			gate: services.gate,
			runner: services.runner,
			audit: services.audit,
			operations: services.operations,
		});
		return createApp(services);
	}
	let app = install();
	cleanups.push(async () => {
		if (db.isOpen) db.close();
		await rm(root, { recursive: true, force: true });
	});
	async function request(path: string, method = "GET", body?: unknown, token = "admin-a") {
		return app.request(path, {
			method,
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}
	async function value<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown) {
		const response = await request(path, method, body);
		const payload = (await response.json()) as { data: T };
		expect(response.status, JSON.stringify(payload)).toBeLessThan(300);
		return payload.data;
	}
	const base = (draft: ResourceDraftView) => `/api/admin/resource-drafts/${draft.draft_id}/resources`;
	async function create() {
		return value<ResourceDraftView>("/api/admin/resource-drafts", "POST");
	}
	async function revision(draft: ResourceDraftView) {
		return (await value<{ project_revision: string }>(base(draft))).project_revision;
	}
	async function agent(draft: ResourceDraftView, instructions = "/literal prompt\n") {
		return value<{ agent: { id: string }; new_revision: string }>(`${base(draft)}/agents`, "POST", {
			base_revision: await revision(draft),
			name: "batch agent",
			model: "auto",
			instructions,
		});
	}
	async function plan(draft: ResourceDraftView) {
		return value<{ plan_id: string; confirm_token: string }>(`${base(draft)}/plan`, "POST", { action: "publish" });
	}
	async function publish(draft: ResourceDraftView, confirmation: { plan_id: string; confirm_token: string }) {
		return value<{ operation_id: string }>(`${base(draft)}/publish`, "POST", confirmation);
	}
	async function wait(id: string) {
		await vi.waitFor(() => expect(["succeeded", "failed"]).toContain(services.operations.get(id)?.status));
		return services.operations.get(id)!;
	}
	return {
		root,
		main,
		base,
		request,
		value,
		create,
		revision,
		agent,
		plan,
		publish,
		wait,
		get app() {
			return app;
		},
		get services() {
			return services;
		},
		get store() {
			return store;
		},
		get db() {
			return db;
		},
		restart() {
			db.close();
			db = openDatabase(root);
			services = createKitServices(config, db);
			app = install();
		},
	};
}
