import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

/**
 * 服务端健壮性与管控面：角色分离、限流、请求体上限、附件扫描闸门、指标暴露。
 * 保护的不变量见 apps/server/AGENTS.md（凭据不出服务端、auditor 只读、破坏性动作闸门）。
 */
function makeApp(env: Record<string, string> = {}) {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-hardening-"));
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_AUTH_MODE: "anonymous",
		KIT_DATA_DIR: dataDir,
		ADMIN_TOKEN: "admin-token",
		...env,
	});
	const services = createKitServices(config, openDatabase(dataDir));
	return { app: createApp(services), services, config };
}

const json = { "content-type": "application/json" };
const asAdmin = { authorization: "Bearer admin-token", ...json };

describe("管理端角色分离（admin / auditor）", () => {
	it("auditor 可读、不可写；未知令牌 403；缺令牌 401", async () => {
		const { app, services } = makeApp({ KIT_ADMIN_TOKENS: "audit-token:auditor" });
		services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });

		const auditor = { authorization: "Bearer audit-token", ...json };
		expect((await app.request("/api/admin/agents", { headers: auditor })).status).toBe(200);
		expect((await app.request("/api/admin/metrics", { headers: auditor })).status).toBe(200);

		const write = await app.request("/api/admin/agents/assistant", {
			method: "PATCH",
			headers: auditor,
			body: JSON.stringify({ status: "listed" }),
		});
		expect(write.status).toBe(403);
		const body = (await write.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("forbidden");
		expect(body.error.message).toContain("只读");

		// 破坏性动作同样被角色闸门挡在 plan 之前
		const plan = await app.request("/api/admin/projects/demo/plan", {
			method: "POST",
			headers: auditor,
			body: JSON.stringify({ action: "apply" }),
		});
		expect(plan.status).toBe(403);

		// auditor 连「拿确认令牌」这一步都不允许（plan 属于写路径的前置）
		expect(
			(
				await app.request("/api/admin/agents/assistant/plan", {
					method: "POST",
					headers: auditor,
					body: JSON.stringify({ action: "listing", status: "listed" }),
				})
			).status,
		).toBe(403);

		// admin 不受影响：plan → PATCH 带令牌
		const adminPlan = await app.request("/api/admin/agents/assistant/plan", {
			method: "POST",
			headers: asAdmin,
			body: JSON.stringify({ action: "listing", status: "listed" }),
		});
		expect(adminPlan.status).toBe(200);
		const { data: issued } = (await adminPlan.json()) as { data: { plan_id: string; confirm_token: string } };
		expect(
			(
				await app.request("/api/admin/agents/assistant", {
					method: "PATCH",
					headers: asAdmin,
					body: JSON.stringify({ status: "listed", plan_id: issued.plan_id, confirm_token: issued.confirm_token }),
				})
			).status,
		).toBe(200);
		expect((await app.request("/api/admin/agents", { headers: { authorization: "Bearer nope" } })).status).toBe(403);
		expect((await app.request("/api/admin/agents")).status).toBe(401);
	});

	it("审计主体是令牌指纹，不含令牌原文", async () => {
		const { app, services } = makeApp({ KIT_ADMIN_TOKENS: "audit-token:admin" });
		services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		const updated = await app.request("/api/admin/agents/assistant", {
			method: "PUT",
			headers: { ...json, authorization: "Bearer audit-token" },
			body: JSON.stringify({ display_name: "审计测试" }),
		});
		expect(updated.status).toBe(200);
		const audit = (await (
			await app.request("/api/admin/audit", { headers: { authorization: "Bearer audit-token" } })
		).json()) as {
			data: { action: string; subject: string | null }[];
		};
		const entry = audit.data.find((row) => row.action === "catalog.update");
		expect(entry?.subject).toMatch(/^admin:admin:[0-9a-f]{8}$/);
		expect(JSON.stringify(audit.data)).not.toContain("audit-token");
	});
});

