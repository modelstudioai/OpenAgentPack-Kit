import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { AttachmentRef, MessageFileAssociation, ToolApprovalDecision } from "../../protocol/index.ts";
import type { ChatProvider } from "../../providers/contract.ts";
import { createKitChatProvider } from "../../providers/kit/provider.ts";
import { useOptionalKitContext } from "../../providers/kit/react/context.tsx";
import { type ChatController, createChatController } from "../controller.ts";

/** controller 按 sessionId 懒创建：允许「先建会话再发送」的同一闭包内调用。 */
export interface UseChatResult {
	messages: ReturnType<ChatController["getSnapshot"]>["messages"];
	threads: ReturnType<ChatController["getSnapshot"]>["threads"];
	multiAgent: ReturnType<ChatController["getSnapshot"]>["multiAgent"];
	artifacts: ReturnType<ChatController["getSnapshot"]>["artifacts"];
	turnRunning: boolean;
	streamError: ReturnType<ChatController["getSnapshot"]>["streamError"];
	connected: boolean;
	phase: ReturnType<ChatController["getSnapshot"]>["phase"];
	connection: ReturnType<ChatController["getSnapshot"]>["connection"];
	canSend: boolean;
	approvals: ReturnType<ChatController["getSnapshot"]>["approvals"];
	refreshApprovals: () => Promise<void>;
	submitApproval: (decision: ToolApprovalDecision) => Promise<void>;
	send: (
		text: string,
		options?: { sessionId?: string; attachments?: AttachmentRef[]; skills?: string[] },
	) => Promise<void>;
	/** 注入会话详情的 message_files 关联；刷新后历史用户气泡据此补附件分片。 */
	setMessageFiles: (entries: MessageFileAssociation[] | null) => void;
	stop: () => Promise<void>;
}

export interface UseChatOptions {
	sessionId: string | null;
	/** 稳定实例；显式提供时无需 KitProvider，且优先于 Context 的 Client。 */
	provider: ChatProvider;
}

interface ControllerEntry {
	sessionId: string;
	provider: ChatProvider;
	controller: ChatController;
}

/** 单会话对话 hook：连接、重连、乐观消息、turn 收敛全部在 controller 内。 */
export function useChat(sessionId: string | null): UseChatResult;
export function useChat(options: UseChatOptions): UseChatResult;
export function useChat(input: string | null | UseChatOptions): UseChatResult {
	const context = useOptionalKitContext();
	const options = typeof input === "object" && input !== null ? input : null;
	const explicitProvider = options?.provider;
	const defaultProvider = useMemo(
		() => (!explicitProvider && context?.client ? createKitChatProvider(context.client) : null),
		[context?.client, explicitProvider],
	);
	const sessionId = options ? options.sessionId : (input as string | null);
	const provider = explicitProvider ?? defaultProvider;
	if (!provider) throw new Error("kit-sdk/chat/hooks: 组件必须位于 <KitProvider> 内，或为 useChat 显式提供 provider");
	const binding = useMemo(() => ({ sessionId, provider }), [sessionId, provider]);
	const committedBinding = useRef(binding);
	const mounted = useRef(true);
	useLayoutEffect(() => {
		committedBinding.current = binding;
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, [binding]);
	const assertActive = useCallback(() => {
		if (!mounted.current || committedBinding.current !== binding)
			throw new Error("kit-sdk/chat/hooks: 会话接入已切换或组件已卸载");
	}, [binding]);
	const entryRef = useRef<ControllerEntry | null>(null);
	const mountEpoch = useRef(0);
	useEffect(() => {
		const epoch = ++mountEpoch.current;
		return () => {
			queueMicrotask(() => {
				if (mountEpoch.current === epoch) entryRef.current?.controller.dispose();
			});
		};
	}, []);

	// 构造不打开连接。旧 Controller 在提交阶段释放，不能在 render 内触发订阅者更新。
	const entry = useMemo(() => {
		if (!sessionId) return null;
		if (entryRef.current?.sessionId === sessionId && entryRef.current.provider === provider) return entryRef.current;
		return { sessionId, provider, controller: createChatController(provider, sessionId) };
	}, [sessionId, provider]);
	const controller = entry?.controller ?? null;
	const getSnapshot = useCallback(() => (controller ? controller.getSnapshot() : EMPTY_SNAPSHOT), [controller]);
	const snapshot = useSyncExternalStore(
		useCallback(
			(listener: () => void) => (controller ? controller.subscribe(listener) : () => undefined),
			[controller],
		),
		getSnapshot,
		// SSR 与 hydration 都要读快照；getSnapshot 纯读，服务端复用同一实现。
		getSnapshot,
	);

	useEffect(() => {
		if (entryRef.current !== entry) entryRef.current?.controller.dispose();
		entryRef.current = entry;
		if (controller) void controller.connect().catch(() => undefined);
	}, [entry, controller]);

	const send = useCallback(
		async (text: string, options?: { sessionId?: string; attachments?: AttachmentRef[]; skills?: string[] }) => {
			assertActive();
			const sid = options?.sessionId ?? sessionId;
			if (!sid) throw new Error("kit-sdk/chat/hooks: useChat 需要 sessionId");
			// 支持 setSessionId(newId) 后在同一闭包内发送；随后的 render 复用此 Controller。
			if (entryRef.current?.sessionId !== sid || entryRef.current.provider !== provider) {
				entryRef.current?.controller.dispose();
				entryRef.current =
					entry?.sessionId === sid
						? entry
						: { sessionId: sid, provider, controller: createChatController(provider, sid) };
			}
			await entryRef.current.controller.send(text, {
				...(options?.attachments?.length ? { attachments: options.attachments } : {}),
				...(options?.skills?.length ? { skills: options.skills } : {}),
			});
		},
		[sessionId, provider, entry, assertActive],
	);
	const stop = useCallback(async () => {
		assertActive();
		await controller?.stop();
	}, [controller, assertActive]);
	const setMessageFiles = useCallback(
		(entries: MessageFileAssociation[] | null) => {
			controller?.store.setMessageFiles(entries ?? []);
		},
		[controller],
	);

	return useMemo(
		() => ({
			messages: snapshot.messages,
			threads: snapshot.threads,
			multiAgent: snapshot.multiAgent,
			artifacts: snapshot.artifacts,
			turnRunning: snapshot.turnRunning,
			streamError: snapshot.streamError,
			connected: snapshot.connection === "connected",
			phase: snapshot.phase,
			connection: snapshot.connection,
			canSend: snapshot.canSend,
			approvals: snapshot.approvals,
			refreshApprovals: async () => {
				assertActive();
				await controller?.refreshApprovals();
			},
			submitApproval: async (decision: ToolApprovalDecision) => {
				assertActive();
				if (!controller) throw new Error("未选择会话");
				await controller.submitApproval(decision);
			},
			send,
			setMessageFiles,
			stop,
		}),
		[snapshot, controller, send, setMessageFiles, stop, assertActive],
	);
}

const EMPTY_SNAPSHOT = {
	sessionId: null,
	providerStatus: null,
	phase: "idle",
	connection: "disconnected",
	canSend: false,
	approvals: [],
	lastCursor: null,
	turnRunning: false,
	messages: [],
	threads: {},
	multiAgent: {
		selectedThreadId: null,
		threads: [],
		loading: false,
		error: null,
		selectThread: () => undefined,
		refreshThreads: async () => undefined,
		loadThreadEvents: async () => undefined,
	},
	artifacts: [],
	lastEventId: null,
	streamError: null,
} as ReturnType<ChatController["getSnapshot"]>;
