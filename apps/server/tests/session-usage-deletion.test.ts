import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { GatewaySessionInfo } from "../src/gateway/types.ts";
import { createKitServices } from "../src/services/index.ts";
import { createSessionService } from "../src/services/sessions.ts";
import { openDatabase } from "../src/store/db.ts";
import { createSessionDeletionStore } from "../src/store/session-deletions.ts";

const close: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const fn of close.splice(0).reverse()) fn();
});
const usage = { input_tokens: 120, output_tokens: 80, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 };
const stats = { active_seconds: 2, duration_seconds: 3 };
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
async function setup() {
	const directory = mkdtempSync(join(tmpdir(), "kit-usage-delete-"));
	const db = openDatabase(directory);
	close.push(() => {
		db.close();
		rmSync(directory, { recursive: true, force: true });
	});
	const config = loadConfig({ KIT_GATEWAY: "mock", KIT_DATA_DIR: directory, ADMIN_TOKEN: "test-admin" });
	const services = createKitServices(config, db);
	const { member } = await services.members.create(
		{
			username: "owner",
			display_name: "Owner",
			auth_type: "local",
			password_mode: "custom",
			password: "Usage!Delete2026",
		},
		"admin:test",
	);
	const create = () =>
		services.sessions.create({ subjectId: member.member_id, agentSlug: "assistant", remoteAgentId: "mock" });
	const session = await create();
	const deletionStore = createSessionDeletionStore(db);
	const sessions = createSessionService({
		gateway: services.gateway,
		buffers: services.buffers,
		sessionIndex: services.sessionIndex,
		memberUsage: services.memberUsage,
		deletionStore,
		deletionTimeoutMs: 80,
		deletionPollMs: 1,
	});
	const snapshot = (status = "idle"): GatewaySessionInfo => ({
		session_id: session.session_id,
		status,
		stop_reason: { type: "end_turn" },
		usage,
		stats,
	});
	const restart = () => {
		const reopened = openDatabase(directory);
		close.push(() => reopened.close());
		const restored = createKitServices(config, reopened);
		const restoredDeletionStore = createSessionDeletionStore(reopened);
		return {
			services: restored,
			deletionStore: restoredDeletionStore,
			sessions: createSessionService({
				gateway: services.gateway,
				buffers: restored.buffers,
				sessionIndex: restored.sessionIndex,
				memberUsage: restored.memberUsage,
				deletionStore: restoredDeletionStore,
				deletionTimeoutMs: 80,
				deletionPollMs: 1,
			}),
		};
	};
	return {
		db,
		services,
		sessions,
		sessionId: session.session_id,
		member,
		deletionStore,
		snapshot,
		config,
		create,
		restart,
	};
}

