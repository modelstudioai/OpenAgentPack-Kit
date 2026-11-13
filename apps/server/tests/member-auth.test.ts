import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemberAuthView, MemberLoginResult } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { signJwt } from "../src/services/identity.ts";
import { createKitServices } from "../src/services/index.ts";
import { MEMBER_SESSION_TTL_MS } from "../src/services/member-auth.ts";
import { openDatabase } from "../src/store/db.ts";

const dispose: (() => void)[] = [];
afterEach(() => {
	for (const close of dispose.splice(0).reverse()) close();
});

function makeApp(env: Record<string, string> = {}) {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-member-auth-"));
	dispose.push(() => rmSync(dataDir, { recursive: true, force: true }));
	const config = loadConfig({ KIT_GATEWAY: "mock", KIT_DATA_DIR: dataDir, ADMIN_TOKEN: "admin-token", ...env });
	const db = openDatabase(dataDir);
	dispose.push(() => db.close());
	const services = createKitServices(config, db);
	services.catalog.upsert({ slug: "assistant", display_name: "助手", remote_agent_id: "agent_mock" });
	services.catalog.setStatus("assistant", "listed");
	return { app: createApp(services), services, config, db, dataDir };
}

type TestApp = ReturnType<typeof makeApp>["app"];
const json = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0" };
const headers = (token: string) => ({ ...json, authorization: `Bearer ${token}` });
const password = "Private!Password2026";

async function seedMember(app: TestApp, username = "alice") {
	const response = await app.request("/api/admin/members", {
		method: "POST",
		headers: headers("admin-token"),
		body: JSON.stringify({ username, display_name: username, auth_type: "local", password_mode: "custom", password }),
	});
	expect(response.status).toBe(201);
}

async function login(app: TestApp, username = "alice"): Promise<MemberLoginResult> {
	const response = await app.request("/api/kit/auth/login", {
		method: "POST",
		headers: json,
		body: JSON.stringify({ username, password }),
	});
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	return ((await response.json()) as { data: MemberLoginResult }).data;
}

async function createSession(app: TestApp, token: string) {
	const response = await app.request("/api/kit/sessions", {
		method: "POST",
		headers: headers(token),
		body: JSON.stringify({ agent_slug: "assistant" }),
	});
	expect(response.status).toBe(201);
	return ((await response.json()) as { data: { session_id: string } }).data.session_id;
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, marker?: string) {
	let text = "";
	const decoder = new TextDecoder();
	for (;;) {
		const item = await reader.read();
		if (item.done) return text;
		text += decoder.decode(item.value, { stream: true });
		if (marker && text.includes(marker)) return text;
	}
}

