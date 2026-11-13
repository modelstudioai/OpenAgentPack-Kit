import { mkdirSync, symlinkSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { fixture } from "./helpers/yaml-draft.ts";

it("放弃批次等待在途本地保存，期间拒绝新请求；迟到保存不能复活已清理批次", async () => {
	const t = await fixture();
	let entered!: () => void;
	let release!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const factory = t.services.gateway.resourceDraftDocument.bind(t.services.gateway);
	vi.spyOn(t.services.gateway, "resourceDraftDocument").mockImplementation((...args) => {
		const gateway = factory(...args);
		const create = gateway.createEnvironment.bind(gateway);
		gateway.createEnvironment = async (input) => {
			entered();
			await blocked;
			return create(input);
		};
		return gateway;
	});
	const draft = await t.create();
	const revision = await t.revision(draft);
	const pending = t.request(`${t.base(draft)}/environments`, "POST", {
		base_revision: revision,
		name: "late environment",
	});
	await started;
	const discard = t.request(`/api/admin/resource-drafts/${draft.draft_id}/discard`, "POST");
	await vi.waitFor(async () => expect((await t.request(t.base(draft))).status).toBe(409));
	expect(
		(await t.request(`${t.base(draft)}/environments`, "POST", { base_revision: revision, name: "must reject" })).status,
	).toBe(409);
	release();
	await pending;
	expect((await discard).status).toBe(200);
	expect((await t.request(`/api/admin/resource-drafts/${draft.draft_id}`)).status).toBe(404);
	const fresh = await t.create();
	expect(fresh.draft_id).not.toBe(draft.draft_id);
	expect(await t.value(`${t.base(fresh)}/declarations`)).toEqual([]);
});

it("确认闸门拒绝未审阅令牌，清理失败保留成功回执，修复暂存后只收尾不重新发布", async () => {
	const t = await fixture();
	let executions = 0;
	const factory = t.services.gateway.resourceDraftDocument.bind(t.services.gateway);
	vi.spyOn(t.services.gateway, "resourceDraftDocument").mockImplementation((...args) => {
		const gateway = factory(...args);
		const execute = gateway.execute.bind(gateway);
		gateway.execute = (...input) => {
			executions++;
			return execute(...input);
		};
		return gateway;
	});
	const draft = await t.create();
	await t.agent(draft);
	expect(
		(await t.request(`${t.base(draft)}/publish`, "POST", { plan_id: "unreviewed", confirm_token: "invalid" })).status,
	).toBe(428);
	expect(executions).toBe(0);
	const outside = join(t.root, "outside");
	await mkdir(outside);
	await writeFile(join(outside, "keep.txt"), "keep");
	const assets = join(t.root, "resource-draft-uploads", draft.draft_id);
	const receipt = t.store.receipt.bind(t.store);
	vi.spyOn(t.store, "receipt").mockImplementation((...args) => {
		receipt(...args);
		mkdirSync(join(t.root, "resource-draft-uploads"), { recursive: true });
		symlinkSync(outside, assets, "dir");
	});
	const operation = await t.publish(draft, await t.plan(draft));
	expect(await t.wait(operation.operation_id)).toMatchObject({
		status: "failed",
		publication: { outcome: "succeeded" },
		error_details: { phase: "cleanup", mutation_started: true },
	});
	expect(t.store.get(draft.draft_id)).toMatchObject({ status: "published", cleanup_pending: 1 });
	expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
	await unlink(assets);
	await t.value(`/api/admin/resource-drafts/${draft.draft_id}/finalize`, "POST");
	expect(t.store.get(draft.draft_id)).toMatchObject({ status: "published", cleanup_pending: 0 });
	expect(t.store.document(draft.draft_id)).toBeUndefined();
	expect(executions).toBe(1);
	expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
});
