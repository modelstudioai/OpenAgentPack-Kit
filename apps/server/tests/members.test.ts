import { scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CreateMemberRequestSchema,
	type CreateMemberResponse,
	type MembersPage,
} from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const close of cleanup.splice(0).reverse()) close();
});

function makeApp() {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-members-"));
	cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
		KIT_ADMIN_TOKENS: "audit-token:auditor",
	});
	const db = openDatabase(dataDir);
	cleanup.push(() => db.close());
	const services = createKitServices(config, db);
	return { app: createApp(services), services, db, dataDir, config };
}

const admin = { authorization: "Bearer admin-token", "content-type": "application/json" };
const auditor = { authorization: "Bearer audit-token", "content-type": "application/json" };
const autoInput = { username: "alice", display_name: "Alice", auth_type: "local", password_mode: "auto" };

function create(app: ReturnType<typeof makeApp>["app"], input: unknown = autoInput, headers = admin) {
	return app.request("/api/admin/members", { method: "POST", headers, body: JSON.stringify(input) });
}

describe("成员创建与凭据隔离", () => {
	it("自动密码仅创建响应展示一次；数据库只存可验证的加盐派生值，目录与审计无密码", async () => {
		const { app, services, db } = makeApp();
		const input = { ...autoInput, username: " Alice ", display_name: " 艾丽丝 ", email: " alice@example.com " };
		const response = await create(app, input);
		expect(response.status).toBe(201);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const { data } = (await response.json()) as CreateMemberResponse;
		expect(data.member).toMatchObject({
			username: "alice",
			display_name: "艾丽丝",
			email: "alice@example.com",
			auth_type: "local",
			status: "active",
		});
		expect(data.initial_password).toHaveLength(20);
		expect(
			CreateMemberRequestSchema.safeParse({ ...autoInput, password_mode: "custom", password: data.initial_password })
				.success,
		).toBe(true);
		const row = db.prepare("SELECT * FROM kit_members").get() as { password_hash: string };
		expect(JSON.stringify(row)).not.toContain(data.initial_password);
		const [algorithm, n, r, p, salt, hash] = row.password_hash.split("$");
		expect(algorithm).toBe("scrypt");
		expect(salt).toHaveLength(32);
		const derived = scryptSync(data.initial_password as string, salt as string, 64, {
			N: Number(n),
			r: Number(r),
			p: Number(p),
			maxmem: 64 * 1024 * 1024,
		});
		expect(derived.toString("hex")).toBe(hash);
		const listed = await app.request("/api/admin/members", { headers: admin });
		const listBody = await listed.text();
		expect(listBody).not.toContain(data.initial_password);
		expect(listBody).not.toContain("password");
		expect(JSON.parse(listBody).data).toEqual([expect.objectContaining(data.member)]);
		expect(services.audit.list()).toEqual([]);
	});

	it("成员深链按 ID 读取公开资料，拒绝未认证访问并区分不存在的成员", async () => {
		const { app } = makeApp();
		const created = await create(app);
		const { data } = (await created.json()) as CreateMemberResponse;
		const path = `/api/admin/members/${data.member.member_id}`;
		for (const headers of [admin, auditor]) {
			const response = await app.request(path, { headers });
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(await response.json()).toEqual({ data: data.member });
		}
		expect((await app.request(path)).status).toBe(401);
		expect((await app.request("/api/admin/members/missing", { headers: admin })).status).toBe(404);
	});

	it("自定义密码不回显；同一密码产生不同盐，用户名大小写重复并发创建只有一个成功", async () => {
		const { app, db } = makeApp();
		const password = "Unique!Pass2026";
		const input = { ...autoInput, password_mode: "custom", password };
		const responses = await Promise.all([create(app, input), create(app, { ...input, username: "ALICE" })]);
		expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
		for (const response of responses) {
			const body = await response.text();
			expect(body).not.toContain(password);
			expect(body).not.toContain("initial_password");
		}
		expect((await create(app, { ...input, username: "bob" })).status).toBe(201);
		const rows = db.prepare("SELECT password_hash FROM kit_members").all() as { password_hash: string }[];
		expect(rows).toHaveLength(2);
		expect(rows[0]?.password_hash).not.toBe(rows[1]?.password_hash);
	});

	it.each([
		{ username: "ab" },
		{ username: "bad username" },
		{ display_name: "  " },
		{ email: "not-an-email" },
		{ password_mode: "custom", password: "short" },
		{ password_mode: "custom", password: "LongButNoNumber!" },
		{ password_mode: "custom", password: "ALICE!Test2026" },
		{ password_mode: "auto", password: "Unwanted!2026" },
	])("无效字段返回 400 且错误不携带密码：%j", async (patch) => {
		const { app, services } = makeApp();
		const response = await create(app, { ...autoInput, ...patch });
		expect(response.status).toBe(400);
		const body = await response.text();
		expect(JSON.parse(body).error.code).toBe("invalid_request");
		expect(JSON.parse(body).error.details).toBeUndefined();
		if ("password" in patch) expect(body).not.toContain(patch.password);
		expect(services.members.list({ limit: 20 }).data).toEqual([]);
		expect(services.audit.list()).toEqual([]);
	});

	it("auditor 可读取真实存在的成员但不能创建，缺令牌 401、未知令牌 403", async () => {
		const { app } = makeApp();
		expect((await create(app)).status).toBe(201);
		const read = await app.request("/api/admin/members", { headers: auditor });
		expect(read.status).toBe(200);
		expect(((await read.json()) as MembersPage).data[0]?.username).toBe("alice");
		expect((await create(app, { ...autoInput, username: "bob" }, auditor)).status).toBe(403);
		expect((await app.request("/api/admin/members")).status).toBe(401);
		expect((await create(app, autoInput, { ...admin, authorization: "Bearer wrong" })).status).toBe(403);
		expect((await app.request("/api/admin/members", { headers: { cookie: "kit_subject=alice" } })).status).toBe(401);
	});
});

