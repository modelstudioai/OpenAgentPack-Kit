import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setDefaultFetch } from "@openagentpack/sdk";
import { expect, it, vi } from "vitest";
import { fixture } from "./helpers/yaml-draft.ts";

it("旧目录批次原样归档并释放活动名额，YAML 记录和磁盘文件保留且不请求远端", async () => {
	const t = await fixture();
	const yaml = await t.create();
	await t.agent(yaml);
	const before = t.store.document(yaml.draft_id);
	const legacyId = `draft_${"b".repeat(32)}`;
	const legacyRoot = join(t.root, "resource-draft-projects", legacyId);
	await mkdir(legacyRoot, { recursive: true });
	await writeFile(join(legacyRoot, "state.json"), "original legacy state");
	t.db
		.prepare(
			"INSERT INTO kit_resource_drafts (draft_id,owner,status,phase,resources_json,cleanup_pending,created_at,updated_at,engine) VALUES (?,?,'failed','uncertain',?,1,'old','old','directory')",
		)
		.run(legacyId, "legacy-owner", '[{"remote_id":"already-created"}]');
	t.db
		.prepare("INSERT INTO kit_resource_draft_documents (draft_id,yaml,proof_json) VALUES (?,? ,?)")
		.run(legacyId, "original declaration", "original proof");
	const original = t.db.prepare("SELECT * FROM kit_resource_drafts WHERE draft_id=?").get(legacyId);
	t.db.exec("DROP TABLE kit_retired_directory_drafts");
	t.db.prepare("DELETE FROM _kit_migrations WHERE id=?").run("031_retire_directory_drafts");
	const network = vi.fn(async () => {
		throw new Error("migration must be local");
	});
	setDefaultFetch(network);
	t.restart();
	const archive = t.db.prepare("SELECT * FROM kit_retired_directory_drafts WHERE draft_id=?").get(legacyId)!;
	expect(JSON.parse(String(archive.record_json))).toEqual(original);
	expect(JSON.parse(String(archive.document_json))).toMatchObject({
		yaml: "original declaration",
		proof_json: "original proof",
	});
	expect(t.store.get(legacyId)).toBeNull();
	expect(t.store.active("legacy-owner")).toBeNull();
	expect(t.store.create(`draft_${"c".repeat(32)}`, "legacy-owner").owner).toBe("legacy-owner");
	expect(t.store.document(yaml.draft_id)).toEqual(before);
	expect(await readFile(join(legacyRoot, "state.json"), "utf8")).toBe("original legacy state");
	expect((await t.request(`/api/admin/resource-drafts/${legacyId}`)).status).toBe(404);
	for (const path of [
		"/api/admin/projects",
		"/api/admin/projects/main",
		"/api/admin/projects/main/agents/assistant/debug-sessions",
	])
		expect((await t.request(path)).status).toBe(404);
	t.restart();
	expect(t.db.prepare("SELECT count(*) AS n FROM kit_retired_directory_drafts").get()?.n).toBe(1);
	expect(t.store.document(yaml.draft_id)).toEqual(before);
	expect(network).not.toHaveBeenCalled();
});

it("SDK 使用显式 MA 凭据与 Vault 值，忽略全局环境且持久化记录不含明文", async () => {
	vi.stubEnv("DASHSCOPE_API_KEY", "unrelated-global-key");
	vi.stubEnv("BAILIAN_BASE_URL", "https://wrong.invalid");
	const t = await fixture("sdk");
	const savedStates: string[] = [];
	const writeState = t.store.writeState.bind(t.store);
	vi.spyOn(t.store, "writeState").mockImplementation((id, state) => {
		savedStates.push(state);
		writeState(id, state);
	});
	const calls: { url: string; method: string; authorization: string | null; body: Record<string, unknown> }[] = [];
	setDefaultFetch(async (input, init) => {
		const url = String(input);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({
			url,
			method: init?.method ?? "GET",
			authorization: new Headers(init?.headers).get("authorization"),
			body,
		});
		return Response.json({
			id: url.includes("credentials") ? "credential_fixture" : "vault_fixture",
			name: "fixture vault",
			display_name: "fixture vault",
			version: 1,
			status: "active",
			data: [],
		});
	});
	const draft = await t.create();
	const secret = `literal-secret-\${UNCHANGED_REFERENCE}`;
	await t.value(`${t.base(draft)}/vaults`, "POST", {
		base_revision: await t.revision(draft),
		display_name: "fixture vault",
		credentials: [
			{
				name: "service",
				secret_name: "SERVICE_TOKEN",
				secret_value: secret,
				allowed_hosts: ["api.example.com"],
				acknowledged: true,
			},
		],
	});
	const before = JSON.stringify(t.store.document(draft.draft_id));
	expect(before).not.toContain(secret);
	const confirmation = await t.plan(draft);
	const operation = await t.publish(draft, confirmation);
	expect((await t.wait(operation.operation_id)).status).toBe("succeeded");
	expect(calls.some((call) => JSON.stringify(call.body).includes(secret))).toBe(true);
	expect(calls.every((call) => call.url.startsWith("https://fixtures.invalid/api/v1/agentstudio/"))).toBe(true);
	expect(calls.every((call) => call.authorization === "Bearer fixture-provider-secret")).toBe(true);
	expect(savedStates.some((state) => state.includes("vault_fixture"))).toBe(true);
	expect(savedStates.join("")).not.toContain(secret);
	expect(savedStates.join("")).not.toContain("fixture-provider-secret");
	for (const table of ["kit_resource_drafts", "kit_resource_draft_documents", "kit_operations", "kit_audit"])
		expect(JSON.stringify(t.db.prepare(`SELECT * FROM ${table}`).all())).not.toContain(secret);
	expect(process.env.DASHSCOPE_API_KEY).toBe("unrelated-global-key");
	expect(process.env.BAILIAN_BASE_URL).toBe("https://wrong.invalid");
});

it("密钥引用不能跨批次或回退全局环境，丢弃只释放本批，重启后缺值阻断发布", async () => {
	const first = await fixture();
	const second = await fixture();
	const a = await first.create();
	const b = await second.create();
	for (const [t, draft, secret] of [
		[first, a, "first-value"],
		[second, b, "second-value"],
	] as const)
		await t.value(`${t.base(draft)}/vaults`, "POST", {
			base_revision: await t.revision(draft),
			display_name: "service vault",
			credentials: [
				{
					name: "service",
					secret_name: "SERVICE_TOKEN",
					secret_value: secret,
					allowed_hosts: ["api.example.com"],
					acknowledged: true,
				},
			],
		});
	const docA = first.store.document(a.draft_id)!;
	const docB = second.store.document(b.draft_id)!;
	const refA = docA.yaml.match(/\$\{KIT_VAULT_[A-F0-9]+\}/)![0];
	const refB = docB.yaml.match(/\$\{KIT_VAULT_[A-F0-9]+\}/)![0];
	vi.stubEnv(refA.slice(2, -1), "global-must-not-resolve");
	second.store.writeDocument(b.draft_id, String(docB.revision), docB.yaml.replace(refB, refA));
	expect((await second.request(`${second.base(b)}/plan`, "POST", { action: "publish" })).status).toBe(400);
	const changed = second.store.document(b.draft_id)!;
	second.store.writeDocument(b.draft_id, String(changed.revision), docB.yaml);
	await first.value(`/api/admin/resource-drafts/${a.draft_id}/discard`, "POST");
	await second.plan(b);
	second.restart();
	expect((await second.request(`${second.base(b)}/plan`, "POST", { action: "publish" })).status).toBe(400);
});
