import { KitError, type ToolApprovalDecision, type ToolApprovalsResponse } from "@openagentpack/kit-sdk/protocol";
import { GatewaySendRejectedError } from "../gateway/send-error.ts";
import type { ProviderGateway } from "../gateway/types.ts";
import { readApprovalState } from "./approval-history.ts";
import type { EventBufferRegistry } from "./event-buffer.ts";

/** 单进程审批互斥与结果不明保护；事件正文仍只在内存且以 Provider 为权威。 */
export function createToolApprovals(
	gateway: ProviderGateway,
	buffers: EventBufferRegistry,
	admit?: (
		sessionId: string,
		decision: ToolApprovalDecision,
		send: () => Promise<{ event_ids: string[] }>,
	) => Promise<{ event_ids: string[] }>,
) {
	const active = new Set<string>();
	const submitted = new Map<string, "submitted" | "uncertain">();
	const keyOf = (sessionId: string, batchId: string, callId: string) => JSON.stringify([sessionId, batchId, callId]);
	function clearInactive(sessionId: string, current: ToolApprovalsResponse) {
		for (const key of submitted.keys()) {
			const [owner, batch, call] = JSON.parse(key) as [string, string, string];
			if (owner === sessionId && (batch !== current.batch_id || !current.pending_call_ids.includes(call)))
				submitted.delete(key);
		}
	}

	async function state(sessionId: string, refresh: boolean): Promise<ToolApprovalsResponse> {
		const current = await readApprovalState(gateway, buffers, sessionId);
		clearInactive(sessionId, current);
		for (const request of current.requests) {
			const key = keyOf(sessionId, request.batch_id, request.call_id);
			const status = submitted.get(key);
			// 明确刷新后仍 pending 的不确定请求，可由用户再次打开确认框决定；禁止后台自动重发。
			if (refresh && status === "uncertain") submitted.delete(key);
			else if (status) {
				request.status = status;
				request.actionable = false;
			}
		}
		return current;
	}
	return {
		list: (sessionId: string) => state(sessionId, true),
		async respond(sessionId: string, decision: ToolApprovalDecision) {
			const key = keyOf(sessionId, decision.batch_id, decision.call_id);
			if (active.has(key) || submitted.has(key)) throw new KitError("conflict", "审批已提交或正在确认结果，请刷新");
			active.add(key);
			try {
				const current = await state(sessionId, true);
				const request = current.requests.find(
					(item) => item.batch_id === decision.batch_id && item.call_id === decision.call_id,
				);
				if (
					!current.requires_action ||
					current.batch_id !== decision.batch_id ||
					!current.pending_call_ids.includes(decision.call_id) ||
					!request?.actionable
				) {
					throw new KitError("conflict", "审批已过期、已处理或暂不支持，请刷新");
				}
				const send = async () => {
					try {
						const result = await gateway.respondToolApproval(sessionId, {
							...decision,
							...(request.session_thread_id ? { session_thread_id: request.session_thread_id } : {}),
						});
						submitted.set(key, "submitted");
						return result;
					} catch (error) {
						if (error instanceof GatewaySendRejectedError) throw error;
						submitted.set(key, "uncertain");
						throw new KitError("provider_error", "审批结果尚不确定，请先刷新查询；不会自动重发", { retryable: false });
					}
				};
				return await (admit ? admit(sessionId, decision, send) : send());
			} finally {
				active.delete(key);
			}
		},
	};
}
