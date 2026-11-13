import { transformSessionEvent } from "../../messages/merge.ts";
import type { ChatProvider } from "../contract.ts";
import type { KitClient } from "./client.ts";

/** 保留 Kit Server 请求、游标和错误行为，并提供默认消息转换；不自动重发。 */
export function createKitChatProvider(
	client: Pick<KitClient, "stream" | "sendMessage" | "interrupt" | "toolApprovals" | "submitToolApproval"> &
		Partial<Pick<KitClient, "listThreads" | "listThreadEvents">>,
): ChatProvider {
	return {
		transformMessage: transformSessionEvent,
		...(client.listThreads ? { listThreads: client.listThreads.bind(client) } : {}),
		...(client.listThreadEvents ? { listThreadEvents: client.listThreadEvents.bind(client) } : {}),
		stream: (sessionId, options) => client.stream(sessionId, options),
		sendMessage: (sessionId, body) => client.sendMessage(sessionId, body),
		interrupt: (sessionId) => client.interrupt(sessionId),
		toolApprovals: (sessionId) => client.toolApprovals(sessionId),
		submitToolApproval: (sessionId, decision) => client.submitToolApproval(sessionId, decision),
	};
}