describe("本地成员认证", () => {
	it("默认要求登录；管理员创建后可登录、刷新恢复并保持跨设备会话归属；退出仅撤销当前凭据", async () => {
		const { app, services, db, config, dataDir } = makeApp();
		expect(config.authMode).toBe("member");
		expect((await app.request("/api/kit/agents")).status).toBe(401);
		const publicConfig = (await (await app.request("/api/config")).json()) as { data: { auth: unknown } };
		expect(publicConfig.data.auth).toEqual({ mode: "member", passwordLogin: true });
		await seedMember(app);
		const first = await login(app, " ALICE ");
		const second = await login(app);
		expect(first.access_token).toMatch(/^kit_member_[A-Za-z0-9_-]{43}$/);
		expect(second.access_token).not.toBe(first.access_token);
		expect(second.member.member_id).toBe(first.member.member_id);
		expect(Date.parse(first.expires_at) - Date.now()).toBeGreaterThan(MEMBER_SESSION_TTL_MS - 5000);
		const sessionId = await createSession(app, first.access_token);
		const list = (await (await app.request("/api/kit/sessions", { headers: headers(second.access_token) })).json()) as {
			data: { session_id: string }[];
		};
		expect(list.data.map((entry) => entry.session_id)).toEqual([sessionId]);
		expect(services.sessionIndex.get(sessionId)?.subject_id).toBe(first.member.member_id);
		const restoredDb = openDatabase(dataDir);
		dispose.push(() => restoredDb.close());
		const restarted = createApp(createKitServices(config, restoredDb));
		const me = await restarted.request("/api/kit/auth/me", { headers: headers(first.access_token) });
		expect(me.status).toBe(200);
		expect(me.headers.get("cache-control")).toBe("no-store");
		const restored = ((await me.json()) as { data: MemberAuthView }).data;
		expect(restored.identity.subjectId).toBe(first.member.member_id);
		expect(restored.member).toEqual(first.member);
		expect(restored.expires_at).toBe(first.expires_at);
		const stored = JSON.stringify(db.prepare("SELECT * FROM kit_member_sessions").all());
		expect(stored).not.toContain(first.access_token);
		expect(stored).not.toContain(password);
		expect(stored).toContain(createHash("sha256").update(first.access_token).digest("hex"));
		const audit = JSON.stringify(services.audit.list());
		expect(audit).not.toContain(first.access_token);
		expect(audit).not.toContain(password);
		for (let attempt = 0; attempt < 2; attempt++) {
			expect(
				(await app.request("/api/kit/auth/logout", { method: "POST", headers: headers(first.access_token) })).status,
			).toBe(204);
		}
		expect((await app.request("/api/kit/auth/me", { headers: headers(first.access_token) })).status).toBe(401);
		expect((await app.request("/api/kit/auth/me", { headers: headers(second.access_token) })).status).toBe(200);
	});

	it("未知账号与错密码响应一致；参数错误不回显输入，匿名 cookie 不能绕过登录限流", async () => {
		const { app } = makeApp();
		await seedMember(app);
		const wrong = async (username: string, value = "Wrong!Password2026", cookie = "") =>
			app.request("/api/kit/auth/login", {
				method: "POST",
				headers: { ...json, cookie },
				body: JSON.stringify({ username, password: value }),
			});
		const unknown = await wrong("missing");
		const known = await wrong("alice");
		expect(unknown.status).toBe(401);
		expect(known.status).toBe(401);
		expect(await unknown.json()).toEqual(await known.json());
		const invalid = await wrong("alice", "sensitive-".repeat(100));
		expect(invalid.status).toBe(400);
		expect(await invalid.text()).not.toContain("sensitive-");
		for (let attempt = 1; attempt < 10; attempt++) {
			expect((await wrong("alice", "Wrong!Password2026", `kit_subject=rotated-${attempt}`)).status).toBe(401);
		}
		const limited = await wrong("ALICE", "Wrong!Password2026", "kit_subject=last");
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(await limited.text()).not.toContain("Wrong!Password2026");
	});

	it("成员会话/附件隔离，伪造匿名 cookie 与可信 JWT 都不能冒充 member_id", async () => {
		const { app, config, db, services } = makeApp({ KIT_JWT_SECRET: "trusted-signing-secret" });
		await seedMember(app);
		await seedMember(app, "bob");
		const alice = await login(app);
		const bob = await login(app, "bob");
		const sessionId = await createSession(app, alice.access_token);
		expect((await app.request(`/api/kit/sessions/${sessionId}`, { headers: headers(bob.access_token) })).status).toBe(
			404,
		);
		expect(
			(await app.request(`/api/kit/sessions/${sessionId}/events`, { headers: headers(bob.access_token) })).status,
		).toBe(404);
		expect(
			(await app.request(`/api/kit/sessions/${sessionId}/stream`, { headers: headers(bob.access_token) })).status,
		).toBe(404);
		const form = new FormData();
		form.append("file", new Blob(["private"]), "private.txt");
		const uploaded = await app.request("/api/kit/files", {
			method: "POST",
			headers: { authorization: `Bearer ${alice.access_token}` },
			body: form,
		});
		expect(uploaded.status).toBe(201);
		const fileId = ((await uploaded.json()) as { data: { file_id: string } }).data.file_id;
		expect(
			(await app.request(`/api/kit/files/${fileId}/download`, { headers: headers(bob.access_token) })).status,
		).toBe(404);
		const mount = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: headers(bob.access_token),
			body: JSON.stringify({ agent_slug: "assistant", files: [{ file_id: fileId }] }),
		});
		expect(mount.status).toBe(404);
		expect(
			(
				await app.request(`/api/kit/sessions/${sessionId}`, {
					headers: { cookie: `kit_subject=${alice.member.member_id}` },
				})
			).status,
		).toBe(401);
		const demo = createApp({ ...services, config: { ...config, authMode: "anonymous" } });
		expect(
			(
				await demo.request(`/api/kit/sessions/${sessionId}`, {
					headers: { cookie: `kit_subject=${alice.member.member_id}` },
				})
			).status,
		).toBe(404);
		expect((await demo.request("/api/kit/sessions", { headers: headers("invalid-token") })).status).toBe(401);
		const jwt = signJwt({ sub: "trusted-external-user", name: "External" }, config.jwtSecret as string);
		const jwtMe = await app.request("/api/kit/auth/me", { headers: headers(jwt) });
		expect(jwtMe.status).toBe(200);
		expect(((await jwtMe.json()) as { data: MemberAuthView }).data.identity.subjectId).toBe("trusted-external-user");
		const impersonation = signJwt({ sub: alice.member.member_id }, config.jwtSecret as string);
		expect((await app.request("/api/kit/auth/me", { headers: headers(impersonation) })).status).toBe(401);
		expect(db.prepare("SELECT COUNT(*) AS count FROM kit_sessions").get()?.count).toBe(1);
	});

	it("跨源登录使用 Bearer，无需 cookie；CORS 允许授权头且不把会话 token 返回其他端点", async () => {
		const { app } = makeApp({ KIT_CORS_ORIGINS: "https://experience.example.com" });
		await seedMember(app);
		const preflight = await app.request("/api/kit/auth/login", {
			method: "OPTIONS",
			headers: {
				origin: "https://experience.example.com",
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type,authorization",
			},
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");
		const response = await app.request("/api/kit/auth/login", {
			method: "POST",
			headers: { ...json, origin: "https://experience.example.com", authorization: "Bearer expired-login" },
			body: JSON.stringify({ username: "alice", password }),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe("https://experience.example.com");
		expect(response.headers.get("set-cookie")).toBeNull();
		const result = ((await response.json()) as { data: MemberLoginResult }).data;
		const me = await app.request("/api/kit/auth/me", { headers: headers(result.access_token) });
		expect(await me.text()).not.toContain(result.access_token);
	});

	it("退出会关闭已打开的 SSE 并拒绝继续请求，另一个有效设备的流可继续", async () => {
		const { app, services } = makeApp();
		await seedMember(app);
		const first = await login(app);
		const other = await login(app);
		const sessionId = await createSession(app, first.access_token);
		const interrupted = vi.spyOn(services.gateway, "interrupt");
		const response = await app.request(`/api/kit/sessions/${sessionId}/stream`, {
			headers: headers(first.access_token),
		});
		const reader = response.body?.getReader();
		if (!reader) throw new Error("SSE reader missing");
		await readUntil(reader, "event: ready");
		const otherResponse = await app.request(`/api/kit/sessions/${sessionId}/stream`, {
			headers: headers(other.access_token),
		});
		const otherReader = otherResponse.body?.getReader();
		if (!otherReader) throw new Error("SSE reader missing");
		await readUntil(otherReader, "event: ready");
		try {
			const ended = readUntil(reader);
			expect(
				(await app.request("/api/kit/auth/logout", { method: "POST", headers: headers(first.access_token) })).status,
			).toBe(204);
			expect(await ended).toContain('"code":"unauthorized"');
			expect(interrupted).not.toHaveBeenCalled();
			const continued = readUntil(otherReader, "event: event");
			const sent = await app.request(`/api/kit/sessions/${sessionId}/messages`, {
				method: "POST",
				headers: headers(other.access_token),
				body: JSON.stringify({ text: "still connected" }),
			});
			expect(sent.status).toBe(202);
			expect(await continued).toContain("event: event");
			expect(
				(await app.request(`/api/kit/sessions/${sessionId}/stream`, { headers: headers(first.access_token) })).status,
			).toBe(401);
		} finally {
			await reader.cancel();
			await otherReader.cancel();
		}
	});

	it("已开 SSE 在登录到期后主动关闭，过期凭据无法恢复登录", async () => {
		const { app, db } = makeApp();
		await seedMember(app);
		const signedIn = await login(app);
		const sessionId = await createSession(app, signedIn.access_token);
		const expiresAt = new Date(Date.now() + 800).toISOString();
		db.prepare("UPDATE kit_member_sessions SET expires_at = ?").run(expiresAt);
		const response = await app.request(`/api/kit/sessions/${sessionId}/stream`, {
			headers: headers(signedIn.access_token),
		});
		expect(response.status).toBe(200);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("SSE reader missing");
		await readUntil(reader, "event: ready");
		expect(await readUntil(reader)).toContain('"code":"unauthorized"');
		expect((await app.request("/api/kit/auth/me", { headers: headers(signedIn.access_token) })).status).toBe(401);
		await reader.cancel();
	});

	it.each(["data", "unauthorized"])("读端暂停消费 %s 帧时退出仍释放 SSE、认证绑定与上游订阅", async (blockedFrame) => {
		const { app, services } = makeApp();
		await seedMember(app);
		const signedIn = await login(app);
		const sessionId = await createSession(app, signedIn.access_token);
		const bind = services.memberAuth.bindStream;
		const released = vi.fn();
		vi.spyOn(services.memberAuth, "bindStream").mockImplementation((record) => {
			const binding = bind(record);
			return {
				...binding,
				close() {
					binding.close();
					released();
				},
			};
		});
		let upstreamClosed = false;
		const source = services.gateway.streamEvents;
		vi.spyOn(services.gateway, "streamEvents").mockImplementation(async function* (...args) {
			try {
				yield* source(...args);
			} finally {
				upstreamClosed = true;
			}
		});
		const response = await app.request(`/api/kit/sessions/${sessionId}/stream`, {
			headers: headers(signedIn.access_token),
		});
		expect(response.status).toBe(200);
		// 不读取 body：ready 填满输出队列，下一条数据或认证错误会阻塞 writer。
		await vi.waitFor(() => expect(services.metrics.snapshot().kit_sse_streams_active).toBe(1));
		try {
			if (blockedFrame === "data") {
				const sent = await app.request(`/api/kit/sessions/${sessionId}/messages`, {
					method: "POST",
					headers: headers(signedIn.access_token),
					body: JSON.stringify({ text: "approval" }),
				});
				expect(sent.status).toBe(202);
			}
			expect(upstreamClosed).toBe(false);
			expect(released).not.toHaveBeenCalled();
			expect(
				(await app.request("/api/kit/auth/logout", { method: "POST", headers: headers(signedIn.access_token) })).status,
			).toBe(204);
			await vi.waitFor(() => {
				expect(services.metrics.snapshot().kit_sse_streams_active).toBe(0);
				expect(upstreamClosed).toBe(true);
				expect(released).toHaveBeenCalledOnce();
			});
		} finally {
			await response.body?.cancel();
		}
	});
});
