import {
	type EventEntry,
	type OptimisticOverlay,
	projectPhase,
	type TurnPhase,
	transportPosition,
} from "@openagentpack/kit-sdk/chat";
import { deriveApprovalState, stableEventId } from "@openagentpack/kit-sdk/protocol";
import type { EventBuffer } from "./event-buffer.ts";
import { requestFinished } from "./usage-limit-completion.ts";

/** 已受理但尚未被 Provider 终态证明完成的回合；只保存 ID 和状态证据，不保存消息正文。 */
export interface AcceptedTurn {
	eventIds: string[];
	previousStatus: string | null;
	clientMessageId?: string;
	knownUserIds: Set<string>;
	after: number;
	sequence: number;
}

export type SessionRuntimeStatus = "running" | "requires_action" | "failed" | "idle";

function entriesOf(buffer: EventBuffer): EventEntry[] {
	return buffer.events.map((event, index) => {
		const transport = transportPosition(buffer.latest.get(index));
		return {
			identity: event.event_id || stableEventId(event),
			event,
			sequence: index + 1,
			updated: transport?.sequence ?? index + 1,
			transport,
			firstTransport: transport,
		};
	});
}

function overlayOf(turn: AcceptedTurn): OptimisticOverlay {
	return {
		message: {
			id: `accepted:${turn.sequence}`,
			role: "user",
			parts: [],
			status: "pending",
			...(turn.clientMessageId ? { clientMessageId: turn.clientMessageId } : {}),
		},
		generation: turn.sequence,
		after: turn.after,
		knownUserIds: turn.knownUserIds,
		providerEventIds: new Set(turn.eventIds),
		sequence: turn.sequence,
	};
}

function statusOfPhase(phase: TurnPhase): SessionRuntimeStatus {
	if (phase === "running" || phase === "stopping") return "running";
	if (phase === "requires_action") return "requires_action";
	if (phase === "failed") return "failed";
	return "idle";
}

/**
 * 由完整账本和受理中的回合共同推导状态。旧 idle 到达较早不会改变 pending turn；
 * 只有能证明本轮用户回显及主状态终态的证据才允许清除它。
 */
export function projectSessionRuntime(
	buffer: EventBuffer,
	turn: AcceptedTurn | undefined,
): { status: SessionRuntimeStatus; finished: boolean } {
	const finished = turn
		? requestFinished(
				buffer.events,
				buffer.latestStatus,
				{
					event_ids: turn.eventIds.length ? JSON.stringify(turn.eventIds) : null,
					previous_status: turn.previousStatus,
				},
				buffer,
			)
		: false;
	const projected = projectPhase(entriesOf(buffer), turn && !finished ? [overlayOf(turn)] : []);
	const approvals = deriveApprovalState(buffer.events, buffer.latestStatus);
	return {
		status: approvals.requires_action ? "requires_action" : statusOfPhase(projected.phase),
		finished,
	};
}
