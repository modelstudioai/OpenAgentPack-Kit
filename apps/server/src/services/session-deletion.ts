import { KitError, sessionStatusOf } from "@openagentpack/kit-sdk/protocol";
import type { GatewaySessionInfo, ProviderGateway } from "../gateway/types.ts";
import type { SessionDeletionStore } from "../store/session-deletions.ts";
import type { SessionIndex } from "../store/sessions.ts";
import { readSessionApprovalSnapshot } from "./approval-history.ts";
import type { EventBufferRegistry } from "./event-buffer.ts";
import type { MemberUsageService } from "./member-usage.ts";

class DeadlineError extends Error {}
async function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// 已完成的 Promise 会抢在 0ms timer 之前；显式检查才能终止持续有响应的轮询。
		if (Date.now() >= deadline) {
			void work.catch(() => {});
			throw new DeadlineError();
		}
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new DeadlineError()), deadline - Date.now());
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
export interface SessionDeletionDeps {
	gateway: ProviderGateway;
	buffers: EventBufferRegistry;
	sessionIndex: SessionIndex;
	memberUsage: MemberUsageService;
	deletionStore: SessionDeletionStore;
	timeoutMs?: number;
	pollMs?: number;
}
interface Attempt {
	sessionId: string;
	subjectId: string;
	deadline: number;
	stage: "stop" | "capture" | "delete" | "finalize";
	executionStopped: boolean;
	remoteStarted: boolean;
	confirmedDeleted: boolean;
	keepWriteProtection: boolean;
}
function failureMessage(attempt: Attempt) {
	if (attempt.confirmedDeleted) return "远端会话已删除，用量快照已保存，本地删除状态待恢复，请重试";
	if (attempt.remoteStarted) return "删除结果尚未确认，用量快照已保存，请重试删除以核实状态";
	if (attempt.stage === "capture") return "执行已停止，用量保存失败，会话未删除，请重试";
	if (attempt.stage === "delete") return "用量快照已保存，删除失败，会话未删除，请重试";
	return "未能确认执行已停止，会话未删除，请重试";
}