// 保护真实的删除边界：Provider DELETE 之前已持久化数值；所有失败路径保留可恢复索引。
describe("成员会话删除前用量快照", () => {
	it("运行会话中断受理后仍等待，停止且快照提交后才删除；保存的统计可重开数据库读取", async () => {
		const t = await setup();
		let stopped = false;
		const acknowledged = deferred<void>();
		vi.spyOn(t.services.gateway, "getSession").mockImplementation(async () => t.snapshot(stopped ? "idle" : "running"));
		vi.spyOn(t.services.gateway, "interrupt").mockImplementation(async () => {
			acknowledged.resolve();
		});
		const remove = vi.spyOn(t.services.gateway, "deleteSession").mockImplementation(async () => {
			const saved = t.db
				.prepare("SELECT input_tokens, finalized_at FROM kit_session_usage WHERE session_id=?")
				.get(t.sessionId);
			expect(saved?.input_tokens).toBe(120);
			expect(saved?.finalized_at).toBeTruthy();
		});
		const deleting = t.sessions.delete(t.sessionId);
		await acknowledged.promise;
		expect(remove).not.toHaveBeenCalled();
		stopped = true;
		await deleting;
		expect(remove).toHaveBeenCalledOnce();
		expect(t.services.sessionIndex.get(t.sessionId)).toBeNull();
		expect(t.services.memberUsage.summary(t.member.member_id).metrics.input_tokens.value).toBe(120);
		expect(t.services.memberUsage.summary(t.member.member_id).deleted_session_count).toBe(1);
		const reopened = openDatabase(t.config.dataDir);
		try {
			expect(
				reopened.prepare("SELECT output_tokens, deleted_at FROM kit_session_usage").get()?.deleted_at,
			).toBeTruthy();
		} finally {
			reopened.close();
		}
	});

	it.each(["stop-rejected", "stop-timeout", "approval-pending", "missing-usage", "query-failed", "write-failed"])(
		"%s 不能调用远端删除，保留会话并提供可重试错误",
		async (mode) => {
			const t = await setup();
			vi.spyOn(t.services.gateway, "getSession").mockImplementation(async () => {
				if (mode === "query-failed") throw new Error("private-provider-error");
				if (mode === "missing-usage") return { session_id: t.sessionId, status: "idle" };
				if (mode === "approval-pending") return { ...t.snapshot(), stop_reason: { type: "requires_action" } };
				return t.snapshot(mode.startsWith("stop-") ? "running" : "idle");
			});
			vi.spyOn(t.services.gateway, "interrupt").mockImplementation(async () => {
				if (mode === "stop-rejected") throw new Error("private-provider-error");
			});
			if (mode === "write-failed")
				t.db.exec(
					"CREATE TRIGGER fail_snapshot BEFORE UPDATE OF finalized_at ON kit_session_usage BEGIN SELECT RAISE(ABORT, 'disk failed'); END",
				);
			const remove = vi.spyOn(t.services.gateway, "deleteSession");
			const error = await t.sessions.delete(t.sessionId).catch((value: unknown) => value);
			expect(error).toBeInstanceOf(KitError);
			expect(error).toMatchObject({ retryable: true });
			expect((error as Error).message).toContain("重试");
			expect((error as Error).message).not.toContain("private-provider-error");
			expect(remove).not.toHaveBeenCalled();
			expect(t.services.sessionIndex.get(t.sessionId)).not.toBeNull();
		},
	);

	it("首次采集失败且未发出中断或删除时释放保护，恢复后仍可发送", async () => {
		const t = await setup();
		const read = vi.spyOn(t.services.gateway, "getSession").mockResolvedValue({ ...t.snapshot(), usage: undefined });
		const interrupt = vi.spyOn(t.services.gateway, "interrupt");
		const remove = vi.spyOn(t.services.gateway, "deleteSession");
		const send = vi.spyOn(t.services.gateway, "sendMessage");
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({
			details: { stage: "capture", execution_stopped: true, deletion_uncertain: false },
		});
		expect(interrupt).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
		expect(t.services.sessionIndex.get(t.sessionId)).not.toBeNull();
		expect(t.deletionStore.get(t.sessionId)).toBeUndefined();
		expect(t.services.memberUsage.hasFinalSnapshot(t.sessionId)).toBe(false);
		read.mockRestore();
		await expect(t.sessions.send(t.sessionId, { text: "恢复后继续对话" })).resolves.toMatchObject({
			event_ids: expect.arrayContaining([expect.any(String)]),
		});
		expect(send).toHaveBeenCalledWith(t.sessionId, { text: "恢复后继续对话" });
	});

	it("等待审批不能仅凭idle判为停止：详情无原因时读取主线程历史", async () => {
		const t = await setup();
		vi.spyOn(t.services.gateway, "getSession").mockResolvedValue({
			session_id: t.sessionId,
			status: "idle",
			usage,
			stats,
		});
		vi.spyOn(t.services.gateway, "listEvents").mockResolvedValue({
			next_page_token: null,
			events: [
				{
					event_id: "parent",
					type: "session_status",
					content: [
						{
							type: "data",
							data: {
								session_status: "idle",
								stop_reason: { type: "requires_action", pending_batch_id: "b", pending_call_ids: ["c"] },
							},
						},
					],
				},
				{
					event_id: "child",
					type: "thread_status",
					metadata: { session_thread_id: "sthr_child" },
					content: [{ type: "data", data: { thread_status: "idle" } }],
				},
			],
		});
		const interrupt = vi.spyOn(t.services.gateway, "interrupt").mockResolvedValue();
		const remove = vi.spyOn(t.services.gateway, "deleteSession");
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ retryable: true });
		expect(interrupt).toHaveBeenCalledOnce();
		expect(remove).not.toHaveBeenCalled();
	});

	it("详情idle但主会话历史仍running时不能按无审批当作已停止", async () => {
		const t = await setup();
		vi.spyOn(t.services.gateway, "getSession").mockResolvedValue({
			session_id: t.sessionId,
			status: "idle",
			usage,
			stats,
		});
		vi.spyOn(t.services.gateway, "listEvents").mockResolvedValue({
			next_page_token: null,
			events: [
				{ event_id: "main", type: "session_status", content: [{ type: "data", data: { session_status: "running" } }] },
			],
		});
		vi.spyOn(t.services.gateway, "interrupt").mockResolvedValue();
		const remove = vi.spyOn(t.services.gateway, "deleteSession");
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ retryable: true });
		expect(remove).not.toHaveBeenCalled();
		expect(t.services.sessionIndex.get(t.sessionId)).not.toBeNull();
	});

	it("删除失败保留快照；再次执行重新采集，重复保存不叠加", async () => {
		const t = await setup();
		vi.spyOn(t.services.gateway, "getSession").mockResolvedValue(t.snapshot());
		const remove = vi
			.spyOn(t.services.gateway, "deleteSession")
			.mockRejectedValueOnce(new Error("failed"))
			.mockResolvedValueOnce();
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ retryable: true });
		expect(t.services.sessionIndex.get(t.sessionId)).not.toBeNull();
		expect(t.services.memberUsage.summary(t.member.member_id).metrics.output_tokens.value).toBe(80);
		await t.sessions.delete(t.sessionId);
		expect(remove).toHaveBeenCalledTimes(2);
		expect(t.services.memberUsage.summary(t.member.member_id).metrics.output_tokens.value).toBe(80);
	});

	it("DELETE 连接错误后即使详情仍存在也保持保护，迟到删除后可显式恢复", async () => {
		const t = await setup();
		const read = vi.spyOn(t.services.gateway, "getSession").mockResolvedValue(t.snapshot());
		const remove = vi
			.spyOn(t.services.gateway, "deleteSession")
			.mockRejectedValue(new TypeError("connection reset after request transmission"));
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ details: { deletion_uncertain: true } });
		expect(t.services.sessionIndex.get(t.sessionId)).not.toBeNull();
		expect(t.deletionStore.get(t.sessionId)?.stage).toBe("uncertain");
		expect(t.services.memberUsage.hasFinalSnapshot(t.sessionId)).toBe(true);
		await expect(t.sessions.send(t.sessionId, { text: "late execution" })).rejects.toMatchObject({ code: "conflict" });
		await expect(
			t.sessions.respondToolApproval(t.sessionId, { batch_id: "b", call_id: "c", result: "allow" }),
		).rejects.toMatchObject({ code: "conflict" });
		// 请求报错后远端才执行删除；重开数据库后仍禁止新执行，也不自动再次 DELETE。
		read.mockResolvedValue(null);
		const restarted = t.restart();
		await expect(restarted.sessions.send(t.sessionId, { text: "after restart" })).rejects.toMatchObject({
			code: "conflict",
		});
		expect(remove).toHaveBeenCalledOnce();
		await restarted.sessions.delete(t.sessionId);
		expect(remove).toHaveBeenCalledOnce();
		expect(restarted.services.sessionIndex.get(t.sessionId)).toBeNull();
		expect(restarted.services.memberUsage.summary(t.member.member_id)).toMatchObject({
			deleted_session_count: 1,
			metrics: { input_tokens: { value: 120 } },
		});
	});

	it("DELETE 报错且 uncertain 落库失败时保留 deleting，重启后可确认远端删除并收尾", async () => {
		const t = await setup();
		const read = vi.spyOn(t.services.gateway, "getSession").mockResolvedValue(t.snapshot());
		const remove = vi.spyOn(t.services.gateway, "deleteSession").mockRejectedValue(new TypeError("connection reset"));
		t.db.exec(`CREATE TRIGGER fail_uncertain BEFORE UPDATE OF stage ON kit_session_deletions
			WHEN NEW.stage = 'uncertain' BEGIN SELECT RAISE(ABORT, 'disk failed'); END`);
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({
			details: { stage: "delete", deletion_uncertain: true },
		});
		expect(remove).toHaveBeenCalledOnce();
		const restarted = t.restart();
		expect(restarted.services.sessionIndex.get(t.sessionId)).not.toBeNull();
		expect(restarted.deletionStore.get(t.sessionId)?.stage).toBe("deleting");
		expect(restarted.services.memberUsage.hasFinalSnapshot(t.sessionId)).toBe(true);
		await expect(restarted.sessions.send(t.sessionId, { text: "after restart" })).rejects.toMatchObject({
			code: "conflict",
			message: "会话正在删除或删除结果待确认，请先重试删除",
		});
		await expect(
			restarted.sessions.respondToolApproval(t.sessionId, { batch_id: "b", call_id: "c", result: "allow" }),
		).rejects.toMatchObject({ code: "conflict", message: "会话正在删除或删除结果待确认，请先重试删除" });
		t.db.exec("DROP TRIGGER fail_uncertain");
		read.mockResolvedValue(null);
		await restarted.sessions.delete(t.sessionId);
		expect(remove).toHaveBeenCalledOnce();
		expect(restarted.services.sessionIndex.get(t.sessionId)).toBeNull();
		expect(restarted.deletionStore.get(t.sessionId)?.stage).toBe("deleted");
		expect(restarted.services.memberUsage.summary(t.member.member_id)).toMatchObject({
			deleted_session_count: 1,
			metrics: { input_tokens: { value: 120 }, output_tokens: { value: 80 } },
		});
	});

	it.each(["uncertain", "deleting"] as const)(
		"从持久 %s 恢复时重新采集不能降级阶段，下一阶段落库失败后仍可重启收尾",
		async (stage) => {
			const t = await setup();
			// 直接恢复已发出 DELETE 的数据库，独立保护恢复边界，不依赖前一次连接错误的处理。
			t.services.memberUsage.captureFinal(t.sessionId, t.snapshot());
			t.deletionStore.set(t.sessionId, t.member.member_id, stage);
			const read = vi.spyOn(t.services.gateway, "getSession").mockResolvedValue({
				...t.snapshot(),
				usage: { ...usage, output_tokens: 90 },
			});
			const remove = vi.spyOn(t.services.gateway, "deleteSession");
			t.db.exec(`CREATE TRIGGER fail_deleting BEFORE UPDATE OF stage ON kit_session_deletions
				WHEN NEW.stage = 'deleting' BEGIN SELECT RAISE(ABORT, 'disk failed'); END`);
			const recovering = t.restart();
			await expect(recovering.sessions.delete(t.sessionId)).rejects.toMatchObject({
				details: { stage: "delete", deletion_uncertain: true },
			});
			expect(recovering.deletionStore.get(t.sessionId)?.stage).toBe("uncertain");
			expect(recovering.services.memberUsage.hasFinalSnapshot(t.sessionId)).toBe(true);
			expect(recovering.services.memberUsage.summary(t.member.member_id).metrics.output_tokens.value).toBe(90);
			expect(remove).not.toHaveBeenCalled();
			const restarted = t.restart();
			expect(restarted.services.sessionIndex.get(t.sessionId)).not.toBeNull();
			await expect(restarted.sessions.send(t.sessionId, { text: "new execution" })).rejects.toMatchObject({
				code: "conflict",
				message: "会话正在删除或删除结果待确认，请先重试删除",
			});
			await expect(
				restarted.sessions.respondToolApproval(t.sessionId, { batch_id: "b", call_id: "c", result: "allow" }),
			).rejects.toMatchObject({ code: "conflict", message: "会话正在删除或删除结果待确认，请先重试删除" });
			// 旧 DELETE 此时才完成；新进程依据封存值收尾，不能再向 Provider 发 DELETE。
			read.mockResolvedValue(null);
			await restarted.sessions.delete(t.sessionId);
			expect(restarted.services.sessionIndex.get(t.sessionId)).toBeNull();
			expect(restarted.deletionStore.get(t.sessionId)?.stage).toBe("deleted");
			expect(restarted.services.memberUsage.summary(t.member.member_id)).toMatchObject({
				deleted_session_count: 1,
				metrics: { output_tokens: { value: 90 } },
			});
			expect(remove).not.toHaveBeenCalled();
		},
	);

	it("远端删除成功但本地收尾事务失败，重启后保留写保护并只完成本地收尾", async () => {
		const t = await setup();
		let remoteDeleted = false;
		vi.spyOn(t.services.gateway, "getSession").mockImplementation(async () => (remoteDeleted ? null : t.snapshot()));
		const remove = vi.spyOn(t.services.gateway, "deleteSession").mockImplementation(async () => {
			remoteDeleted = true;
		});
		t.db.exec(`CREATE TRIGGER fail_finalize BEFORE DELETE ON kit_sessions
			BEGIN SELECT RAISE(ABORT, 'disk failed'); END`);
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({
			details: { stage: "finalize", deletion_uncertain: false },
		});
		expect(remove).toHaveBeenCalledOnce();
		const restarted = t.restart();
		expect(restarted.services.sessionIndex.get(t.sessionId)).not.toBeNull();
		expect(restarted.services.memberUsage.hasFinalSnapshot(t.sessionId)).toBe(true);
		expect(restarted.services.memberUsage.summary(t.member.member_id).deleted_session_count).toBe(0);
		await expect(restarted.sessions.send(t.sessionId, { text: "after restart" })).rejects.toMatchObject({
			code: "conflict",
			message: "会话正在删除或删除结果待确认，请先重试删除",
		});
		await expect(
			restarted.sessions.respondToolApproval(t.sessionId, { batch_id: "b", call_id: "c", result: "allow" }),
		).rejects.toMatchObject({ code: "conflict", message: "会话正在删除或删除结果待确认，请先重试删除" });
		t.db.exec("DROP TRIGGER fail_finalize");
		await restarted.sessions.delete(t.sessionId);
		expect(remove).toHaveBeenCalledOnce();
		expect(restarted.services.sessionIndex.get(t.sessionId)).toBeNull();
		expect(restarted.deletionStore.get(t.sessionId)?.stage).toBe("deleted");
		expect(restarted.services.memberUsage.summary(t.member.member_id)).toMatchObject({
			deleted_session_count: 1,
			metrics: { input_tokens: { value: 120 }, output_tokens: { value: 80 } },
		});
	});

	it("删除超时结果不明时阻止发送，重启后可依据已保存快照确认远端删除并完成本地记录", async () => {
		const t = await setup();
		const read = vi.spyOn(t.services.gateway, "getSession").mockResolvedValue(t.snapshot());
		const late = deferred<void>();
		const remove = vi.spyOn(t.services.gateway, "deleteSession").mockReturnValue(late.promise);
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ details: { deletion_uncertain: true } });
		expect(t.deletionStore.get(t.sessionId)?.stage).toBe("uncertain");
		await expect(t.sessions.send(t.sessionId, { text: "new" })).rejects.toMatchObject({ code: "conflict" });
		late.resolve();
		read.mockResolvedValue(null);
		const restarted = createSessionService({
			gateway: t.services.gateway,
			buffers: t.services.buffers,
			sessionIndex: t.services.sessionIndex,
			memberUsage: t.services.memberUsage,
			deletionStore: createSessionDeletionStore(t.db),
		});
		await restarted.delete(t.sessionId);
		expect(remove).toHaveBeenCalledOnce();
		expect(t.services.memberUsage.summary(t.member.member_id).deleted_session_count).toBe(1);
	});

	it("中断超时后重试详情失败仍保留写保护，迟到中断不能误伤新执行", async () => {
		const t = await setup();
		const read = vi.spyOn(t.services.gateway, "getSession").mockResolvedValue(t.snapshot("running"));
		const late = deferred<void>();
		vi.spyOn(t.services.gateway, "interrupt").mockReturnValue(late.promise);
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ retryable: true });
		expect(t.deletionStore.get(t.sessionId)?.stage).toBe("preparing");
		read.mockRejectedValue(new Error("unavailable"));
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ retryable: true });
		await expect(t.sessions.send(t.sessionId, { text: "new execution" })).rejects.toMatchObject({ code: "conflict" });
		late.resolve();
		read.mockResolvedValue(t.snapshot());
		await t.sessions.delete(t.sessionId);
		expect(t.services.sessionIndex.get(t.sessionId)).toBeNull();
	});

	it.each(["missing-usage", "write-failed"])(
		"中断超时后自然 idle 与 %s 不能解锁，重启后也阻止新执行直到显式删除完成",
		async (mode) => {
			const t = await setup();
			const read = vi.spyOn(t.services.gateway, "getSession").mockResolvedValue(t.snapshot("running"));
			const late = deferred<void>();
			const interrupt = vi.spyOn(t.services.gateway, "interrupt").mockReturnValue(late.promise);
			const send = vi.spyOn(t.services.gateway, "sendMessage");
			const remove = vi.spyOn(t.services.gateway, "deleteSession").mockResolvedValue();
			await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ retryable: true });
			// 旧任务自然结束不代表 interrupt 已返回；本次无法封存用量，不能因此恢复发送。
			read.mockResolvedValue(mode === "missing-usage" ? { ...t.snapshot(), usage: undefined } : t.snapshot());
			if (mode === "write-failed")
				t.db.exec(`CREATE TRIGGER fail_snapshot BEFORE UPDATE OF finalized_at ON kit_session_usage
				BEGIN SELECT RAISE(ABORT, 'disk failed'); END`);
			await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({
				details: { stage: "capture", execution_stopped: true },
			});
			expect(t.deletionStore.get(t.sessionId)?.stage).toBe("preparing");
			await expect(t.sessions.send(t.sessionId, { text: "before late interrupt" })).rejects.toMatchObject({
				code: "conflict",
			});
			const restarted = t.restart();
			await expect(restarted.sessions.delete(t.sessionId)).rejects.toMatchObject({ details: { stage: "capture" } });
			await expect(restarted.sessions.send(t.sessionId, { text: "after restart" })).rejects.toMatchObject({
				code: "conflict",
				message: "会话正在删除或删除结果待确认，请先重试删除",
			});
			await expect(
				restarted.sessions.respondToolApproval(t.sessionId, { batch_id: "b", call_id: "c", result: "allow" }),
			).rejects.toMatchObject({ code: "conflict", message: "会话正在删除或删除结果待确认，请先重试删除" });
			expect(restarted.services.sessionIndex.get(t.sessionId)).not.toBeNull();
			expect(interrupt).toHaveBeenCalledOnce();
			expect(send).not.toHaveBeenCalled();
			expect(remove).not.toHaveBeenCalled();
			late.resolve();
			if (mode === "write-failed") t.db.exec("DROP TRIGGER fail_snapshot");
			read.mockResolvedValue(t.snapshot());
			await restarted.sessions.delete(t.sessionId);
			expect(remove).toHaveBeenCalledOnce();
			expect(restarted.services.sessionIndex.get(t.sessionId)).toBeNull();
			expect(restarted.services.memberUsage.summary(t.member.member_id).metrics.output_tokens.value).toBe(80);
		},
	);

	it("等待在途发送完成后采集，同时拒绝新发送、审批和重复删除", async () => {
		const t = await setup();
		const sending = deferred<{ accepted: boolean; event_ids: string[] }>();
		const started = deferred<void>();
		vi.spyOn(t.services.gateway, "sendMessage").mockImplementation(() => {
			started.resolve();
			return sending.promise;
		});
		const read = vi.spyOn(t.services.gateway, "getSession").mockResolvedValue(t.snapshot());
		vi.spyOn(t.services.gateway, "deleteSession").mockResolvedValue();
		const first = t.sessions.send(t.sessionId, { text: "in-flight" });
		await started.promise;
		read.mockClear();
		const deleting = t.sessions.delete(t.sessionId);
		await expect(t.sessions.send(t.sessionId, { text: "late" })).rejects.toMatchObject({ code: "conflict" });
		await expect(
			t.sessions.respondToolApproval(t.sessionId, { batch_id: "b", call_id: "c", result: "allow" }),
		).rejects.toMatchObject({ code: "conflict" });
		await expect(t.sessions.delete(t.sessionId)).rejects.toMatchObject({ code: "conflict" });
		expect(read).not.toHaveBeenCalled();
		sending.resolve({ accepted: true, event_ids: [] });
		await first;
		await deleting;
		expect(t.services.memberUsage.summary(t.member.member_id).session_count).toBe(1);
	});

	it("真实成员HTTP删除仍受确认闸门保护，成功后统计保留", async () => {
		const t = await setup();
		const app = createApp(t.services);
		const login = await app.request("/api/kit/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: "owner", password: "Usage!Delete2026" }),
		});
		const token = ((await login.json()) as { data: { access_token: string } }).data.access_token;
		const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
		const interrupt = vi.spyOn(t.services.gateway, "interrupt");
		const remove = vi.spyOn(t.services.gateway, "deleteSession");
		expect(
			(
				await app.request(`/api/kit/sessions/${t.sessionId}`, {
					method: "DELETE",
					headers,
					body: JSON.stringify({ plan_id: "p", confirm_token: "forged" }),
				})
			).status,
		).toBe(428);
		expect(interrupt).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
		const plan = await app.request(`/api/kit/sessions/${t.sessionId}/plan`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action: "delete" }),
		});
		const { data } = (await plan.json()) as { data: { plan_id: string; confirm_token: string } };
		expect(
			(await app.request(`/api/kit/sessions/${t.sessionId}`, { method: "DELETE", headers, body: JSON.stringify(data) }))
				.status,
		).toBe(200);
		expect(t.services.memberUsage.summary(t.member.member_id).deleted_session_count).toBe(1);
	});
});