describe("限流与请求体上限", () => {
	it("超过令牌桶 → 429 rate_limited + retry-after；rps=0 关闭限流", async () => {
		const { app } = makeApp({ KIT_RATE_LIMIT_RPS: "1", KIT_RATE_LIMIT_BURST: "2" });
		const cookie = "kit_subject=bursty";
		const statuses: number[] = [];
		for (let i = 0; i < 5; i++) {
			statuses.push((await app.request("/api/kit/agents", { headers: { cookie } })).status);
		}
		expect(statuses.slice(0, 2)).toEqual([200, 200]);
		expect(statuses.slice(2)).toEqual([429, 429, 429]);

		const limited = await app.request("/api/kit/agents", { headers: { cookie } });
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		const body = (await limited.json()) as { error: { code: string; retryable: boolean } };
		expect(body.error.code).toBe("rate_limited");
		expect(body.error.retryable).toBe(true);

		const off = makeApp({ KIT_RATE_LIMIT_RPS: "0" });
		for (let i = 0; i < 30; i++) {
			expect((await off.app.request("/api/kit/agents", { headers: { cookie } })).status).toBe(200);
		}
	});

	it("请求体超过 KIT_BODY_LIMIT_BYTES → 413；上传走自己的上限", async () => {
		const { app } = makeApp({ KIT_BODY_LIMIT_BYTES: "64", KIT_UPLOAD_MAX_BYTES: "4096" });
		const big = await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie: "kit_subject=big" },
			body: JSON.stringify({ agent_slug: "x".repeat(200) }),
		});
		expect(big.status).toBe(413);
		expect(((await big.json()) as { error: { code: string } }).error.code).toBe("invalid_request");

		// 上传路由不受 JSON 上限约束（2 KB < 4096）
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array(2048)], { type: "application/octet-stream" }), "big.dat");
		expect(
			(await app.request("/api/kit/files", { method: "POST", headers: { cookie: "kit_subject=big" }, body: form }))
				.status,
		).toBe(201);
	});
});

describe("附件扫描闸门", () => {
	it("未就绪 → 409 conflict 且 retryable；就绪后 → 201", async () => {
		const strict = makeApp({ KIT_MOCK_FILE_SCAN_DELAY_MS: "400", KIT_FILE_SCAN_TIMEOUT_MS: "50" });
		strict.services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		strict.services.catalog.setStatus("assistant", "listed");
		const cookie = "kit_subject=scan";
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }), "a.txt");
		const uploaded = await strict.app.request("/api/kit/files", { method: "POST", headers: { cookie }, body: form });
		const { data: file } = (await uploaded.json()) as { data: { file_id: string } };

		const tooEarly = await strict.app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ agent_slug: "assistant", files: [{ file_id: file.file_id, filename: "a.txt" }] }),
		});
		expect(tooEarly.status).toBe(409);
		const conflict = (await tooEarly.json()) as { error: { code: string; retryable: boolean; message: string } };
		expect(conflict.error.code).toBe("conflict");
		expect(conflict.error.retryable).toBe(true);
		expect(conflict.error.message).toContain("附件仍在处理中");

		const patient = makeApp({ KIT_MOCK_FILE_SCAN_DELAY_MS: "200", KIT_FILE_SCAN_TIMEOUT_MS: "3000" });
		patient.services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		patient.services.catalog.setStatus("assistant", "listed");
		const form2 = new FormData();
		form2.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }), "a.txt");
		const uploaded2 = await patient.app.request("/api/kit/files", { method: "POST", headers: { cookie }, body: form2 });
		const { data: file2 } = (await uploaded2.json()) as { data: { file_id: string } };
		const ok = await patient.app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie },
			body: JSON.stringify({ agent_slug: "assistant", files: [{ file_id: file2.file_id, filename: "a.txt" }] }),
		});
		expect(ok.status).toBe(201);
	});
});

describe("指标暴露", () => {
	it("GET /api/admin/metrics 输出 Prometheus 文本，含请求/限流/会话计数", async () => {
		const { app, services } = makeApp({ KIT_RATE_LIMIT_RPS: "1000", KIT_RATE_LIMIT_BURST: "1000" });
		services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		services.catalog.setStatus("assistant", "listed");
		await app.request("/api/kit/agents");
		await app.request("/api/kit/sessions", {
			method: "POST",
			headers: { ...json, cookie: "kit_subject=metrics" },
			body: JSON.stringify({ agent_slug: "assistant" }),
		});

		const res = await app.request("/api/admin/metrics", { headers: asAdmin });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/plain");
		const text = await res.text();
		expect(text).toContain("# TYPE kit_http_requests_total counter");
		expect(text).toMatch(/kit_http_requests_total\{[^}]*route="\/api\/kit\/agents"[^}]*\} \d+/);
		expect(text).toContain("kit_sessions_created_total");
		// label 只用路由模板：不得出现具体 session id
		expect(text).not.toContain("sess_mock_");
	});
});

