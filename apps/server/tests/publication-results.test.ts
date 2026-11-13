import { setDefaultFetch } from "@openagentpack/sdk";
import { expect, it, vi } from "vitest";
import { fixture } from "./helpers/yaml-draft.ts";

it("Vault 已创建但凭据失败时持久保留已知 ID，不将未完成资源写成完整 State 或允许重发", async () => {
	const calls: string[] = [];
	setDefaultFetch(async (input, init) => {
		const path = new URL(String(input)).pathname.replace("/api/v1/agentstudio", "");
		calls.push(`${init?.method ?? "GET"} ${path}`);
		if (path === "/vaults" && init?.method === "POST")
			return Response.json({ id: "vault_created", name: "partial vault" });
		if (path === "/vaults/vault_created/credentials" && init?.method === "POST")
			return Response.json({ code: "InvalidCredential", message: "private credential response" }, { status: 400 });
		throw new Error("unexpected fixture request");
	});
	const t = await fixture("sdk");
	const draft = await t.create();
	await t.value(`${t.base(draft)}/vaults`, "POST", {
		base_revision: await t.revision(draft),
		display_name: "partial vault",
		credentials: [
			{
				name: "service",
				secret_name: "API_TOKEN",
				secret_value: "private fixture credential",
				allowed_hosts: ["api.example.com"],
				acknowledged: true,
			},
		],
	});
	const operation = await t.wait((await t.publish(draft, await t.plan(draft))).operation_id);
	expect(operation).toMatchObject({
		status: "failed",
		publication: {
			outcome: "unknown",
			mutation_started: true,
			resources: [{ type: "vault", status: "unknown", remote_id: "vault_created" }],
		},
	});
	expect(JSON.stringify(operation)).not.toContain("private credential response");
	expect(JSON.stringify(operation)).not.toContain("private fixture credential");
	expect(JSON.parse(t.store.document(draft.draft_id)!.sdk_state_json).resources).toEqual([]);
	expect(t.store.document(draft.draft_id)?.proof_json).toBeNull();
	t.restart();
	expect(t.services.operations.get(operation.operation_id)?.publication).toEqual(operation.publication);
	expect(await t.value(`/api/admin/resource-drafts/${draft.draft_id}`)).toMatchObject({
		recovery_action: "read_result",
	});
	expect((await t.request(`${t.base(draft)}/plan`, "POST", { action: "publish" })).status).toBe(409);
	expect((await t.request(`/api/admin/resource-drafts/${draft.draft_id}/finalize`, "POST")).status).toBe(409);
	expect(calls).toEqual(["POST /vaults", "POST /vaults/vault_created/credentials"]);
});

it("SDK 成功后 StateBackend 最终保存失败仍保留逐资源结果；报告不能替代成功证明", async () => {
	let posts = 0;
	setDefaultFetch(async (input, init) => {
		const path = new URL(String(input)).pathname;
		if (init?.method === "POST" && path.endsWith("/agents")) {
			posts++;
			return Response.json({ id: "agent_known", version: 3, name: "batch agent" });
		}
		throw new Error("unexpected fixture request");
	});
	const t = await fixture("sdk");
	const draft = await t.create();
	await t.agent(draft);
	const confirmation = await t.plan(draft);
	const save = t.store.writeState.bind(t.store);
	let saves = 0;
	vi.spyOn(t.store, "writeState").mockImplementation((id, value) => {
		if (value.includes("agent_known") && ++saves > 1) throw new Error("private storage error");
		save(id, value);
	});
	const operation = await t.wait((await t.publish(draft, confirmation)).operation_id);
	expect(operation).toMatchObject({
		status: "failed",
		publication: {
			outcome: "unknown",
			mutation_started: true,
			resources: [{ status: "succeeded", remote_id: "agent_known", version: 3 }],
		},
		error_details: { code: "publication.state_persist_failed", phase: "persist_state", mutation_started: true },
	});
	expect(JSON.stringify(operation)).not.toContain("private storage error");
	expect(t.store.document(draft.draft_id)?.proof_json).toBeNull();
	const persisted = operation.publication;
	t.restart();
	expect(t.services.operations.get(operation.operation_id)?.publication).toEqual(persisted);
	expect(await t.value(`/api/admin/resource-drafts/${draft.draft_id}`)).toMatchObject({
		recovery_action: "read_result",
	});
	expect((await t.request(`${t.base(draft)}/plan`, "POST", { action: "publish" })).status).toBe(409);
	expect((await t.request(`/api/admin/resource-drafts/${draft.draft_id}/finalize`, "POST")).status).toBe(409);
	expect(posts).toBe(1);
});

it("新增结果列兼容历史 Operation；重启保留已知结果并标记中断，不能从报告恢复成功", async () => {
	const t = await fixture();
	const store = t.services.operations;
	store.create({ operationId: "legacy", kind: "resourceDraft.publish" });
	store.update("legacy", { status: "failed", error: "legacy message" });
	store.create({ operationId: "interrupted", kind: "resourceDraft.publish" });
	const report = {
		outcome: "succeeded" as const,
		mutation_started: true,
		resources: [
			{ type: "agent" as const, id: "main", status: "succeeded" as const, remote_id: "agent_known", version: 2 },
		],
	};
	store.update("interrupted", { status: "running", publication: report });
	t.restart();
	expect(t.services.operations.get("legacy")).toMatchObject({ status: "failed", error: "legacy message" });
	expect(t.services.operations.get("legacy")).not.toHaveProperty("publication");
	expect(t.services.operations.get("legacy")).not.toHaveProperty("error_details");
	expect(t.services.operations.get("interrupted")).toMatchObject({
		status: "failed",
		phase: "interrupted",
		publication: report,
		error_details: { phase: "interrupted", mutation_started: true, retryable: false },
	});
});
