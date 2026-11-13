import type { ResourceDraftDeclaration } from "@openagentpack/kit-sdk/protocol";
import { expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { fixture } from "./helpers/yaml-draft.ts";

it("环境编辑与预览拒绝明文凭据，拒绝后声明、revision 和已有计划不变", async () => {
	const t = await fixture();
	const draft = await t.create();
	const base = t.base(draft);
	const { environment } = await t.value<{ environment: { id: string } }>(`${base}/environments`, "POST", {
		base_revision: "1",
		name: "safe environment",
	});
	const before = t.store.document(draft.draft_id)!;
	const confirmation = await t.plan(draft);
	for (const key of ["api_key", "credentials", "secret_name"]) {
		const declaration = {
			name: "safe environment",
			config: { type: "cloud" },
			metadata: { [key]: "fixture-only-secret" },
		};
		for (const [suffix, method, body] of [
			["/preview", "POST", { action: "update", base_revision: "2", declaration }],
			["", "PUT", { base_revision: "2", declaration }],
		] as const) {
			const response = await t.request(`${base}/declarations/environment/${environment.id}${suffix}`, method, body);
			expect(response.status).toBe(400);
			expect(await response.text()).not.toContain("fixture-only-secret");
			expect(t.store.document(draft.draft_id)).toEqual(before);
		}
	}
	const read = await t.value(`${base}/declarations`);
	expect(JSON.stringify(read)).not.toContain("fixture-only-secret");
	const operation = await t.publish(draft, confirmation);
	expect((await t.wait(operation.operation_id)).status).toBe("succeeded");
});

it.each([
	{ label: "Agent 指令", type: "agent", changes: { instructions: 'api_key="fixture-only-secret"' } },
	{
		label: "数组中的敏感元数据",
		type: "memory_store",
		changes: { metadata: { nested: [{ authorization: "fixture-only-secret" }] } },
	},
	{
		label: "记忆条目正文",
		type: "memory_store",
		changes: { entries: [{ key: "note", content: '{"token":"fixture-only-secret"}' }] },
	},
])("$label 不能通过通用编辑接口绕过凭据校验", async ({ type, changes }) => {
	const t = await fixture();
	const draft = await t.create();
	const created =
		type === "agent"
			? (await t.agent(draft)).agent
			: (
					await t.value<{ memory_store: { id: string } }>(`${t.base(draft)}/memory-stores`, "POST", {
						base_revision: "1",
						name: "memory",
					})
				).memory_store;
	const path = `${t.base(draft)}/declarations/${type}/${created.id}`;
	const source = await t.value<ResourceDraftDeclaration>(path);
	const before = t.store.document(draft.draft_id);
	const response = await t.request(path, "PUT", {
		base_revision: source.base_revision,
		declaration: { ...source.declaration, ...changes },
	});
	expect(response.status).toBe(400);
	expect(await response.text()).not.toContain("fixture-only-secret");
	expect(t.store.document(draft.draft_id)).toEqual(before);
});

it("历史声明中的敏感字段在单项、列表和预览中脱敏，安全引用及正常编辑仍可使用", async () => {
	const t = await fixture();
	const draft = await t.create();
	const base = t.base(draft);
	const { environment } = await t.value<{ environment: { id: string } }>(`${base}/environments`, "POST", {
		base_revision: "1",
		name: "environment",
	});
	const row = t.store.document(draft.draft_id)!;
	// 模拟旧版本曾接受的声明；读取不能继续将其正文交付浏览器。
	const raw = parse(row.yaml);
	raw.environments[environment.id].metadata = {
		api_key: "fixture-only-secret",
		description: 'token="fixture-text-secret"',
	};
	t.store.writeDocument(draft.draft_id, "2", stringify(raw));
	const path = `${base}/declarations/environment/${environment.id}`;
	const source = await t.value<ResourceDraftDeclaration>(path);
	expect(source.declaration.metadata).toEqual({ api_key: "[redacted]", description: 'token="[redacted]"' });
	expect(source.read_only_paths).toContainEqual(["metadata", "api_key"]);
	expect(JSON.stringify(await t.value(`${base}/declarations`))).not.toContain("fixture-only-secret");
	const declaration = {
		name: "renamed",
		config: { type: "cloud" },
		metadata: { api_key: `\${SERVICE_KEY}`, note: "normal" },
	};
	const preview = await t.value<{ before: string; after: string; can_commit: boolean }>(`${path}/preview`, "POST", {
		base_revision: "3",
		action: "update",
		declaration,
	});
	expect(preview.can_commit).toBe(true);
	expect(JSON.stringify(preview)).not.toMatch(/fixture-(?:only|text)-secret/);
	await t.value(path, "PUT", { base_revision: "3", declaration });
	expect((await t.value<ResourceDraftDeclaration>(path)).declaration).toEqual(declaration);
	expect(t.store.document(draft.draft_id)!.yaml).not.toMatch(/fixture-(?:only|text)-secret/);
});

it("Vault 改名保留脱敏凭据对应的内存值，普通正文和环境变量引用保持原文", async () => {
	const t = await fixture();
	const draft = await t.create();
	const { vault } = await t.value<{ vault: { id: string } }>(`${t.base(draft)}/vaults`, "POST", {
		base_revision: "1",
		display_name: "vault",
		credentials: [
			{
				name: "service",
				secret_name: "SERVICE_TOKEN",
				secret_value: "fixture-vault-value",
				allowed_hosts: ["api.example.com"],
				acknowledged: true,
			},
		],
	});
	const path = `${t.base(draft)}/declarations/vault/${vault.id}`;
	const source = await t.value<ResourceDraftDeclaration>(path);
	await t.value(path, "PUT", {
		base_revision: source.base_revision,
		declaration: { ...source.declaration, display_name: "renamed vault" },
	});
	const prompt = `/literal prompt \${PROMPT}\nhttps://example.com/?page=2`;
	const created = await t.agent(draft, prompt);
	expect(
		(await t.value<ResourceDraftDeclaration>(`${t.base(draft)}/declarations/agent/${created.agent.id}`)).declaration
			.instructions,
	).toBe(prompt);
	expect(JSON.stringify(t.store.document(draft.draft_id))).not.toContain("fixture-vault-value");
	expect(JSON.stringify(await t.value(`${t.base(draft)}/declarations`))).not.toContain("fixture-vault-value");
	const operation = await t.publish(draft, await t.plan(draft));
	expect((await t.wait(operation.operation_id)).status).toBe("succeeded");
});