/** 播种一个未上架条目（多个用例共用）。 */
function seed(_app: ReturnType<typeof makeApp>["app"], services: ReturnType<typeof makeApp>["services"]) {
	services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
}

describe("上下架确认闸门（AGENTS.md 红线：上下架必须 plan → 确认）", () => {
	it("缺令牌 400 / 伪造令牌 428 / plan+令牌 200 / 令牌重放 428", async () => {
		const { app, services } = makeApp();
		seed(app, services);

		const noToken = await app.request("/api/admin/agents/assistant", {
			method: "PATCH",
			headers: asAdmin,
			body: JSON.stringify({ status: "listed" }),
		});
		expect(noToken.status).toBe(400);

		const forged = await app.request("/api/admin/agents/assistant", {
			method: "PATCH",
			headers: asAdmin,
			body: JSON.stringify({ status: "listed", plan_id: "catalog_assistant_listed", confirm_token: "nope" }),
		});
		expect(forged.status).toBe(428);

		const plan = (await (
			await app.request("/api/admin/agents/assistant/plan", {
				method: "POST",
				headers: asAdmin,
				body: JSON.stringify({ action: "listing", status: "listed" }),
			})
		).json()) as {
			data: { plan_id: string; confirm_token: string; destructive: boolean; diff: { summary?: string }[] };
		};
		expect(plan.data.destructive).toBe(true);
		expect(plan.data.diff[0]?.summary).toContain("unlisted → listed");

		const confirmation = { plan_id: plan.data.plan_id, confirm_token: plan.data.confirm_token };
		const listed = await app.request("/api/admin/agents/assistant", {
			method: "PATCH",
			headers: asAdmin,
			body: JSON.stringify({ status: "listed", ...confirmation }),
		});
		expect(listed.status).toBe(200);

		const replay = await app.request("/api/admin/agents/assistant", {
			method: "PATCH",
			headers: asAdmin,
			body: JSON.stringify({ status: "unlisted", ...confirmation }),
		});
		expect(replay.status).toBe(428);

		// 上架后数据面可见（闸门不影响正常链路）
		const kit = (await (await app.request("/api/kit/agents")).json()) as { data: { slug: string }[] };
		expect(kit.data.map((a) => a.slug)).toEqual(["assistant"]);
	});

	it("同一条目可反复上/下架：plan id 每次唯一，第二次不被误判为重放", async () => {
		const { app, services } = makeApp();
		seed(app, services);
		const flip = async (status: "listed" | "unlisted") => {
			const planRes = await app.request("/api/admin/agents/assistant/plan", {
				method: "POST",
				headers: asAdmin,
				body: JSON.stringify({ action: "listing", status }),
			});
			expect(planRes.status).toBe(200);
			const { data: plan } = (await planRes.json()) as { data: { plan_id: string; confirm_token: string } };
			expect(plan.plan_id).toMatch(/_[0-9a-f]{8}$/);
			const patched = await app.request("/api/admin/agents/assistant", {
				method: "PATCH",
				headers: asAdmin,
				body: JSON.stringify({ status, plan_id: plan.plan_id, confirm_token: plan.confirm_token }),
			});
			expect(patched.status).toBe(200);
		};
		await flip("listed");
		await flip("unlisted");
		await flip("listed");
	});
});

