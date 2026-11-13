import { Attachments, Chat, ConfirmDialog } from "@openagentpack/kit-chat-ui";
import { useChat, useComposer } from "@openagentpack/kit-sdk/chat/hooks";
import type { ArtifactHost } from "@openagentpack/kit-sdk/files";
import { useArtifactActions, useAttachments } from "@openagentpack/kit-sdk/files/hooks";
import { createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import { createSessionEventChatProvider } from "@openagentpack/kit-sdk/providers/session-events";
import { createRequest } from "@openagentpack/kit-sdk/request";
import { useSessionDetails, useSessionDirectory } from "@openagentpack/kit-sdk/sessions/hooks";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

// Independent frontend: public Client/Provider only, no KitProvider or private hooks.
const request = createRequest({
	baseUrl: new URLSearchParams(location.search).get("backend") ?? "",
	headers: () => ({ Authorization: "Bearer example-user" }),
});
const provider = createSessionEventChatProvider({
	request,
	stream: {
		buildRequest: ({ sessionId, after }) => ({
			path: `/v1/conversations/${encodeURIComponent(sessionId)}/watch?cursor=${encodeURIComponent(after ?? "")}`,
		}),
	},
	sendMessage: {
		buildRequest: ({ sessionId, body }) => ({
			path: "/v1/reply",
			init: {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ conversation: sessionId, input: body.text, request: body.client_message_id }),
			},
		}),
		mapResponse: async (response) => (await response.json()).payload,
	},
	interrupt: {
		buildRequest: () => ({ path: "/v1/stop", init: { method: "PUT" } }),
		mapResponse: async (response) => (await response.json()).payload,
	},
	toolApprovals: {
		buildRequest: () => ({ path: "/v1/approvals" }),
		mapResponse: async (response) => (await response.json()).payload,
	},
	submitToolApproval: {
		buildRequest: ({ decision }) => ({
			path: "/v1/approvals",
			init: { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision) },
		}),
		mapResponse: async (response) => (await response.json()).payload,
	},
});

const result = async <T,>(response: Response): Promise<T> => (await response.json()).payload;
const client = createKitClient({
	request,
	operations: {
		sessionAgents: { buildRequest: () => ({ path: "/v1/groups" }), mapResponse: result },
		sessions: {
			buildRequest: ([query]) => ({ path: "/v1/search", init: { method: "POST", body: JSON.stringify(query) } }),
			mapResponse: result,
		},
		session: { buildRequest: ([id]) => ({ path: `/v1/detail/${id}` }), mapResponse: result },
		createSession: {
			buildRequest: ([input]) => ({ path: "/v1/create", init: { method: "PUT", body: JSON.stringify(input) } }),
			mapResponse: result,
		},
		uploadFile: {
			buildRequest: ([input]) => ({ path: "/v1/upload", init: { method: "PUT", body: input.bytes as BodyInit } }),
			mapResponse: result,
		},
		fileStatus: { buildRequest: ([id]) => ({ path: `/v1/scan/${id}` }), mapResponse: result },
		sessionPlan: {
			buildRequest: ([id, action]) => ({
				path: "/v1/preview",
				init: { method: "PUT", body: JSON.stringify({ id, action }) },
			}),
			mapResponse: result,
		},
		deleteSession: {
			buildRequest: ([id, confirmation]) => ({
				path: "/v1/remove",
				init: { method: "PATCH", body: JSON.stringify({ id, ...confirmation }) },
			}),
			mapResponse: result,
		},
		downloadFile: { buildRequest: ([id]) => ({ path: `/v1/bytes/${id}` }), mapResponse: (response) => response },
	},
});
const host: ArtifactHost = {
	fallbackSave: async ({ filename, blob }) => {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.download = filename;
		anchor.href = url;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		return true;
	},
};

function Example() {
	const [sessionId, setSessionId] = useState<string | null>("example-session");
	const chat = useChat({ sessionId, provider });
	const directory = useSessionDirectory({ client });
	const details = useSessionDetails({ client, sessionId, setMessageFiles: chat.setMessageFiles });
	const attachments = useAttachments({ client, pollIntervalMs: 20 });
	const composer = useComposer({
		client,
		sessionId,
		agentSlug: "demo",
		files: attachments.files,
		send: chat.send,
		onSessionCreated: setSessionId,
		onAccepted: attachments.consume,
	});
	const artifacts = useArtifactActions({ client, host, sessionId: sessionId ?? undefined });
	const pending = directory.actions.pending;
	const [error, setError] = useState<string | null>(null);
	return (
		<main className="flex h-dvh flex-col" data-kit-appearance="workspace">
			<p role="status">{chat.connected ? "示例后端已连接" : "正在连接"}</p>
			<div>
				<p>目录分组：{directory.groups.map((group) => group.slug).join(",")}</p>
				<p>详情：{details.data?.title}</p>
				<button type="button" onClick={() => setSessionId(null)}>
					创建新示例会话
				</button>
				<Attachments
					items={attachments.files.map((file) => ({
						uid: file.file_id,
						name: file.filename,
						status: file.available ? "done" : "uploading",
					}))}
					onSelectFiles={(files) => void attachments.upload(files)}
				/>
				<p>扫描：{attachments.processing ? "checking" : "ready"}</p>
				<button type="button" onClick={() => void directory.actions.request("example-session", "delete")}>
					准备删除示例会话
				</button>
				<button type="button" onClick={() => void artifacts.download("file")}>
					下载示例产物
				</button>
			</div>
			{pending && (
				<ConfirmDialog
					title="确认删除示例会话"
					body={JSON.stringify(pending.plan?.diff)}
					busy={directory.actions.busy}
					onCancel={directory.actions.cancel}
					onConfirm={() => void directory.actions.confirm()}
				/>
			)}
			{error && <p role="alert">{error}</p>}
			<Chat
				messages={chat.messages}
				variant="workspace"
				canSend={(!sessionId || chat.canSend) && !attachments.processing && !composer.pending}
				turnRunning={chat.turnRunning}
				onSend={async (text) => {
					try {
						await composer.send(text);
					} catch (cause) {
						setError(cause instanceof Error ? cause.message : "发送失败");
						throw cause;
					}
				}}
				onStop={chat.stop}
			/>
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<Example />);
