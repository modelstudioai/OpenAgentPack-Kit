import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import { setDefaultFetch } from "@openagentpack/sdk";
import { expect, it, vi } from "vitest";

import { fixture } from "./helpers/yaml-draft.ts";

it("批次接口不能访问正式 Project，即使正式目录名称符合批次 ID 格式", async () => {
	const name = `draft_${"a".repeat(32)}`;
	const t = await fixture("mock", name);
	expect((await t.request(`/api/admin/projects/${name}`)).status).toBe(404);
	expect((await t.request(`/api/admin/resource-drafts/${name}/resources`)).status).toBe(404);
	expect(
		(
			await t.request(`/api/admin/resource-drafts/${name}/resources/agents`, "POST", {
				base_revision: "1",
				name: "must not be created",
				model: "auto",
			})
		).status,
	).toBe(404);
	expect(await readFile(join(t.main, "keep.txt"), "utf8")).toBe("main must remain");
});

it("早期 029 批次缺少上传清单列时可升级，保留已有声明并恢复资源列表读取", async () => {
	const t = await fixture();
	const draft = await t.create();
	const created = await t.agent(draft);
	const before = t.store.document(draft.draft_id);
	// 开发服务曾应用不含 assets_json 的 029；同一迁移 ID 不会再次执行。
	t.db.exec("ALTER TABLE kit_resource_draft_documents DROP COLUMN assets_json");
	t.db.prepare("DELETE FROM _kit_migrations WHERE id=?").run("030_resource_draft_assets");
	t.restart();
	expect(await t.value(`${t.base(draft)}/declarations`)).toContainEqual(
		expect.objectContaining({ type: "agent", id: created.agent.id }),
	);
	expect(await t.value(`${t.base(draft)}/resource-bindings`)).toEqual({ resources: [] });
	expect(t.store.document(draft.draft_id)).toEqual(before);
	t.restart();
	expect(t.store.document(draft.draft_id)).toEqual(before);
	expect(await t.value(`${t.base(draft)}/declarations`)).toHaveLength(1);
});

it("YAML 草稿支持五类资源、原文和修订校验，不创建源码目录；确认发布后只保留回执", async () => {
	const t = await fixture();
	const draft = await t.create();
	const multiagent = { type: "coordinator", agents: [{ type: "self" }, { agent_id: "agent_mock_designer" }] };
	const created = await t.value<{ agent: { id: string } }>(`${t.base(draft)}/agents`, "POST", {
		base_revision: await t.revision(draft),
		name: "batch agent",
		model: "auto",
		instructions: "/literal prompt\n",
		multiagent,
	});
	expect(created.agent).not.toHaveProperty("source_path");
	for (const [kind, input] of [
		["environments", { name: "batch environment" }],
		["memory-stores", { name: "batch memory", entries: [{ key: "note", content: "./literal memory" }] }],
		["vaults", { display_name: "batch vault" }],
	] as const)
		await t.value(`${t.base(draft)}/${kind}`, "POST", { ...input, base_revision: await t.revision(draft) });
	expect(
		(await t.request(`${t.base(draft)}/agents`, "POST", { base_revision: "1", name: "stale", model: "auto" })).status,
	).toBe(409);
	const form = new FormData();
	form.set("base_revision", await t.revision(draft));
	form.set("file", new Blob(["batch bytes"]), "brief.txt");
	const uploaded = await t.app.request(`${t.base(draft)}/file-uploads`, {
		method: "POST",
		headers: { authorization: "Bearer admin-a" },
		body: form,
	});
	expect(uploaded.status).toBe(201);
	const upload = (await uploaded.json()) as { data: { upload_id: string } };
	await t.value(`${t.base(draft)}/file-uploads/commit`, "POST", {
		base_revision: await t.revision(draft),
		upload_ids: [upload.data.upload_id],
	});
	expect(t.store.document(draft.draft_id)?.yaml).toContain("./literal memory");
	expect(t.store.document(draft.draft_id)?.yaml).toContain("/literal prompt");
	expect(existsSync(join(t.root, "resource-draft-projects"))).toBe(false);
	const confirmation = await t.plan(draft);
	expect(
		(await t.request(`${t.base(draft)}/publish`, "POST", { plan_id: confirmation.plan_id })).status,
	).toBeGreaterThanOrEqual(400);
	expect(
		(await t.request(`${t.base(draft)}/publish`, "POST", { ...confirmation, confirm_token: "wrong" })).status,
	).toBe(428);
	expect((await t.request(`${t.base(draft)}/declarations`, "GET", undefined, "admin-b")).status).toBe(404);
	expect(
		(
			await t.request(
				`${t.base(draft)}/agents`,
				"POST",
				{ base_revision: await t.revision(draft), name: "forbidden", model: "auto" },
				"audit",
			)
		).status,
	).toBe(403);
	const op = await t.publish(draft, confirmation);
	expect((await t.wait(op.operation_id)).status).toBe("succeeded");
	const saved = await t.value<ResourceDraftView>(`/api/admin/resource-drafts/${draft.draft_id}`);
	expect(saved.resources).toHaveLength(5);
	expect(saved.resources.find((item) => item.id === created.agent.id)?.version).toBe(1);
	const remote = saved.resources.find((item) => item.id === created.agent.id)!;
	const detail = await t.value<{ configuration: { multiagent: unknown } }>(
		`/api/admin/remote/agents/${remote.remote_id}/versions/${remote.version}`,
	);
	expect(detail.configuration.multiagent).toEqual(multiagent);
	expect(await t.value("/api/admin/remote/files")).toContainEqual(expect.objectContaining({ filename: "brief.txt" }));
	expect(t.store.document(draft.draft_id)).toBeUndefined();
	expect(existsSync(join(t.root, "resource-draft-uploads", draft.draft_id))).toBe(false);
	expect(await readFile(join(t.main, "keep.txt"), "utf8")).toBe("main must remain");
	const next = await t.create();
	expect(JSON.parse(t.store.document(next.draft_id)!.sdk_state_json)).toEqual({ resources: [] });
	expect(await t.value(`${t.base(next)}/declarations`)).toEqual([]);
});

