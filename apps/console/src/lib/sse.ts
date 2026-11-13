import type { OperationView } from "@openagentpack/kit-sdk/protocol";
import { decodeFrame } from "@openagentpack/kit-sdk/protocol";
import { createSseStream } from "@openagentpack/kit-sdk/stream";
import { adminRequest } from "./kit.ts";

/** Operation 进度 SSE：只交付 operation 帧，自然 EOF 正常结束，无会话空闲超时。 */
export async function streamOperation(
	operationId: string,
	onOperation: (view: OperationView) => void,
	signal?: AbortSignal,
): Promise<void> {
	const res = await adminRequest().response(`/api/admin/operations/${encodeURIComponent(operationId)}/events`, {
		signal,
	});
	if (!res.body) return;
	for await (const raw of createSseStream(res.body, { signal })) {
		const frame = decodeFrame(raw);
		if (frame?.type === "operation") onOperation(frame.data as unknown as OperationView);
	}
}