describe("成员目录持久化与分页搜索", () => {
	it("重新打开数据库后可按名称/用户名搜索，游标翻页无重复且绑定搜索条件", async () => {
		const { app, dataDir, config } = makeApp();
		for (const [username, displayName, email] of [
			["member_one", "张三", "one@example.com"],
			["member_two", "李四", "two@example.com"],
			["memberXtri", "王五", "three@other.com"],
		] as const) {
			expect((await create(app, { ...autoInput, username, display_name: displayName, email })).status).toBe(201);
		}
		const db = openDatabase(dataDir);
		cleanup.push(() => db.close());
		const reopened = createApp(createKitServices(config, db));
		const list = async (query: string) => {
			const response = await reopened.request(`/api/admin/members?${query}`, { headers: admin });
			expect(response.status).toBe(200);
			return (await response.json()) as MembersPage;
		};
		expect((await list(`search=${encodeURIComponent("张三")}`)).data.map((m) => m.username)).toEqual(["member_one"]);
		expect((await list("search=MEMBER_")).data).toHaveLength(2);
		const first = await list("search=member_&limit=1");
		expect(first.data).toHaveLength(1);
		expect(first.next_page_token).toBeTruthy();
		const next = await list(`search=member_&limit=1&page_token=${first.next_page_token}`);
		expect(next.data).toHaveLength(1);
		expect(next.data[0]?.member_id).not.toBe(first.data[0]?.member_id);
		expect(next.next_page_token).toBeUndefined();
		expect(
			(
				await reopened.request(`/api/admin/members?search=other&page_token=${first.next_page_token}`, {
					headers: admin,
				})
			).status,
		).toBe(400);
		expect((await reopened.request("/api/admin/members?page_token=invalid", { headers: admin })).status).toBe(400);
		expect((await reopened.request("/api/admin/members?limit=0", { headers: admin })).status).toBe(400);
		expect((await list("search=missing")).data).toEqual([]);
	});
});
