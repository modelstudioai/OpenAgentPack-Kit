import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionStatusOf } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const close: (() => void)[] = [];
afterEach(() => {
	for (const fn of close.splice(0).reverse()) fn();
});

/** 索引状态由事件回放/水合回正（services/sessions.ts 的 onStatus 接线）；列表读取另有 stale-running 对账兜底。 */
async function setup() {
	const directory = mkdtempSync(join(tmpdir(), "kit-index-status-"));
	close.push(() => rmSync(directory, { recursive: true, force: true }));
	const db = openDatabase(directory);
	close.push(() => db.close());
	const config = loadConfig({ KIT_GATEWAY: "mock", KIT_DATA_DIR: directory, ADMIN_TOKEN: "test-admin" });
	const services = createKitServices(config, db);
	const { member } = await services.members.create(
		{
			username: "owner",
			display_name: "Owner",
			auth_type: "local",
			password_mode: "custom",
			password: "Status!Index2026",
		},
		"admin:test",
	);
	const session = await services.sessions.create({
		subjectId: member.member_id,
		agentSlug: "assistant",
		remoteAgentId: "mock",
	});
	return { services, sessionId: session.session_id, memberId: member.member_id, db };
}

/** 订阅到 ready 即退出：水合在 ready 前后同步完成，索引已按历史终态回正。 */
async function hydrateOnce(services: ReturnType<typeof createKitServices>, sessionId: string) {
	for await (const frame of services.sessions.openStream(sessionId, {})) {
		if (frame.type === "ready") break;
	}
}

async function listedStatus(services: ReturnType<typeof createKitServices>, memberId: string, sessionId: string) {
	const sessions = await services.sessions.list(memberId, {});
	return sessions.find((s) => s.session_id === sessionId)?.status;
}