it("临时 Vault 值仅在批次内存中，配置变化使旧计划失效且丢弃清理声明", async () => {
	const t = await fixture();
	const draft = await t.create();
	await t.agent(draft);
	const before = Object.keys(process.env).filter((key) => key.startsWith("KIT_VAULT_"));
	await t.value(`${t.base(draft)}/vaults`, "POST", {
		base_revision: await t.revision(draft),
		display_name: "private vault",
		credentials: [
			{
				name: "service",
				secret_name: "API_TOKEN",
				secret_value: "private-fixture-value",
				allowed_hosts: ["api.example.com"],
				acknowledged: true,
			},
		],
	});
	expect(JSON.stringify(t.store.document(draft.draft_id))).not.toContain("private-fixture-value");
	expect(JSON.stringify(await t.value(`${t.base(draft)}/declarations`))).not.toContain("private-fixture-value");
	expect(Object.keys(process.env).filter((key) => key.startsWith("KIT_VAULT_"))).toEqual(before);
	const confirmation = await t.plan(draft);
	await t.value(`${t.base(draft)}/environments`, "POST", { base_revision: await t.revision(draft), name: "changed" });
	expect((await t.request(`${t.base(draft)}/publish`, "POST", confirmation)).status).toBe(428);
	await t.value(`/api/admin/resource-drafts/${draft.draft_id}/discard`, "POST");
	expect(t.store.document(draft.draft_id)).toBeUndefined();
});

it("真实 SDK 对象发布保留原文和 state；回执写入失败后重启收尾不重复远端创建", async () => {
	const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
	const text = `/literal prompt \${NOT_AN_ENV_REFERENCE}\n`;
	setDefaultFetch(async (input, init) => {
		const path = new URL(String(input)).pathname.replace("/api/v1/agentstudio", "");
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
		calls.push({ path, method, body });
		if (method === "POST" && path === "/agents")
			return Response.json({ id: "agent_fixture", version: 1, name: "batch agent" });
		if (method === "GET" && path === "/agents/agent_fixture")
			return Response.json({
				id: "agent_fixture",
				version: 1,
				name: "batch agent",
				model: { name: "auto" },
				system: text,
			});
		throw new Error(`Unexpected SDK fixture request: ${method} ${path}`);
	});
	const t = await fixture("sdk");
	const draft = await t.create();
	await t.agent(draft, text);
	const savedStates: string[] = [];
	const original = t.store.writeState.bind(t.store);
	vi.spyOn(t.store, "writeState").mockImplementation((id, state) => {
		savedStates.push(state);
		original(id, state);
	});
	vi.spyOn(t.store, "receipt").mockImplementationOnce(() => {
		throw new Error("receipt write failed");
	});
	const confirmation = await t.plan(draft);
	expect(calls.filter((call) => call.method === "POST")).toEqual([]);
	const op = await t.publish(draft, confirmation);
	const failedReceipt = await t.wait(op.operation_id);
	expect(failedReceipt).toMatchObject({
		status: "failed",
		publication: { outcome: "succeeded", resources: [{ remote_id: "agent_fixture", version: 1 }] },
		error_details: { phase: "receipt", mutation_started: true },
	});
	expect(await t.value(`/api/admin/resource-drafts/${draft.draft_id}`)).toMatchObject({ recovery_action: "finalize" });
	expect(calls.find((call) => call.method === "POST")?.body?.system).toBe(text);
	expect(savedStates.some((state) => state.includes("agent_fixture"))).toBe(true);
	expect(savedStates.join("")).not.toContain("fixture-provider-secret");
	expect(existsSync(join(t.root, "resource-draft-projects"))).toBe(false);
	expect(t.store.document(draft.draft_id)?.proof_json).toContain("agent_fixture");
	const persisted = t.store.document(draft.draft_id);
	t.db.exec("ALTER TABLE kit_resource_draft_documents DROP COLUMN assets_json");
	t.db.prepare("DELETE FROM _kit_migrations WHERE id=?").run("030_resource_draft_assets");
	t.restart();
	expect(t.store.document(draft.draft_id)).toEqual(persisted);
	const saved = await t.value<ResourceDraftView>(`/api/admin/resource-drafts/${draft.draft_id}/finalize`, "POST");
	expect(saved).toMatchObject({ status: "published", cleanup_pending: false });
	expect(saved.resources).toEqual([expect.objectContaining({ remote_id: "agent_fixture", version: 1 })]);
	await t.value(`/api/admin/resource-drafts/${draft.draft_id}/finalize`, "POST");
	expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
	expect(t.store.document(draft.draft_id)).toBeUndefined();
});

