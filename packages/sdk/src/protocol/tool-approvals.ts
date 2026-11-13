import { z } from "zod";
import { eventDataOf, type SessionEvent, sessionStatusOf, stopReasonOf, threadIdOf } from "./events.ts";

export const ToolApprovalDecisionSchema = z.object({
	batch_id: z.string().min(1),
	call_id: z.string().min(1),
	result: z.enum(["allow", "deny"]),
	deny_message: z.string().trim().max(200).optional(),
});
export type ToolApprovalDecision = z.infer<typeof ToolApprovalDecisionSchema>;

export const ToolApprovalSchema = z.object({
	batch_id: z.string(),
	call_id: z.string(),
	request_event_id: z.string().nullable(),
	name: z.string(),
	arguments: z.unknown(),
	tool_type: z.string(),
	server_label: z.string().optional(),
	session_thread_id: z.string().optional(),
	actionable: z.boolean(),
	status: z.enum(["pending", "submitted", "uncertain"]).optional(),
	result: z.enum(["allow", "deny"]).optional(),
});
export type ToolApproval = z.infer<typeof ToolApprovalSchema>;

export const ToolApprovalsResponseSchema = z.object({
	requires_action: z.boolean(),
	batch_id: z.string().nullable(),
	pending_call_ids: z.array(z.string()),
	requests: z.array(ToolApprovalSchema),
});
export type ToolApprovalsResponse = z.infer<typeof ToolApprovalsResponseSchema>;

export function toolApprovalKey(batchId: string, callId: string): string {
	return JSON.stringify([batchId, callId]);
}

/** 这是 SDK 事件的展示投影，批准时仍须按最新 Session 状态校验。 */
export function readToolApprovalRequest(event: SessionEvent): ToolApproval | undefined {
	if (event.type !== "tool_approval_request") return undefined;
	const data = eventDataOf(event);
	if (!data || typeof data.batch_id !== "string" || !data.batch_id || typeof data.call_id !== "string" || !data.call_id)
		return undefined;
	const supported = data.tool_type === "builtin" || data.tool_type === "mcp";
	const thread = threadIdOf(event);
	return {
		batch_id: data.batch_id,
		call_id: data.call_id,
		request_event_id: event.event_id ?? null,
		name: typeof data.name === "string" ? data.name : "未知工具",
		arguments: data.arguments ?? null,
		tool_type: typeof data.tool_type === "string" ? data.tool_type : "unknown",
		...(typeof data.server_label === "string" ? { server_label: data.server_label } : {}),
		...(thread ? { session_thread_id: thread } : {}),
		actionable:
			supported &&
			typeof data.name === "string" &&
			!!data.name &&
			(typeof data.arguments === "string" || (data.arguments !== null && typeof data.arguments === "object")),
		status: "pending",
	};
}

function readApprovalResponse(event: SessionEvent): { key: string; result: "allow" | "deny" } | undefined {
	if (event.type !== "tool_approval_response") return;
	const data = eventDataOf(event);
	if (!data || typeof data.batch_id !== "string" || typeof data.call_id !== "string") return;
	if (data.result !== "allow" && data.result !== "deny") return;
	return { key: toolApprovalKey(data.batch_id, data.call_id), result: data.result };
}

/** 同 ID 快照保持原展示位置；调用方可传入按更新顺序记录的最新主会话状态。 */
export function deriveApprovalState(
	events: readonly SessionEvent[],
	latestStatus?: SessionEvent,
): ToolApprovalsResponse {
	const latest =
		latestStatus ?? [...events].reverse().find((event) => event.type === "session_status" && !threadIdOf(event));
	const reason = latest ? stopReasonOf(latest) : undefined;
	const requiresAction = !!latest && sessionStatusOf(latest) === "idle" && reason?.type === "requires_action";
	const batchId = requiresAction && typeof reason.pending_batch_id === "string" ? reason.pending_batch_id : null;
	const pending =
		requiresAction && Array.isArray(reason.pending_call_ids)
			? [...new Set(reason.pending_call_ids.filter((id): id is string => typeof id === "string" && !!id))]
			: [];
	const requests = new Map<string, ToolApproval>();
	const responses = new Map<string, "allow" | "deny">();
	for (const event of events) {
		const request = readToolApprovalRequest(event);
		if (request && request.batch_id === batchId && pending.includes(request.call_id))
			requests.set(toolApprovalKey(request.batch_id, request.call_id), request);
		const response = readApprovalResponse(event);
		if (response) responses.set(response.key, response.result);
	}
	return {
		requires_action: requiresAction,
		batch_id: batchId,
		pending_call_ids: pending,
		requests: [...requests.entries()].map(([key, request]) => {
			const result = responses.get(key);
			return result ? { ...request, actionable: false, status: "submitted", result } : request;
		}),
	};
}
