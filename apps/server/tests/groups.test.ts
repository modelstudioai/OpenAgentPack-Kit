import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GroupView, MemberLoginResult, MemberView, PlanResponse } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	for (const close of cleanup.splice(0).reverse()) close();
});

function setup() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-groups-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "group-admin-token",
		KIT_ADMIN_TOKENS: "group-auditor-token:auditor,other-admin-token:admin",
		KIT_RATE_LIMIT_RPS: "1000",
		KIT_RATE_LIMIT_BURST: "1000",
	});
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(config, db);
	return { app: createApp(services), services, config, dataDir };
}

type App = ReturnType<typeof setup>["app"];
const password = "Private!Password2026";
const adminToken = "group-admin-token";
const missingMember = "member_00000000-0000-4000-8000-000000000000";
const missingGroup = "group_00000000-0000-4000-8000-000000000000";

function request(app: App, path: string, method = "GET", body?: unknown, token = adminToken) {
	return app.request(path, {
		method,
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function data<T>(response: Response, status = 200): Promise<T> {
	const result = await response.json();
	expect(response.status, JSON.stringify(result)).toBe(status);
	return (result as { data: T }).data;
}

async function page<T>(app: App, path: string): Promise<{ data: T[]; next_page_token?: string }> {
	const response = await request(app, path);
	expect(response.status).toBe(200);
	return response.json() as Promise<{ data: T[]; next_page_token?: string }>;
}

async function group(app: App, name: string) {
	return data<GroupView>(await request(app, "/api/admin/groups", "POST", { name }), 201);
}

async function member(app: App, username = "alice") {
	return (
		await data<{ member: MemberView }>(
			await request(app, "/api/admin/members", "POST", {
				username,
				display_name: username,
				auth_type: "local",
				password_mode: "custom",
				password,
			}),
			201,
		)
	).member;
}

const groupPath = (id: string) => `/api/admin/groups/${id}`;
const memberGroupsPath = (id: string) => `/api/admin/members/${id}/groups`;
const groupMembersPath = (id: string) => `${groupPath(id)}/members`;
const plan = async (app: App, id: string) =>
	data<PlanResponse>(await request(app, `${groupPath(id)}/plan`, "POST", { action: "delete" }));
const confirmation = (value: PlanResponse) => ({ plan_id: value.plan_id, confirm_token: value.confirm_token });

describe("用户组目录与成员关系", () => {
	it("名称规范化、并发唯一性、编辑冲突和重启后的分页搜索", async () => {
		const { app, config, dataDir } = setup();
		const created = await Promise.all([
			request(app, "/api/admin/groups", "POST", { name: " 团队_one ", description: " 第一组 " }),
			request(app, "/api/admin/groups", "POST", { name: "团队_one" }),
		]);
		expect(created.map((response) => response.status).sort()).toEqual([201, 409]);
		const first = await data<GroupView>(created.find((response) => response.status === 201) as Response, 201);
		expect(first).toMatchObject({ name: "团队_one", member_count: 0 });
		const second = await group(app, "团队_two");
		await group(app, "团队Xthree");
		expect((await request(app, groupPath(second.group_id), "PATCH", { name: " 团队_one " })).status).toBe(409);
		const edited = await data<GroupView>(
			await request(app, groupPath(second.group_id), "PATCH", { name: "团队_two", description: "变更后的描述" }),
		);
		expect(edited).toMatchObject({ group_id: second.group_id, description: "变更后的描述" });
		expect((await request(app, "/api/admin/groups", "POST", { name: "  " })).status).toBe(400);
		const reopenedDb = openDatabase(dataDir);
		cleanup.push(() => reopenedDb.close());
		const reopened = createApp(createKitServices(config, reopenedDb));
		const query = `/api/admin/groups?search=${encodeURIComponent("团队_")}&limit=1`;
		const one = await page<GroupView>(reopened, query);
		expect(one.data).toHaveLength(1);
		expect(one.next_page_token).toBeTruthy();
		const two = await page<GroupView>(reopened, `${query}&page_token=${one.next_page_token}`);
		expect(two.data).toHaveLength(1);
		expect(two.next_page_token).toBeUndefined();
		expect(new Set([...one.data, ...two.data].map((row) => row.group_id))).toEqual(
			new Set([first.group_id, second.group_id]),
		);
		expect((await request(reopened, `/api/admin/groups?search=other&page_token=${one.next_page_token}`)).status).toBe(
			400,
		);
		expect((await request(reopened, "/api/admin/groups?page_token=malformed")).status).toBe(400);
		expect((await page<GroupView>(reopened, "/api/admin/groups?search=missing")).data).toEqual([]);
	});

	it("两侧编辑同一多对多关系；分页选择、重复提交和任一无效 ID 都不会误改其他关系", async () => {
		const { app, config, dataDir } = setup();
		const alice = await member(app);
		const bob = await member(app, "bob");
		const first = await group(app, "研发组");
		const second = await group(app, "产品组");
		const addBoth = { add_member_ids: [alice.member_id, bob.member_id] };
		for (let attempt = 0; attempt < 2; attempt++) {
			expect(
				(await data<GroupView>(await request(app, groupMembersPath(first.group_id), "PATCH", addBoth))).member_count,
			).toBe(2);
		}
		await data(await request(app, memberGroupsPath(alice.member_id), "PATCH", { add_group_ids: [second.group_id] }));
		const aliceGroups = await page<GroupView>(app, memberGroupsPath(alice.member_id));
		expect(new Set(aliceGroups.data.map((row) => row.group_id))).toEqual(new Set([first.group_id, second.group_id]));
		const firstPage = await page<MemberView>(app, `${groupMembersPath(first.group_id)}?limit=1`);
		expect(firstPage.next_page_token).toBeTruthy();
		const nextPage = await page<MemberView>(
			app,
			`${groupMembersPath(first.group_id)}?limit=1&page_token=${firstPage.next_page_token}`,
		);
		expect(new Set([...firstPage.data, ...nextPage.data].map((row) => row.member_id))).toEqual(
			new Set([alice.member_id, bob.member_id]),
		);
		expect(
			(await request(app, `${groupMembersPath(second.group_id)}?page_token=${firstPage.next_page_token}`)).status,
		).toBe(400);
		const candidates = await page<MemberView & { is_member: boolean }>(
			app,
			`${groupMembersPath(second.group_id)}?membership=all&search=bob`,
		);
		expect(candidates.data).toMatchObject([{ member_id: bob.member_id, is_member: false }]);
		const invalidMember = await request(app, groupMembersPath(first.group_id), "PATCH", {
			add_member_ids: [missingMember],
			remove_member_ids: [alice.member_id],
		});
		expect(invalidMember.status).toBe(404);
		const invalidGroup = await request(app, memberGroupsPath(alice.member_id), "PATCH", {
			add_group_ids: [missingGroup],
			remove_group_ids: [first.group_id],
		});
		expect(invalidGroup.status).toBe(404);
		expect((await page<GroupView>(app, memberGroupsPath(alice.member_id))).data).toHaveLength(2);
		expect(
			(
				await request(app, groupMembersPath(first.group_id), "PATCH", {
					add_member_ids: [alice.member_id],
					remove_member_ids: [alice.member_id],
				})
			).status,
		).toBe(400);
		await data(await request(app, memberGroupsPath(alice.member_id), "PATCH", { remove_group_ids: [first.group_id] }));
		expect((await page<MemberView>(app, groupMembersPath(first.group_id))).data.map((row) => row.member_id)).toEqual([
			bob.member_id,
		]);
		const summary = await page<MemberView & { groups: { group_id: string }[] }>(app, "/api/admin/members?search=alice");
		expect(summary.data[0]?.groups.map((row) => row.group_id)).toEqual([second.group_id]);
		const reopenedDb = openDatabase(dataDir);
		cleanup.push(() => reopenedDb.close());
		const restarted = createApp(createKitServices(config, reopenedDb));
		expect(
			(await page<GroupView>(restarted, memberGroupsPath(alice.member_id))).data.map((row) => row.group_id),
		).toEqual([second.group_id]);
	});
});

describe("用户组管理权限与删除确认", () => {
	it("auditor 能读取已存在的组和成员关系，但所有写入口都被统一拒绝", async () => {
		const { app } = setup();
		const alice = await member(app);
		const existing = await group(app, "已有组");
		await data(await request(app, groupMembersPath(existing.group_id), "PATCH", { add_member_ids: [alice.member_id] }));
		for (const path of [
			"/api/admin/groups",
			groupPath(existing.group_id),
			groupMembersPath(existing.group_id),
			memberGroupsPath(alice.member_id),
		]) {
			const read = await request(app, path, "GET", undefined, "group-auditor-token");
			expect(read.status).toBe(200);
			expect(await read.text()).toContain(path.endsWith("/members") ? alice.member_id : existing.group_id);
		}
		for (const [path, method, body] of [
			["/api/admin/groups", "POST", { name: "不允许创建" }],
			[groupPath(existing.group_id), "PATCH", { name: "不允许编辑" }],
			[`${groupPath(existing.group_id)}/plan`, "POST", { action: "delete" }],
			[groupPath(existing.group_id), "DELETE", {}],
			[groupMembersPath(existing.group_id), "PATCH", { remove_member_ids: [alice.member_id] }],
			[memberGroupsPath(alice.member_id), "PATCH", { remove_group_ids: [existing.group_id] }],
		] as const) {
			expect((await request(app, path, method, body, "group-auditor-token")).status).toBe(403);
		}
		expect((await app.request("/api/admin/groups")).status).toBe(401);
		expect((await request(app, "/api/admin/groups", "GET", undefined, "invalid-token")).status).toBe(403);
		expect((await data<GroupView>(await request(app, groupPath(existing.group_id)))).member_count).toBe(1);
	});

	it("删除必须重新确认当前影响，成功后只删除组关系并拒绝重放；账号、登录和 Agent 访问保留", async () => {
		const { app, services } = setup();
		const alice = await member(app);
		const existing = await group(app, "将被删除的组");
		services.catalog.upsert({ slug: "assistant", display_name: "助手", remote_agent_id: "agent_mock" });
		services.catalog.setStatus("assistant", "listed");
		const login = async () =>
			data<MemberLoginResult>(
				await app.request("/api/kit/auth/login", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ username: "alice", password }),
				}),
			);
		const before = await login();
		expect((await request(app, "/api/kit/agents", "GET", undefined, before.access_token)).status).toBe(200);
		const session = await data<{ session_id: string }>(
			await request(app, "/api/kit/sessions", "POST", { agent_slug: "assistant" }, before.access_token),
			201,
		);
		const initial = await plan(app, existing.group_id);
		expect(initial.destructive).toBe(true);
		expect(initial.diff.length).toBeGreaterThan(0);
		expect((await request(app, groupPath(existing.group_id), "DELETE", {})).status).toBe(428);
		expect(
			(
				await request(app, groupPath(existing.group_id), "DELETE", {
					...confirmation(initial),
					confirm_token: "forged",
				})
			).status,
		).toBe(428);
		expect(
			(await request(app, groupPath(existing.group_id), "DELETE", confirmation(initial), "other-admin-token")).status,
		).toBe(428);
		await data(await request(app, groupMembersPath(existing.group_id), "PATCH", { add_member_ids: [alice.member_id] }));
		expect((await request(app, groupPath(existing.group_id), "DELETE", confirmation(initial))).status).toBe(409);
		expect((await data<GroupView>(await request(app, groupPath(existing.group_id)))).member_count).toBe(1);
		const current = await plan(app, existing.group_id);
		await data(await request(app, groupPath(existing.group_id), "DELETE", confirmation(current)));
		expect((await request(app, groupPath(existing.group_id), "DELETE", confirmation(current))).status).toBe(428);
		expect((await request(app, groupPath(existing.group_id))).status).toBe(404);
		expect((await page<GroupView>(app, memberGroupsPath(alice.member_id))).data).toEqual([]);
		const after = await login();
		expect(after.member).toEqual(before.member);
		expect(after.member).not.toHaveProperty("groups");
		expect((await request(app, "/api/kit/agents", "GET", undefined, after.access_token)).status).toBe(200);
		expect(
			(await request(app, `/api/kit/sessions/${session.session_id}`, "GET", undefined, after.access_token)).status,
		).toBe(200);
		const recreated = await group(app, existing.name);
		expect(recreated.group_id).not.toBe(existing.group_id);
		expect(recreated.member_count).toBe(0);
		expect(services.audit.list()).toEqual([]);
	});

	it("过期删除计划被拒且保留组；重新生成计划可正常删除", async () => {
		const { app } = setup();
		const existing = await group(app, "过期测试组");
		const initial = await plan(app, existing.group_id);
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(Date.now() + 6 * 60_000);
		expect((await request(app, groupPath(existing.group_id), "DELETE", confirmation(initial))).status).toBe(428);
		expect((await request(app, groupPath(existing.group_id))).status).toBe(200);
		const fresh = await plan(app, existing.group_id);
		expect(await data(await request(app, groupPath(existing.group_id), "DELETE", confirmation(fresh)))).toMatchObject({
			deleted: true,
		});
	});

	it("确认令牌验证期间从用户侧新增成员关系，删除重新核对影响并保留组", async () => {
		const { app, services } = setup();
		const alice = await member(app);
		const existing = await group(app, "并发变更组");
		const reviewed = await plan(app, existing.group_id);
		let entered = () => {};
		let release = () => {};
		const validating = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		const consume = services.gate.consume.bind(services.gate);
		vi.spyOn(services.gate, "consume").mockImplementation(async (input) => {
			await consume(input);
			entered();
			await paused;
		});
		const deletion = request(app, groupPath(existing.group_id), "DELETE", confirmation(reviewed));
		await validating;
		try {
			await data(
				await request(app, memberGroupsPath(alice.member_id), "PATCH", { add_group_ids: [existing.group_id] }),
			);
		} finally {
			release();
		}
		expect((await deletion).status).toBe(409);
		expect((await data<GroupView>(await request(app, groupPath(existing.group_id)))).member_count).toBe(1);
		expect((await page<GroupView>(app, memberGroupsPath(alice.member_id))).data.map((row) => row.group_id)).toEqual([
			existing.group_id,
		]);
	});
});