it("上传 Skill 必须绑定后才能发布；暂存文件变化阻断已确认计划且尚未执行远端", async () => {
	const t = await fixture();
	const draft = await t.create();
	const form = new FormData();
	form.set("base_revision", await t.revision(draft));
	form.set("file", new Blob(["---\nname: batch-skill\ndescription: Example skill\n---\nDo the task.\n"]), "SKILL.md");
	const response = await t.app.request(`${t.base(draft)}/skill-uploads`, {
		method: "POST",
		headers: { authorization: "Bearer admin-a" },
		body: form,
	});
	expect(response.status).toBe(201);
	const upload = (await response.json()) as { data: { upload_id: string; skill_key: string } };
	await t.value(`${t.base(draft)}/skill-uploads/commit`, "POST", {
		base_revision: await t.revision(draft),
		upload_ids: [upload.data.upload_id],
	});
	expect((await t.request(`${t.base(draft)}/plan`, "POST", { action: "publish" })).status).toBe(400);
	await t.value(`${t.base(draft)}/agents`, "POST", {
		base_revision: await t.revision(draft),
		name: "skilled",
		model: "auto",
		skills: [upload.data.skill_key],
	});
	const confirmation = await t.plan(draft);
	await writeFile(
		join(t.root, "resource-draft-uploads", draft.draft_id, upload.data.skill_key, "SKILL.md"),
		"tampered",
	);
	const before = await t.services.gateway.listRemoteAgents();
	const op = await t.publish(draft, confirmation);
	expect((await t.wait(op.operation_id)).status).toBe("failed");
	expect(t.store.get(draft.draft_id)?.phase).toBe("editable");
	expect(await t.services.gateway.listRemoteAgents()).toEqual(before);
	expect(JSON.parse(t.store.document(draft.draft_id)!.sdk_state_json).resources).toEqual([]);
});

it("部分 SDK 成功保留 state，重启后只允许读取核对，不能重新发布或伪造成功", async () => {
	let posts = 0;
	setDefaultFetch(async (input, init) => {
		const path = new URL(String(input)).pathname.replace("/api/v1/agentstudio", "");
		if (init?.method === "POST") {
			posts++;
			if (path === "/environments") return Response.json({ id: "env_created", name: "created environment" });
			if (path === "/agents") return Response.json({ error: "private-provider-error-body" }, { status: 500 });
		}
		if (path === "/environments/env_created")
			return Response.json({ id: "env_created", name: "created environment", config: { type: "cloud" } });
		throw new Error(`Unexpected fixture request: ${path}`);
	});
	const t = await fixture("sdk");
	const draft = await t.create();
	await t.value(`${t.base(draft)}/environments`, "POST", {
		base_revision: await t.revision(draft),
		name: "created environment",
	});
	await t.agent(draft);
	const op = await t.publish(draft, await t.plan(draft));
	const result = await t.wait(op.operation_id);
	expect(result.status).toBe("failed");
	expect(result).toMatchObject({
		publication: { outcome: "unknown", mutation_started: true },
		error_details: { phase: "execute", mutation_started: true, http_status: 500 },
	});
	expect(result.publication?.resources).toContainEqual(
		expect.objectContaining({ type: "environment", status: "succeeded", remote_id: "env_created" }),
	);
	expect(result.publication?.resources).toContainEqual(
		expect.objectContaining({
			type: "agent",
			status: "unknown",
			error_details: {
				code: "resource.provider_failed",
				phase: "execute",
				mutation_started: true,
				retryable: true,
				http_status: 500,
			},
		}),
	);
	expect(JSON.stringify(result)).not.toContain("private-provider-error-body");
	expect(t.store.document(draft.draft_id)?.sdk_state_json).toContain("env_created");
	expect(t.store.document(draft.draft_id)?.proof_json).toBeNull();
	const count = posts;
	t.restart();
	expect(await t.value(`/api/admin/resource-drafts/${draft.draft_id}`)).toMatchObject({
		recovery_action: "read_result",
	});
	expect(t.services.operations.get(op.operation_id)?.publication).toEqual(result.publication);
	expect((await t.request(`${t.base(draft)}/plan`, "POST", { action: "publish" })).status).toBe(409);
	expect((await t.request(`/api/admin/resource-drafts/${draft.draft_id}/finalize`, "POST")).status).toBe(409);
	expect(posts).toBe(count);
	expect(t.store.get(draft.draft_id)?.phase).toBe("uncertain");
});
