import "@hono/zod-openapi";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteSkillReference } from "@openagentpack/kit-sdk/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createMockRemoteSkillGateway } from "../src/gateway/mock-remote-skills.ts";
import { createKitServices } from "../src/services/index.ts";
import { validateRemoteSkillReferences } from "../src/services/remote-skills.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
	vi.restoreAllMocks();
});

it("保存校验空选择零调用、相同版本去重；来源不符/失效/不存在拒绝", async () => {
	const gateway = createMockRemoteSkillGateway();
	const spy = vi.spyOn(gateway, "getRemoteSkillVersion");
	await validateRemoteSkillReferences(gateway, []);
	expect(spy).not.toHaveBeenCalled();
	const reference: RemoteSkillReference = { type: "official", skill_id: "skill_mock_research", version: "1.0" };
	await validateRemoteSkillReferences(gateway, [reference, reference]);
	expect(spy).toHaveBeenCalledTimes(1);
	await expect(validateRemoteSkillReferences(gateway, [{ ...reference, type: "custom" }])).rejects.toMatchObject({
		code: "invalid_request",
	});
	await expect(
		validateRemoteSkillReferences(gateway, [{ type: "custom", skill_id: "skill_mock_checking", version: "1.0" }]),
	).rejects.toMatchObject({ code: "invalid_request" });
	await expect(validateRemoteSkillReferences(gateway, [{ ...reference, version: "missing" }])).rejects.toMatchObject({
		code: "not_found",
	});
	spy.mockClear();
	await expect(validateRemoteSkillReferences(gateway, [{ ...reference, version: "latest" }])).rejects.toMatchObject({
		code: "invalid_request",
	});
	expect(spy).not.toHaveBeenCalled();
});

it("管理员和auditor可读既有候选，未认证和非法来源不可访问，不增加远端资源或写入审计", async () => {
	const dataDir = await mkdtemp(join(tmpdir(), "kit-remote-skills-"));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "skill-admin",
		KIT_ADMIN_TOKENS: "skill-auditor:auditor",
		KIT_RATE_LIMIT_RPS: "0",
	});
	const db = openDatabase(dataDir);
	cleanup.push(async () => {
		db.close();
		await rm(dataDir, { recursive: true, force: true });
	});
	const services = createKitServices(config, db);
	const app = createApp(services);
	const before = await services.gateway.listRemoteSkills("official");
	expect(before).toContainEqual(expect.objectContaining({ skill_id: "skill_mock_research", available: true }));
	const audit = services.audit.list();
	for (const token of ["skill-admin", "skill-auditor"]) {
		const response = await app.request("/api/admin/remote/skills?source=official", {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({ data: before });
	}
	expect((await app.request("/api/admin/remote/skills?source=official")).status).toBe(401);
	const spy = vi.spyOn(services.gateway, "listRemoteSkills");
	expect(
		(await app.request("/api/admin/remote/skills?source=unknown", { headers: { authorization: "Bearer skill-admin" } }))
			.status,
	).toBe(400);
	expect(spy).not.toHaveBeenCalled();
	expect(await services.gateway.listRemoteSkills("official")).toEqual(before);
	expect(services.audit.list()).toEqual(audit);
});
