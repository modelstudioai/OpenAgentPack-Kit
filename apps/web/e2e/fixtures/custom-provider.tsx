import { type UseChatResult, useChat } from "@openagentpack/kit-sdk/chat/hooks";
import type { SessionEvent, ToolApprovalDecision, ToolApprovalsResponse } from "@openagentpack/kit-sdk/protocol";
import type { ChatProvider, StreamSessionOptions } from "@openagentpack/kit-sdk/providers";
import { createKitClient } from "@openagentpack/kit-sdk/providers/kit";
import { KitProvider } from "@openagentpack/kit-sdk/providers/kit/react";
import { StrictMode, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

interface Subscription {
	provider: string;
	sessionId: string;
	options: StreamSessionOptions;
	active: boolean;
}
const subscriptions: Subscription[] = [];
const writes: { provider: string; sessionId: string; text: string }[] = [];
const decisions: ToolApprovalDecision[] = [];
const stops: string[] = [];
const outcomes: string[] = [];
const approvals = new Map<string, ToolApprovalsResponse>();
const pendingSends: (() => void)[] = [];
let holdSends = false;
let savedSend: UseChatResult["send"] | undefined;
let revision = 0;
const listeners = new Set<() => void>();
const changed = () => {
	revision++;
	for (const listener of listeners) listener();
};
const watch = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const key = (provider: string, sessionId: string) => `${provider}/${sessionId}`;
const emit = (event: SessionEvent, active = true) => {
	for (const subscription of subscriptions) if (subscription.active === active) subscription.options.onEvent?.(event);
};
function prepareApprovals() {
	for (const subscription of subscriptions.filter((value) => value.active)) {
		const requests: ToolApprovalsResponse["requests"] = ["call-allow", "call-deny"].map((callId) => ({
			batch_id: "batch",
			call_id: callId,
			request_event_id: `request-${callId}`,
			name: "search",
			arguments: "{}",
			tool_type: "builtin",
			status: "pending",
			actionable: true,
		}));
		approvals.set(key(subscription.provider, subscription.sessionId), {
			requires_action: true,
			batch_id: "batch",
			pending_call_ids: requests.map((request) => request.call_id),
			requests,
		});
	}
}
function fixtureProvider(provider: string): ChatProvider {
	return {
		async stream(sessionId, options = {}) {
			const subscription = { provider, sessionId, options, active: true };
			subscriptions.push(subscription);
			changed();
			await new Promise<void>((_resolve, reject) => {
				const abort = () => {
					subscription.active = false;
					changed();
					reject(new Error("aborted"));
				};
				if (options.signal?.aborted) abort();
				else options.signal?.addEventListener("abort", abort, { once: true });
			});
		},
		async sendMessage(sessionId, body) {
			writes.push({ provider, sessionId, text: body.text });
			changed();
			if (holdSends) await new Promise<void>((resolve) => pendingSends.push(resolve));
			const eventId = `${provider}/${sessionId}/user-${writes.length}`;
			for (const subscription of subscriptions)
				if (subscription.provider === provider && subscription.sessionId === sessionId)
					subscription.options.onEvent?.({
						event_id: eventId,
						type: "message",
						role: "user",
						content: [{ type: "text", text: body.text }],
						metadata: { client_message_id: body.client_message_id },
					});
			return { session_id: sessionId, accepted: true, event_ids: [eventId] };
		},
		async interrupt(sessionId) {
			stops.push(key(provider, sessionId));
			changed();
			return { interrupted: true };
		},
		async toolApprovals(sessionId) {
			return (
				approvals.get(key(provider, sessionId)) ?? {
					requires_action: false,
					batch_id: null,
					pending_call_ids: [],
					requests: [],
				}
			);
		},
		async submitToolApproval(sessionId, decision) {
			decisions.push(decision);
			const current = approvals.get(key(provider, sessionId));
			if (current)
				approvals.set(key(provider, sessionId), {
					...current,
					pending_call_ids: current.pending_call_ids.filter((id) => id !== decision.call_id),
					requests: current.requests.map((request) =>
						request.call_id === decision.call_id ? { ...request, status: "submitted" } : request,
					),
				});
			changed();
			return { session_id: sessionId, accepted: true, event_ids: [`decision-${decisions.length}`] };
		},
	};
}
const providers = { a: fixtureProvider("a"), b: fixtureProvider("b") };
const fallbackClient = createKitClient({ baseUrl: `${location.origin}/unexpected-kit` });
const params = new URLSearchParams(location.search);
function execute(operation: () => Promise<void>) {
	void operation().then(
		() => {
			outcomes.push("success");
			changed();
		},
		(error: unknown) => {
			outcomes.push(error instanceof Error ? error.message : String(error));
			changed();
		},
	);
}
function ChatProbe({
	sessionId,
	provider,
	onCreate,
}: {
	sessionId: string | null;
	provider: ChatProvider;
	onCreate: () => void;
}) {
	const chat = useChat({ sessionId, provider });
	const decide = (result: "allow" | "deny") => {
		const pending = chat.approvals.find((approval) => approval.actionable && approval.status === "pending");
		if (pending) return chat.submitApproval({ batch_id: pending.batch_id, call_id: pending.call_id, result });
		return Promise.reject(new Error("没有待审批项"));
	};
	return (
		<section>
			<pre data-testid="chat-state">{JSON.stringify(chat)}</pre>
			<div className="flex flex-wrap gap-2">
				<button type="button" onClick={() => execute(() => chat.send("hello"))}>
					发送
				</button>
				<button
					type="button"
					onClick={() => {
						savedSend = chat.send;
					}}
				>
					保存发送回调
				</button>
				<button
					type="button"
					onClick={() => {
						onCreate();
						execute(() => chat.send("created", { sessionId: "created" }));
					}}
				>
					创建后立即发送
				</button>
				<button type="button" onClick={() => execute(chat.stop)}>
					停止
				</button>
				<button type="button" onClick={() => execute(chat.refreshApprovals)}>
					刷新审批
				</button>
				<button type="button" onClick={() => execute(() => decide("allow"))}>
					批准
				</button>
				<button type="button" onClick={() => execute(() => decide("deny"))}>
					拒绝
				</button>
			</div>
		</section>
	);
}
function Harness() {
	useSyncExternalStore(watch, () => revision);
	const [mounted, setMounted] = useState(true);
	const [provider, setProvider] = useState<"a" | "b">("a");
	const [sessionId, setSessionId] = useState<string | null>(params.has("empty") ? null : "s1");
	const [, render] = useState(0);
	const stats = {
		opens: subscriptions.map(({ provider: name, sessionId: id, active }) => ({
			provider: name,
			sessionId: id,
			active,
		})),
		writes,
		stops,
		decisions,
		outcomes,
		pendingSends: pendingSends.length,
	};
	const controls: Record<string, () => void> = {
		就绪: () => {
			for (const subscription of subscriptions.filter((value) => value.active))
				subscription.options.onReady?.({ sessionId: subscription.sessionId, replayed: 0, cursor: null });
		},
		短快照: () =>
			emit({ event_id: "answer", type: "message", role: "assistant", content: [{ type: "text", text: "你" }] }),
		长快照: () =>
			emit({ event_id: "answer", type: "message", role: "assistant", content: [{ type: "text", text: "你好" }] }),
		完成: () => emit({ event_id: "status", type: "session_status", metadata: { status: "idle", stop_reason: null } }),
		确认停止: () =>
			emit({
				event_id: "status",
				type: "session_status",
				metadata: { status: "idle", stop_reason: { type: "cancelled" } },
			}),
		准备审批: prepareApprovals,
		重复渲染: () => render((value) => value + 1),
		切换会话: () => setSessionId("s2"),
		切换接入方: () => setProvider("b"),
		卸载: () => setMounted(false),
		挂载: () => setMounted(true),
		调用旧发送回调: () =>
			execute(() => savedSend?.("stale", { sessionId: "stale" }) ?? Promise.reject(new Error("未保存回调"))),
		旧连接迟到: () => {
			for (const subscription of subscriptions.filter((value) => !value.active))
				subscription.options.onReady?.({ sessionId: subscription.sessionId, replayed: 0 });
			emit(
				{ event_id: "late", type: "message", role: "assistant", content: [{ type: "text", text: "旧连接内容" }] },
				false,
			);
		},
		延迟发送响应: () => {
			holdSends = true;
		},
		释放发送响应: () => {
			holdSends = false;
			for (const resolve of pendingSends.splice(0)) resolve();
		},
	};
	const probe = mounted ? (
		<ChatProbe sessionId={sessionId} provider={providers[provider]} onCreate={() => setSessionId("created")} />
	) : null;
	return (
		<main className="p-4">
			<div className="flex flex-wrap gap-2">
				{Object.entries(controls).map(([label, action]) => (
					<button key={label} type="button" onClick={action}>
						{label}
					</button>
				))}
			</div>
			<pre data-testid="stats">{JSON.stringify(stats)}</pre>
			{params.has("context") ? <KitProvider client={fallbackClient}>{probe}</KitProvider> : probe}
		</main>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<Harness />
	</StrictMode>,
);
