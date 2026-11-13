import { KitError, SendMessageResponseSchema, ToolApprovalsResponseSchema } from "@openagentpack/kit-sdk/protocol";
import type { SessionEventChatProviderOptions } from "@openagentpack/kit-sdk/providers/session-events";
import { createRequest } from "@openagentpack/kit-sdk/request";

export interface BackendConfig {
	// Explicit runtime configuration; may be cross-origin.
	baseUrl: string;
	// Application identity only. Never supply a provider credential.
	getAppToken: () => Promise<string>;
}

export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new KitError("provider_error", "The backend returned an invalid object.");
	return value as Record<string, unknown>;
}

export async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new KitError("provider_error", "The backend returned invalid JSON.");
	}
}

async function result(response: Response): Promise<unknown> {
	const envelope = record(await readJson(response));
	if (!("result" in envelope)) throw new KitError("provider_error", "The backend response has no result.");
	return envelope.result;
}

// These routes and the { result } wrapper belong to this sample business backend.
export function createBackendHttp(config: BackendConfig) {
	const request = createRequest({
		baseUrl: config.baseUrl,
		headers: async () => ({ Authorization: `Bearer ${await config.getAppToken()}` }),
	});
	const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`;
	const operations: Pick<
		SessionEventChatProviderOptions,
		"sendMessage" | "interrupt" | "toolApprovals" | "submitToolApproval"
	> = {
		sendMessage: {
			buildRequest({ sessionId, body }) {
				if (body.attachments?.length)
					throw new KitError("invalid_request", "Mount uploaded files when creating a session.");
				return {
					path: `${sessionPath(sessionId)}/messages`,
					init: {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ input: body.text, request_id: body.client_message_id }),
					},
				};
			},
			async mapResponse(response) {
				const parsed = SendMessageResponseSchema.safeParse(await result(response));
				if (!parsed.success) throw new KitError("provider_error", "The backend returned an invalid send result.");
				return parsed.data;
			},
		},
		interrupt: {
			buildRequest: ({ sessionId }) => ({ path: `${sessionPath(sessionId)}/interrupt`, init: { method: "POST" } }),
			async mapResponse(response) {
				const value = record(await result(response));
				if (typeof value.interrupted !== "boolean")
					throw new KitError("provider_error", "The backend returned an invalid interruption result.");
				return { interrupted: value.interrupted };
			},
		},
		toolApprovals: {
			buildRequest: ({ sessionId }) => ({ path: `${sessionPath(sessionId)}/approvals` }),
			async mapResponse(response) {
				const parsed = ToolApprovalsResponseSchema.safeParse(await result(response));
				if (!parsed.success) throw new KitError("provider_error", "The backend returned invalid tool approvals.");
				return parsed.data;
			},
		},
		submitToolApproval: {
			buildRequest: ({ sessionId, decision }) => ({
				path: `${sessionPath(sessionId)}/approvals`,
				init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision) },
			}),
			async mapResponse(response) {
				const parsed = SendMessageResponseSchema.safeParse(await result(response));
				if (!parsed.success) throw new KitError("provider_error", "The backend returned an invalid approval result.");
				return parsed.data;
			},
		},
	};

	return { request, sessionPath, operations };
}