/** 已通过确认闸门后调用。只有本次快照落库成功，才会向 Provider 发 DELETE。 */
export function createSessionDeletion(deps: SessionDeletionDeps) {
	const { gateway, buffers, sessionIndex, memberUsage, deletionStore } = deps;
	const timeoutMs = deps.timeoutMs ?? 30_000;
	const pollMs = deps.pollMs ?? 500;
	async function stopped(info: GatewaySessionInfo, deadline: number) {
		if (["terminated", "archived", "stopped", "completed", "failed"].includes(info.status)) return true;
		if (info.status !== "idle") return false;
		if (info.stop_reason) return info.stop_reason.type !== "requires_action";
		// 详情可能不带停止原因；分页历史中的主线程审批状态仍是必要证据。
		const controller = new AbortController();
		try {
			const snapshot = await beforeDeadline(
				readSessionApprovalSnapshot(gateway, buffers, info.session_id, controller.signal),
				deadline,
			);
			// 详情为 idle 但较新的主状态仍 running 时，不能把“无需审批”误认为执行已结束。
			if (snapshot.latestStatus && sessionStatusOf(snapshot.latestStatus) !== "idle") return false;
			return !snapshot.approvals.requires_action;
		} finally {
			controller.abort();
		}
	}
	async function waitUntilStopped(attempt: Attempt, info: GatewaySessionInfo) {
		if (await stopped(info, attempt.deadline)) return;
		// 当前 idle 无法证明此前发出的 interrupt 已不再在途；直到删除完成都保持写保护。
		attempt.keepWriteProtection = true;
		await beforeDeadline(gateway.interrupt(attempt.sessionId), attempt.deadline);
		for (;;) {
			const current = await beforeDeadline(gateway.getSession(attempt.sessionId), attempt.deadline);
			if (!current) throw new KitError("conflict", "停止执行后会话不可查询");
			if (await stopped(current, attempt.deadline)) return;
			await beforeDeadline(new Promise((resolve) => setTimeout(resolve, pollMs)), attempt.deadline);
		}
	}
	async function capture(attempt: Attempt, info: GatewaySessionInfo) {
		attempt.stage = "stop";
		await waitUntilStopped(attempt, info);
		attempt.executionStopped = true;
		attempt.stage = "capture";
		// 与状态确认分开重新读取；不用中断前或后台刷新缓存代替本次快照。
		const final = await beforeDeadline(gateway.getSession(attempt.sessionId), attempt.deadline);
		if (!final || !(await stopped(final, attempt.deadline))) throw new KitError("conflict", "会话状态发生变化");
		memberUsage.captureFinal(attempt.sessionId, final);
		// 封存新快照不能覆盖旧请求的不确定性，否则重启会丢失迟到 DELETE / interrupt 的保护。
		if (!attempt.remoteStarted && !attempt.keepWriteProtection)
			deletionStore.set(attempt.sessionId, attempt.subjectId, "captured");
	}
	async function removeRemote(attempt: Attempt) {
		attempt.stage = "delete";
		deletionStore.set(attempt.sessionId, attempt.subjectId, "deleting");
		attempt.remoteStarted = true;
		try {
			await beforeDeadline(gateway.deleteSession(attempt.sessionId), attempt.deadline);
			attempt.confirmedDeleted = true;
		} catch (error) {
			deletionStore.set(attempt.sessionId, attempt.subjectId, "uncertain");
			// 超时请求可能仍执行，保持封存与写保护直到下一次确认。
			if (error instanceof DeadlineError) throw error;
			const remaining = await beforeDeadline(gateway.getSession(attempt.sessionId), attempt.deadline);
			if (!remaining) {
				attempt.confirmedDeleted = true;
				return;
			}
			// GET 仍存在不代表 DELETE 已失败：连接错误后的远端请求可能稍后才执行。
			throw error;
		}
	}
	function fail(attempt: Attempt): never {
		if (!attempt.remoteStarted && !attempt.keepWriteProtection) {
			try {
				memberUsage.releaseFinal(attempt.sessionId);
				deletionStore.clear(attempt.sessionId);
			} catch {
				/* 数据库不可写时保留持久阶段，恢复后再次确认；不泄露底层错误。 */
			}
		}
		throw new KitError("conflict", failureMessage(attempt), {
			retryable: true,
			details: {
				stage: attempt.stage,
				execution_stopped: attempt.executionStopped,
				deletion_uncertain: attempt.remoteStarted && !attempt.confirmedDeleted,
			},
		});
	}
	async function execute(attempt: Attempt, drain: Promise<unknown>) {
		deletionStore.set(attempt.sessionId, attempt.subjectId, attempt.remoteStarted ? "uncertain" : "preparing");
		await beforeDeadline(drain, attempt.deadline);
		const info = await beforeDeadline(gateway.getSession(attempt.sessionId), attempt.deadline);
		if (info) {
			await capture(attempt, info);
			await removeRemote(attempt);
		} else {
			if (!attempt.remoteStarted || !memberUsage.hasFinalSnapshot(attempt.sessionId))
				throw new KitError("conflict", "会话已不可查询且没有可确认的删除快照");
			attempt.confirmedDeleted = true;
		}
		attempt.stage = "finalize";
		memberUsage.markDeleted(attempt.sessionId);
	}
	return async (sessionId: string, drain: Promise<unknown>) => {
		const row = sessionIndex.get(sessionId);
		if (!row) throw new KitError("not_found", "会话不存在");
		if (!memberUsage.isMemberSession(sessionId)) {
			await beforeDeadline(drain, Date.now() + timeoutMs);
			await gateway.deleteSession(sessionId);
			sessionIndex.remove(sessionId);
			return;
		}
		const previous = deletionStore.get(sessionId);
		const recovering = previous?.stage === "deleting" || previous?.stage === "uncertain";
		const attempt: Attempt = {
			sessionId,
			subjectId: row.subject_id,
			deadline: Date.now() + timeoutMs,
			stage: recovering ? "delete" : "stop",
			executionStopped: false,
			remoteStarted: recovering,
			confirmedDeleted: false,
			// 准备/封存阶段可能继承未确认结束的中断；idle 只说明当前状态，不能解锁旧请求。
			keepWriteProtection: previous?.stage === "preparing" || previous?.stage === "captured",
		};
		try {
			await execute(attempt, drain);
		} catch {
			fail(attempt);
		}
	};
}