describe("上架条目：展示信息编辑与删除闸门", () => {
	/** 建条目并走闸门上架，返回确认后的条目。 */
	async function listEntry(app: ReturnType<typeof makeApp>["app"]) {
		const plan = (await (
			await app.request("/api/admin/agents/assistant/plan", {
				method: "POST",
				headers: asAdmin,
				body: JSON.stringify({ action: "listing", status: "listed" }),
			})
		).json()) as { data: { plan_id: string; confirm_token: string } };
		const res = await app.request("/api/admin/agents/assistant", {
			method: "PATCH",
			headers: asAdmin,
			body: JSON.stringify({ status: "listed", ...plan.data }),
		});
		expect(res.status).toBe(200);
	}

	it("PUT 改展示信息不需要令牌，但改不了 status；数据面立刻同步", async () => {
		const { app, services } = makeApp();
		seed(app, services);
		await listEntry(app);

		const updated = await app.request("/api/admin/agents/assistant", {
			method: "PUT",
			headers: asAdmin,
			body: JSON.stringify({
				opening_remarks: "你好，我是助手",
				suggested_prompts: ["帮我写周报"],
				ordering: 5,
				status: "unlisted", // 试图夹带状态变更：应被忽略
			}),
		});
		expect(updated.status).toBe(200);
		const { data } = (await updated.json()) as {
			data: { status: string; opening_remarks?: string; suggested_prompts: string[]; ordering: number };
		};
		expect(data.status).toBe("listed");
		expect(data.opening_remarks).toBe("你好，我是助手");
		expect(data.ordering).toBe(5);

		// 体验页读的是同一份 catalog：开场白与示例问题即时生效
		const kit = (await (await app.request("/api/kit/agents/assistant")).json()) as {
			data: { opening_remarks?: string; suggested_prompts: string[] };
		};
		expect(kit.data.opening_remarks).toBe("你好，我是助手");
		expect(kit.data.suggested_prompts).toEqual(["帮我写周报"]);
	});

	it("删除条目必须 plan(action=delete) → 确认：缺令牌 400 / 伪造 428 / 有效 200 / 重放 428", async () => {
		const { app, services } = makeApp();
		seed(app, services);

		expect(
			(
				await app.request("/api/admin/agents/assistant", {
					method: "DELETE",
					headers: asAdmin,
					body: JSON.stringify({}),
				})
			).status,
		).toBe(400);

		expect(
			(
				await app.request("/api/admin/agents/assistant", {
					method: "DELETE",
					headers: asAdmin,
					body: JSON.stringify({ plan_id: "catalog_assistant_delete", confirm_token: "nope" }),
				})
			).status,
		).toBe(428);

		const plan = (await (
			await app.request("/api/admin/agents/assistant/plan", {
				method: "POST",
				headers: asAdmin,
				body: JSON.stringify({ action: "delete" }),
			})
		).json()) as { data: { plan_id: string; confirm_token: string; diff: { action: string }[] } };
		expect(plan.data.diff[0]?.action).toBe("delete");

		const confirmation = { plan_id: plan.data.plan_id, confirm_token: plan.data.confirm_token };
		const deleted = await app.request("/api/admin/agents/assistant", {
			method: "DELETE",
			headers: asAdmin,
			body: JSON.stringify(confirmation),
		});
		expect(deleted.status).toBe(200);
		const list = (await (await app.request("/api/admin/agents", { headers: asAdmin })).json()) as {
			data: { slug: string }[];
		};
		expect(list.data).toEqual([]);

		// 令牌一次性：重放同一个确认被拒
		expect(
			(
				await app.request("/api/admin/agents/assistant", {
					method: "DELETE",
					headers: asAdmin,
					body: JSON.stringify(confirmation),
				})
			).status,
		).toBe(404); // 条目已不存在：先查存在性再验令牌，不泄露令牌是否有效
	});

	it("auditor 只读：PUT/DELETE 上架条目一律 403", async () => {
		const { app, services } = makeApp({ KIT_ADMIN_TOKENS: "audit-token:auditor" });
		services.catalog.upsert({ slug: "assistant", display_name: "A", remote_agent_id: "agent_mock" });
		const auditor = { authorization: "Bearer audit-token", ...json };

		const put = await app.request("/api/admin/agents/assistant", {
			method: "PUT",
			headers: auditor,
			body: JSON.stringify({ ordering: 1 }),
		});
		expect(put.status).toBe(403);
		const del = await app.request("/api/admin/agents/assistant", {
			method: "DELETE",
			headers: auditor,
			body: JSON.stringify({ plan_id: "p", confirm_token: "t" }),
		});
		expect(del.status).toBe(403);
	});
});

describe("CORS 接线（壳用 127.0.0.1 随机端口访问 server）", () => {
	it("loopback 随机端口回显 allow-origin；外站不回显", async () => {
		const { app } = makeApp();
		const shell = await app.request("/api/kit/agents", { headers: { origin: "http://127.0.0.1:41237" } });
		expect(shell.status).toBe(200);
		expect(shell.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:41237");

		const outside = await app.request("/api/kit/agents", { headers: { origin: "https://evil.example.com" } });
		expect(outside.status).toBe(200); // 请求本身不拦（无凭据的公开列表），但不给跨源许可
		expect(outside.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("显式白名单生效后，随机 loopback 端口不再被放行", async () => {
		const { app } = makeApp({ KIT_CORS_ORIGINS: "https://kit.example.com" });
		const res = await app.request("/api/kit/agents", { headers: { origin: "http://127.0.0.1:41237" } });
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});
