import type { ProjectPlan, ProjectResourceBindings } from "@openagentpack/kit-sdk/protocol";
import { setDefaultFetch } from "@openagentpack/sdk";
import { expect, it, vi } from "vitest";
import { fixture } from "./helpers/yaml-draft.ts";

it.each(["mock", "sdk"] as const)(
	"%s 空批次的只读计划为空，不写远端、不伪造发布回执，新增后旧计划失效",
	async (mode) => {
		const fetch = vi.fn(async () => {
			throw new Error("empty batch must not request Provider");
		});
		setDefaultFetch(fetch);
		const t = await fixture(mode);
		const draft = await t.create();
		const before = t.store.document(draft.draft_id);
		const confirmation = await t.value<ProjectPlan>(`${t.base(draft)}/plan`, "POST", { action: "publish" });
		expect(confirmation).toMatchObject({ project_revision: "1", diff: [], destructive: false });
		expect(t.store.document(draft.draft_id)).toEqual(before);
		const operation = await t.publish(draft, confirmation);
		expect(await t.wait(operation.operation_id)).toMatchObject({ status: "failed" });
		expect(await t.value(`/api/admin/resource-drafts/${draft.draft_id}`)).toMatchObject({
			status: "draft",
			resources: [],
		});
		expect(t.store.document(draft.draft_id)).toEqual(before);
		await t.agent(draft);
		expect((await t.request(`${t.base(draft)}/publish`, "POST", confirmation)).status).toBe(428);
		expect(fetch).not.toHaveBeenCalled();
	},
);

it("空声明仍有 SDK state 时拒绝生成计划，避免将残留绑定规划为删除", async () => {
	const fetch = vi.fn(async () => {
		throw new Error("empty batch must not request Provider");
	});
	setDefaultFetch(fetch);
	const t = await fixture("sdk");
	const draft = await t.create();
	t.store.writeState(
		draft.draft_id,
		JSON.stringify({
			resources: [
				{
					address: { provider: "bailian", type: "agent", name: "previous" },
					remote_id: "agent_previous",
					version: 1,
					content_hash: "fixture",
				},
			],
		}),
	);
	const before = t.store.document(draft.draft_id);
	expect((await t.request(`${t.base(draft)}/plan`, "POST", { action: "publish" })).status).toBe(409);
	expect(t.store.document(draft.draft_id)).toEqual(before);
	expect(fetch).not.toHaveBeenCalled();
});

it("绑定严格解析先验证全部声明存在，再仅校验所选项的身份与版本，不被其他未发布资源阻塞", async () => {
	const fetch = vi.fn(async () => {
		throw new Error("binding lookup must stay local");
	});
	setDefaultFetch(fetch);
	const t = await fixture("sdk");
	const draft = await t.create();
	const resolve = (resources: { type: string; id: string }[]) =>
		t.request(`${t.base(draft)}/resource-bindings/resolve`, "POST", { resources });
	expect((await resolve([{ type: "agent", id: "missing" }])).status).toBe(404);
	const agent = (await t.agent(draft)).agent;
	const { environment } = await t.value<{ environment: { id: string } }>(`${t.base(draft)}/environments`, "POST", {
		base_revision: "2",
		name: "unpublished environment",
	});
	// 已确认 Agent 声明确实存在，尚无绑定时拒绝；不存在的声明优先返回 404。
	expect((await resolve([{ type: "agent", id: agent.id }])).status).toBe(409);
	expect((await resolve([{ type: "agent", id: "missing" }])).status).toBe(404);
	expect(
		(
			await resolve([
				{ type: "environment", id: environment.id },
				{ type: "agent", id: "missing" },
			])
		).status,
	).toBe(404);
	const state = {
		resources: [
			{
				address: { provider: "bailian", type: "agent", name: agent.id },
				remote_id: "agent_binding_fixture",
				content_hash: "fixture",
			},
		],
	};
	t.store.writeState(draft.draft_id, JSON.stringify(state));
	expect((await resolve([{ type: "agent", id: agent.id }])).status).toBe(409);
	t.store.writeState(
		draft.draft_id,
		JSON.stringify({ resources: state.resources.map((resource) => ({ ...resource, version: 3 })) }),
	);
	const before = t.store.document(draft.draft_id);
	const response = await resolve([{ type: "agent", id: agent.id }]);
	expect(response.status).toBe(200);
	expect((await response.json()) as { data: ProjectResourceBindings }).toEqual({
		data: { resources: [{ type: "agent", id: agent.id, remote_id: "agent_binding_fixture", version: 3 }] },
	});
	expect(
		(
			await resolve([
				{ type: "agent", id: agent.id },
				{ type: "environment", id: environment.id },
			])
		).status,
	).toBe(409);
	expect(t.store.document(draft.draft_id)).toEqual(before);
	expect(fetch).not.toHaveBeenCalled();
});