describe("会话索引状态", () => {
	it("无人订阅期间收敛的回合，重订阅水合把遗留 running 回正为 idle", async () => {
		const { services, sessionId } = await setup();
		await services.sessions.send(sessionId, { text: "你好" });
		expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("running");
		await vi.waitFor(async () => {
			expect((await services.gateway.getSession(sessionId))?.status).toBe("idle");
		});
		await hydrateOnce(services, sessionId);
		expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("idle");
	});

	it("显式归档不被水合覆盖：历史终态 idle 不得改写 archived 行", async () => {
		const { services, sessionId } = await setup();
		await services.sessions.send(sessionId, { text: "你好" });
		await vi.waitFor(async () => {
			expect((await services.gateway.getSession(sessionId))?.status).toBe("idle");
		});
		await services.sessions.archive(sessionId);
		expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("archived");
		await hydrateOnce(services, sessionId);
		expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("archived");
	});

	it("列表对账：无人订阅收敛的 running 行，读取时按 Provider 详情回正为 idle", async () => {
		const { services, sessionId, memberId } = await setup();
		await services.sessions.send(sessionId, { text: "你好" });
		expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("running");
		await vi.waitFor(async () => {
			expect((await services.gateway.getSession(sessionId))?.status).toBe("idle");
		});
		expect(await listedStatus(services, memberId, sessionId)).toBe("idle");
		expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("idle");
	});

	it("无订阅的 fresh running 行在列表读取时立即按 Provider 回正", async () => {
		const { services, sessionId, memberId } = await setup();
		await services.sessions.send(sessionId, { text: "你好" });
		await vi.waitFor(async () => {
			expect((await services.gateway.getSession(sessionId))?.status).toBe("idle");
		});
		expect(await listedStatus(services, memberId, sessionId)).toBe("idle");
	});

	it("有活跃订阅时列表不额外探测，状态交给实时事件回写", async () => {
		const { services, sessionId, memberId } = await setup();
		await services.sessions.send(sessionId, { text: "你好" });
		expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("running");
		const stream = services.sessions.openStream(sessionId, {})[Symbol.asyncIterator]();
		await stream.next();
		let probes = 0;
		services.gateway.getSession = async (id: string) => {
			probes += 1;
			return { session_id: id, status: "running" };
		};
		try {
			expect(await listedStatus(services, memberId, sessionId)).toBe("running");
			expect(probes).toBe(0);
		} finally {
			await stream.return?.(undefined);
		}
	});

	it("审批挂起的存量行回正为 requires_action", async () => {
		const { services, sessionId, memberId } = await setup();
		await services.sessions.send(sessionId, { text: "触发审批" });
		await vi.waitFor(async () => {
			expect((await services.gateway.getSession(sessionId))?.stop_reason?.type).toBe("requires_action");
		});
		expect(await listedStatus(services, memberId, sessionId)).toBe("requires_action");
	});

	it("Provider 详情不可查询时静默保留原 running，不误改", async () => {
		const { services, memberId, db } = await setup();
		services.sessionIndex.create({ sessionId: "orphan", subjectId: memberId, agentSlug: "assistant" });
		db.prepare("UPDATE kit_sessions SET status = 'running', last_event_at = ? WHERE session_id = ?").run(
			new Date(Date.now() - 5 * 60_000).toISOString(),
			"orphan",
		);
		services.gateway.getSession = async () => null;
		expect(await listedStatus(services, memberId, "orphan")).toBe("running");
	});

	it("对账去重：无上游泵的 running 存量行在同一会话 60 秒内不重复探测", async () => {
		const { services, memberId, db } = await setup();
		services.sessionIndex.create({ sessionId: "orphan", subjectId: memberId, agentSlug: "assistant" });
		db.prepare("UPDATE kit_sessions SET status = 'running', last_event_at = ? WHERE session_id = ?").run(
			new Date(Date.now() - 5 * 60_000).toISOString(),
			"orphan",
		);
		let probes = 0;
		services.gateway.getSession = async (id: string) => {
			probes += 1;
			return { session_id: id, status: "running" };
		};
		await services.sessions.list(memberId, {});
		await services.sessions.list(memberId, {});
		expect(probes).toBe(1);
	});

	it("兜底对账：详情 idle 但历史 running 时不误写 idle", async () => {
		const { services, sessionId, memberId, db } = await setup();
		await services.sessions.send(sessionId, { text: "多智能体任务" });
		db.prepare("UPDATE kit_sessions SET last_event_at = ? WHERE session_id = ?").run(
			new Date(Date.now() - 5 * 60_000).toISOString(),
			sessionId,
		);
		services.gateway.getSession = async (id) => ({ session_id: id, status: "idle" });
		expect(await listedStatus(services, memberId, sessionId)).toBe("running");
	});

	it("新回合重放旧 idle 不回退索引，真实终态到达后才收敛", async () => {
		const { services, sessionId } = await setup();
		await services.sessions.send(sessionId, { text: "第一轮", clientMessageId: "cm-first" });
		await vi.waitFor(async () => {
			expect((await services.gateway.getSession(sessionId))?.status).toBe("idle");
		});
		const history = await services.gateway.listEvents(sessionId, {});
		const staleIdle = history.events.findLast((event) => sessionStatusOf(event) === "idle");
		expect(staleIdle).toBeDefined();
		const original = services.gateway.streamEvents.bind(services.gateway);
		let replayed = false;
		services.gateway.streamEvents = async function* (id, options) {
			for await (const event of original(id, options)) {
				yield event;
				if (!replayed && sessionStatusOf(event) === "running") {
					replayed = true;
					yield staleIdle!;
				}
			}
		};
		await services.sessions.send(sessionId, { text: "第二轮", clientMessageId: "cm-second" });
		await vi.waitFor(() => expect(replayed).toBe(true));
		expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("running");
		await vi.waitFor(() => expect(services.sessionIndex.get(sessionId)?.summary.status).toBe("idle"));
	});
});
