import { randomUUID } from "node:crypto";
import {
	type AttachmentRef,
	KitError,
	mergeEventSnapshots,
	type RemoteFile,
	type SessionEvent,
	type SessionThreadSummary,
	threadIdOf,
} from "@openagentpack/kit-sdk/protocol";
import type {
	ModelUsageItem,
	ModelUsagePage,
	ModelUsageRequest,
	ToolUsageItem,
	ToolUsagePage,
	ToolUsageRequest,
} from "@openagentpack/sdk";
import { isRemoteCoordinator, projectMultiagentConfiguration } from "./agent-multiagent.ts";
import { memoryStoreConfiguration } from "./memory-store-configuration.ts";
import { type MockInspectableSession, mockPresetPackResources } from "./mock-preset-pack-resources.ts";
import type { MockDraftPublisher, DraftPublishedResource as MockPublishedResource } from "./mock-yaml-draft.ts";

type MockPublishedAgentRoster = Parameters<MockDraftPublisher>[1][number];

import { createMockRemoteSkillGateway } from "./mock-remote-skills.ts";
import type { GatewaySendInput, GatewaySessionInfo, ProviderGateway } from "./types.ts";
import { createYamlDraftGateway } from "./yaml-draft-gateway.ts";

interface MockSession extends MockInspectableSession {
	id: string;
	status: string;
	events: SessionEvent[];
	waiters: Set<() => void>;
	/** 运行时挂载的附件（镜像 provider 沙箱可见的挂载面；创建载荷不携带文件）。 */
	files: AttachmentRef[];
	/** 运行时挂载的资源 id → 挂载参数；卸载（回滚）时按 mount_path 从 files 中移除。 */
	resources: Map<string, { fileId: string; mountPath: string }>;
	approval?: { batchId: string; pending: string[]; text: string; threadId?: string };
	generation: number;
	turns: number;
	threads: SessionThreadSummary[];
	stopReason?: string;
	/** 创建时绑定的远端智能体；用量遥测按它归组。 */
	agent_id: string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const initialRemoteAgents = [
	{ agent_id: "agent_mock_assistant", name: "assistant", version: 1 },
	{ agent_id: "agent_mock_designer", name: "designer", version: 3 },
];

/** 回放 [start, end) 区间事件，返回新的游标。 */
function* drainFrom(session: MockSession, start: number): Generator<SessionEvent, number> {
	let index = start;
	while (index < session.events.length) {
		const event = session.events[index];
		index += 1;
		if (event) yield event;
	}
	return index;
}

function waitForChange(session: MockSession, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const waiter = () => {
			session.waiters.delete(waiter);
			signal?.removeEventListener("abort", waiter);
			resolve();
		};
		session.waiters.add(waiter);
		signal?.addEventListener("abort", waiter, { once: true });
	});
}

function latestEvents(events: SessionEvent[]) {
	const snapshots: SessionEvent[] = [];
	const positions = new Map<string, number>();
	for (const event of events) {
		const position = event.event_id ? positions.get(event.event_id) : undefined;
		if (position !== undefined) snapshots[position] = mergeEventSnapshots(snapshots[position], event);
		else {
			if (event.event_id) positions.set(event.event_id, snapshots.length);
			snapshots.push(event);
		}
	}
	return snapshots;
}

/** mock 演示工作空间标识，与 admin 路由 telemetryWorkspaceId 的无凭据占位一致。 */
const MOCK_WORKSPACE_ID = "ws-mock";

/** mock 遥测使用的演示模型名。 */
const MOCK_MODEL_NAME = "qwen3.8-max";

/** 账本聚合成的一次演示用量快照；token 数值与来源一致。 */
export interface MockTelemetryUsage {
	sessions: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_creation_tokens: number;
}

/**
 * 账本遥测源：由 services 组装时注入（mock 网关自身不读本地库，保持 Provider 抽象分层）。
 * mock 明细据此伪造 Provider 侧调用——有会话才有行、Token 与汇总卡片同源、重启不丢。
 */
export interface MockTelemetrySource {
	byAgent(): Promise<Map<string, MockTelemetryUsage>>;
	bySession(sessionId: string): Promise<MockTelemetryUsage | null>;
}

/** 归一化的演示用量聚合；turns 为等效轮数（内存来源是真实轮数，账本来源按演示公式折算）。 */
interface UsageAggregate {
	sessions: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_creation_tokens: number;
	turns?: number;
}

function mergeUsage(a: UsageAggregate, b: UsageAggregate): UsageAggregate {
	return {
		sessions: a.sessions + b.sessions,
		input_tokens: a.input_tokens + b.input_tokens,
		output_tokens: a.output_tokens + b.output_tokens,
		cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
		cache_creation_tokens: a.cache_creation_tokens + b.cache_creation_tokens,
		turns: (a.turns ?? 0) + (b.turns ?? 0),
	};
}

/** 演示轮数：优先用真实轮数；账本无轮数，按 mock 演示公式（每轮 120 input）折算，有会话未采集时至少按会话数计。 */
function turnsOf(agg: UsageAggregate): number {
	return agg.turns ?? Math.max(agg.sessions, Math.round(agg.input_tokens / 120));
}

/** 账本来源：按 scope 归组取注入的聚合结果；workspace 全量时把各智能体求和为一行。 */
async function ledgerUsage(request: ModelUsageRequest | ToolUsageRequest, telemetry: MockTelemetrySource) {
	if (request.scope.type === "session") return telemetry.bySession(request.scope.session_id);
	const all = await telemetry.byAgent();
	const agentId =
		request.scope.type === "agent"
			? request.scope.agent_id
			: request.scope.type === "workspace"
				? request.scope.agent_id
				: undefined;
	if (agentId) return all.get(agentId) ?? null;
	let total: UsageAggregate | null = null;
	for (const entry of all.values()) total = total ? mergeUsage(total, entry) : entry;
	return total;
}

/** 内存来源：telemetry 未注入时（直接构造网关的测试场景）从 mock 会话推导。 */
function memoryUsage(request: ModelUsageRequest | ToolUsageRequest, sessions: Map<string, MockSession>) {
	let total: UsageAggregate | null = null;
	for (const session of telemetrySessions(request, sessions)) {
		const entry: UsageAggregate = {
			sessions: 1,
			turns: session.turns,
			input_tokens: session.turns * 120,
			output_tokens: session.turns * 80,
			cache_read_tokens: session.turns * 40,
			cache_creation_tokens: 0,
		};
		total = total ? mergeUsage(total, entry) : entry;
	}
	return total;
}

async function collectUsage(
	request: ModelUsageRequest | ToolUsageRequest,
	sessions: Map<string, MockSession>,
	telemetry?: MockTelemetrySource,
): Promise<UsageAggregate | null> {
	return telemetry ? ledgerUsage(request, telemetry) : memoryUsage(request, sessions);
}

/** workspace/agent scope 的内存会话筛选；session scope 精确到单个会话。 */
function telemetrySessions(
	request: ModelUsageRequest | ToolUsageRequest,
	sessions: Map<string, MockSession>,
): MockSession[] {
	const scope = request.scope;
	if (scope.type === "session") {
		const target = sessions.get(scope.session_id);
		return target ? [target] : [];
	}
	const agentId = scope.type === "agent" ? scope.agent_id : scope.type === "workspace" ? scope.agent_id : undefined;
	return [...sessions.values()].filter((session) => !agentId || session.agent_id === agentId);
}

async function mockModelUsage(
	request: ModelUsageRequest,
	sessions: Map<string, MockSession>,
	telemetry?: MockTelemetrySource,
): Promise<ModelUsagePage> {
	const agg = await collectUsage(request, sessions, telemetry);
	const turns = agg ? turnsOf(agg) : 0;
	const rows: ModelUsageItem[] =
		agg && turns
			? [
					{
						workspace_id: MOCK_WORKSPACE_ID,
						model_name: MOCK_MODEL_NAME,
						call_count: turns,
						failed_count: 0,
						tokens: {
							input_tokens: agg.input_tokens,
							output_tokens: agg.output_tokens,
							cache_read_tokens: agg.cache_read_tokens,
							cache_creation_tokens: agg.cache_creation_tokens,
							total_tokens: agg.input_tokens + agg.output_tokens,
							cache_hit_ratio: agg.input_tokens ? agg.cache_read_tokens / agg.input_tokens : 0,
						},
					},
				]
			: [];
	const filtered = rows.filter((row) => !request.model_name || row.model_name === request.model_name);
	return {
		...pagedUsage(request, filtered),
		total_call_count: filtered.reduce((sum, row) => sum + row.call_count, 0),
		data_updated_at: Date.now(),
	};
}

async function mockToolUsage(
	request: ToolUsageRequest,
	sessions: Map<string, MockSession>,
	telemetry?: MockTelemetrySource,
): Promise<ToolUsagePage> {
	const agg = await collectUsage(request, sessions, telemetry);
	const turns = agg ? turnsOf(agg) : 0;
	const rows: ToolUsageItem[] = [];
	if (turns) {
		rows.push({
			workspace_id: MOCK_WORKSPACE_ID,
			tool_name: "web_search",
			source: "builtin",
			call_count: turns,
			failed_count: 0,
		});
		const memorySearches = Math.floor(turns / 3);
		if (memorySearches)
			rows.push({
				workspace_id: MOCK_WORKSPACE_ID,
				tool_name: "memory_search",
				source: "mcp",
				call_count: memorySearches,
				failed_count: 0,
			});
	}
	const filtered = rows.filter(
		(row) =>
			(!request.source || row.source === request.source) && (!request.tool_name || row.tool_name === request.tool_name),
	);
	return {
		...pagedUsage(request, filtered),
		total_call_count: filtered.reduce((sum, row) => sum + row.call_count, 0),
		data_updated_at: Date.now(),
	};
}

function pagedUsage<T>(
	request: { page_no?: number; page_size?: number },
	rows: T[],
): {
	items: T[];
	total: number;
	page_no: number;
	page_size: number;
} {
	const pageNo = request.page_no ?? 1;
	const pageSize = request.page_size ?? 20;
	const start = (pageNo - 1) * pageSize;
	return {
		items: rows.slice(start, start + pageSize),
		total: rows.length,
		page_no: pageNo,
		page_size: pageSize,
	};
}

/**
 * 无凭据时的端到端演示与测试 gateway：产出真实形状的事件流
 * （user 回显 → reasoning → message 分片 → tool_call/output → artifact → idle）。
 */
export function createMockGateway(
	options: { fileScanDelayMs?: number; telemetry?: MockTelemetrySource } = {},
): ProviderGateway {
	const remoteAgents = initialRemoteAgents.map((agent) => ({ ...agent }));
	const publishedResources: MockPublishedResource[] = [];
	const publishedRosters = new Map<string, unknown>();
	const recordPublished = (resources: MockPublishedResource[], rosters: MockPublishedAgentRoster[] = []) => {
		for (const roster of rosters) publishedRosters.set(`${roster.agent_id}:${roster.version}`, roster.multiagent);
		for (const resource of resources) {
			const index = publishedResources.findIndex(
				(item) => item.type === resource.type && item.remote_id === resource.remote_id,
			);
			if (index < 0) publishedResources.push(resource);
			else publishedResources[index] = resource;
		}
		for (const resource of resources.filter((entry) => entry.type === "agent")) {
			const existing = remoteAgents.findIndex((agent) => agent.agent_id === resource.remote_id);
			const agent = { agent_id: resource.remote_id, name: resource.name, version: resource.version! };
			if (existing >= 0) remoteAgents[existing] = agent;
			else remoteAgents.push(agent);
		}
	};
	const sessions = new Map<string, MockSession>();
	const uploads = new Map<string, { bytes: Uint8Array; filename: string; mimeType: string; availableAt: number }>();
	const remoteFile = (fileId: string): RemoteFile | null => {
		const upload = uploads.get(fileId);
		if (!upload) {
			const published = publishedResources.find(
				(resource) => resource.type === "file" && resource.remote_id === fileId,
			);
			return published ? { file_id: fileId, filename: published.name, available: true, status: "available" } : null;
		}
		const available = upload.availableAt <= Date.now();
		return {
			file_id: fileId,
			filename: upload.filename,
			size: upload.bytes.byteLength,
			available,
			status: available ? "available" : "checking",
		};
	};

	const push = (session: MockSession, event: SessionEvent) => {
		session.events.push(event);
		for (const waiter of session.waiters) waiter();
	};

	const pushApprovalStatus = (session: MockSession) => {
		const approval = session.approval;
		if (!approval) return;
		push(session, {
			event_id: `evt_${randomUUID().slice(0, 8)}`,
			type: "session_status",
			metadata: {
				status: "idle",
				stop_reason: {
					type: "requires_action",
					pending_batch_id: approval.batchId,
					pending_call_ids: [...approval.pending],
				},
			},
		});
	};

	const beginApproval = (session: MockSession, text: string) => {
		const batchId = `batch_mock_${randomUUID().slice(0, 8)}`;
		const threadId = /thread/.test(text) ? "sthr_mock_approval" : undefined;
		session.approval = {
			batchId,
			pending: ["call_read", "call_write"],
			text: text,
			...(threadId ? { threadId } : {}),
		};
		for (const [callId, name] of [
			["call_read", "read_file"],
			["call_write", "write_file"],
		]) {
			push(session, {
				event_id: `evt_${randomUUID().slice(0, 8)}`,
				type: "tool_approval_request",
				role: "assistant",
				...(threadId ? { metadata: { session_thread_id: threadId } } : {}),
				content: [
					{
						type: "data",
						data: {
							batch_id: batchId,
							call_id: callId,
							name,
							arguments: { path: "/tmp/report.txt", text: "<unsafe>" },
							tool_type: "builtin",
						},
					},
				],
			});
		}
		session.status = "idle";
		session.stopReason = "requires_action";
		pushApprovalStatus(session);
	};

	const pushUnknown = (session: MockSession, text: string) => {
		if (/snapshot/.test(text))
			push(session, {
				event_id: `evt_${randomUUID().slice(0, 8)}`,
				type: "message",
				role: "assistant",
				content: [{ type: "unknown_widget", data: { html: "<script>unsafe()</script>" } }],
			});
	};

	const generateTools = async (
		session: MockSession,
		text: string,
		messageId: string,
		generation: number,
		emitArtifact: boolean,
	) => {
		const id = () => `evt_${randomUUID().slice(0, 8)}`;
		await delay(20);
		if (generation !== session.generation) return;
		push(session, {
			event_id: id(),
			type: "tool_call",
			role: "assistant",
			created_at: new Date().toISOString(),
			metadata: { tool_name: "echo", call_id: `${messageId}_echo`, tool_input: { text } },
		});
		await delay(30);
		if (generation !== session.generation) return;
		push(session, {
			event_id: id(),
			type: "tool_call_output",
			role: "assistant",
			created_at: new Date().toISOString(),
			metadata: { tool_name: "echo", call_id: `${messageId}_echo` },
			content: [{ type: "text", text: `echo:${text.slice(0, 20)}` }],
		});
		if (emitArtifact) {
			await delay(20);
			if (generation !== session.generation) return;
			push(session, {
				event_id: id(),
				type: "message",
				role: "assistant",
				created_at: new Date().toISOString(),
				content: [{ type: "text", text: "已生成交付文件。" }],
				metadata: {
					artifact: {
						file_id: `file_${randomUUID().slice(0, 8)}`,
						filename: "mock-report.md",
						content_type: "text/markdown",
						size: 42,
					},
				},
			});
		}
	};

	const generateThreads = async (session: MockSession, generation: number) => {
		const id = () => `evt_${randomUUID().slice(0, 8)}`;
		const createThread = (index: number) => {
			const threadId = `sthr_${randomUUID().replaceAll("-", "")}`;
			const createdAt = new Date().toISOString();
			session.threads.push({
				id: threadId,
				session_id: session.id,
				parent_thread_id: `thrd_${session.id}`,
				agent: { id: "agent_mock_research", version: 1, name: "研究员" },
				status: "running",
				created_at: createdAt,
				updated_at: createdAt,
			});
			push(session, {
				event_id: id(),
				type: "thread_created",
				created_at: createdAt,
				metadata: { thread_id: threadId, session_thread_id: threadId },
				content: [{ type: "data", data: { session_thread_id: threadId, agent_name: "研究员", status: "running" } }],
			});
			// 派发任务书：merge 不渲染，multiAgent 提取为卡头任务摘要。
			push(session, {
				event_id: id(),
				type: "thread_message_sent",
				role: "user",
				created_at: createdAt,
				metadata: { thread_id: threadId, session_thread_id: threadId, to_agent_name: "研究员" },
				content: [{ type: "text", text: `调研多 Agent 协作的主题要点 ${index + 1}，并交叉验证来源。` }],
			});
			return threadId;
		};

		const childRounds = {
			reasoning: { type: "reasoning", body: (index: number) => `拆解研究任务 ${index + 1}：收集资料并交叉验证来源。` },
			tool_call: { type: "tool_call", body: null, toolInput: true },
			tool_output: {
				type: "tool_call_output",
				body: (index: number) => `检索到 ${3 + index} 条相关资料，已按主题去重。`,
			},
			reply: {
				type: "message",
				body: (index: number) => `研究任务 ${index + 1} 完成，要点已汇总给主 Agent。`,
				done: true,
			},
		} as const;
		const childEvent = (threadId: string, index: number, round: keyof typeof childRounds): SessionEvent => {
			const spec = childRounds[round];
			const metadata: Record<string, unknown> = { thread_id: threadId, session_thread_id: threadId };
			if (spec.type === "tool_call" || spec.type === "tool_call_output") {
				Object.assign(metadata, { tool_name: "web_search", call_id: `${threadId}_search` });
			}
			if (spec.type === "tool_call") metadata.tool_input = { query: `研究任务 ${index + 1} 关键要点` };
			if ("done" in spec && spec.done) metadata.event_status = "completed";
			return {
				event_id: id(),
				type: spec.type,
				role: "assistant",
				created_at: new Date().toISOString(),
				metadata,
				content: spec.body ? [{ type: "text", text: spec.body(index) }] : [],
			};
		};

		const finishThread = (threadId: string) => {
			const thread = session.threads.find((item) => item.id === threadId);
			if (thread) {
				thread.status = "idle";
				thread.updated_at = new Date().toISOString();
			}
			push(session, {
				event_id: id(),
				type: "thread_status",
				created_at: new Date().toISOString(),
				metadata: { thread_id: threadId, session_thread_id: threadId },
				content: [{ type: "data", data: { session_thread_id: threadId, status: "idle" } }],
			});
		};

		const firstId = createThread(0);
		const secondId = createThread(1);
		// 两个子线程交错产出事件，thread 0 先收尾，让卡片呈现错落的终态时序。
		for (const round of ["reasoning", "tool_call", "tool_output"] as const) {
			for (const [index, threadId] of [firstId, secondId].entries()) {
				await delay(350);
				if (generation !== session.generation) return;
				push(session, childEvent(threadId, index, round));
			}
		}
		await delay(350);
		if (generation !== session.generation) return;
		push(session, childEvent(firstId, 0, "reply"));
		finishThread(firstId);
		await delay(350);
		if (generation !== session.generation) return;
		push(session, childEvent(secondId, 1, "reply"));
		finishThread(secondId);
		await delay(200);
		if (generation !== session.generation) return;
		push(session, {
			event_id: id(),
			type: "message",
			role: "assistant",
			created_at: new Date().toISOString(),
			metadata: { event_status: "completed" },
			content: [{ type: "text", text: "两位研究员已完成检索：要点已交叉验证并汇总如下，可直接用于后续整理。" }],
		});
	};

	const runTail = async (
		session: MockSession,
		text: string,
		messageId: string,
		generation: number,
		emitArtifact: boolean,
		multiAgent: boolean,
	) => {
		if (multiAgent) return generateThreads(session, generation);
		await generateTools(session, text, messageId, generation, emitArtifact);
		if (generation !== session.generation) return;
		pushUnknown(session, text);
	};

	/** 流式推送本轮 mock 助手回复；generation 失效即中断，返回 null。 */
	const streamReply = async (session: MockSession, text: string, generation: number) => {
		const chunks = [`收到：「${text}」。`, "\n这是 mock gateway 的流式回答，", "用于无凭据开发与测试。"];
		const messageId = `evt_${randomUUID().slice(0, 8)}`;
		let cumulative = "";
		for (const chunk of chunks) {
			await delay(40);
			if (generation !== session.generation) return null;
			cumulative += chunk;
			push(session, {
				event_id: messageId,
				type: "message",
				role: "assistant",
				created_at: new Date().toISOString(),
				content: [{ type: "text", text: cumulative }],
				metadata: { event_status: chunk === chunks.at(-1) ? "completed" : "in_progress" },
			});
		}
		return messageId;
	};

	/** 收敛回合终态；中断后 generation 已失效，不再标 idle/completed，也不写终态事件。 */
	const finishTurn = (session: MockSession, failed: boolean, generation: number) => {
		if (generation !== session.generation) return;
		session.status = failed ? "failed" : "idle";
		session.stopReason = failed ? undefined : "completed";
		push(session, {
			event_id: `evt_${randomUUID().slice(0, 8)}`,
			type: "session_status",
			created_at: new Date().toISOString(),
			metadata: { status: failed ? "failed" : "idle" },
		});
	};

	const generate = async (session: MockSession, text: string, emitArtifact: boolean) => {
		const generation = session.generation;
		const multiAgent = /multi.?agent|多\s*Agent|多智能体/i.test(text);
		await delay(30);
		if (generation !== session.generation) return;
		push(session, {
			event_id: `evt_${randomUUID().slice(0, 8)}`,
			type: "reasoning",
			role: "assistant",
			created_at: new Date().toISOString(),
			content: [{ type: "text", text: `分析请求：${text.slice(0, 40)}` }],
		});
		const messageId = await streamReply(session, text, generation);
		if (!messageId) return;
		// 触发词「失败/报错」让回合以 failed 收敛：给侧栏失败状态一个可演示路径。
		const failed = /失败|报错/.test(text);
		await runTail(session, text, messageId, generation, emitArtifact, multiAgent);
		finishTurn(session, failed, generation);
	};

	return {
		mode: "mock",
		resourceDraftDocument(id, assetRoot, storage) {
			return createYamlDraftGateway({ id, assetRoot, storage, publishMock: recordPublished });
		},
		async getPresetPackAgentResources(agentId, signal) {
			signal?.throwIfAborted();
			if (!remoteAgents.some((agent) => agent.agent_id === agentId)) throw new KitError("not_found", "智能体不存在");
			return mockPresetPackResources(agentId, sessions.values());
		},
		async createSession(input) {
			const { agentId, agentVersion, title } = input;
			if (agentVersion !== undefined) {
				const agent = remoteAgents.find((item) => item.agent_id === agentId);
				if (!agent || !Number.isSafeInteger(agentVersion) || agentVersion < 1 || agentVersion > agent.version)
					throw new KitError("not_found", "智能体版本不存在");
			}
			const id = `sess_mock_${randomUUID().slice(0, 8)}`;
			sessions.set(id, {
				id,
				status: "idle",
				events: [],
				waiters: new Set(),
				files: [],
				resources: new Map(),
				generation: 0,
				turns: 0,
				threads: [],
				agent_id: agentId,
				bindings: structuredClone(input),
			});
			return {
				session_id: id,
				status: "idle",
				...(title ? { title } : {}),
				...{ agent_id: agentId },
			} as GatewaySessionInfo;
		},
		async getSession(sessionId) {
			const s = sessions.get(sessionId);
			return s
				? {
						session_id: s.id,
						status: s.status,
						...(s.stopReason ? { stop_reason: { type: s.stopReason } } : {}),
						// 固定每轮演示数值，累计快照的重复读取不会增长，也不代表真实模型消耗。
						usage: {
							input_tokens: s.turns * 120,
							output_tokens: s.turns * 80,
							cache_read_input_tokens: s.turns * 40,
							cache_creation_input_tokens: 0,
						},
						stats: { active_seconds: s.turns * 2, duration_seconds: s.turns * 3 },
						...(s.files.length ? { files: s.files } : {}),
					}
				: null;
		},
		async sendMessage(sessionId, input: GatewaySendInput) {
			const session = sessions.get(sessionId);
			if (!session) throw new Error(`mock: session ${sessionId} not found`);
			const userEvent: SessionEvent = {
				event_id: `evt_${randomUUID().slice(0, 8)}`,
				type: "message",
				role: "user",
				created_at: new Date().toISOString(),
				content: [{ type: "text", text: input.text }],
				...(input.clientMessageId ? { metadata: { client_message_id: input.clientMessageId } } : {}),
			};
			push(session, userEvent);
			session.status = "running";
			session.stopReason = undefined;
			session.generation += 1;
			session.turns += 1;
			push(session, {
				event_id: `evt_${randomUUID().slice(0, 8)}`,
				type: "session_status",
				metadata: { status: "running" },
			});
			if (/approval|审批/.test(input.text)) beginApproval(session, input.text);
			else void generate(session, input.text, /artifact|文件|报告/.test(input.text));
			return { event_ids: [userEvent.event_id as string] };
		},
		async respondToolApproval(sessionId, input) {
			const session = sessions.get(sessionId);
			const approval = session?.approval;
			if (!session || !approval || approval.batchId !== input.batch_id || !approval.pending.includes(input.call_id))
				throw new KitError("conflict", "审批已过期");
			const eventId = `evt_${randomUUID().slice(0, 8)}`;
			const { session_thread_id, ...decision } = input;
			push(session, {
				event_id: eventId,
				type: "tool_approval_response",
				role: "user",
				...(session_thread_id ? { metadata: { session_thread_id } } : {}),
				content: [{ type: "data", data: decision }],
			});
			approval.pending = approval.pending.filter((id) => id !== input.call_id);
			if (approval.pending.length) pushApprovalStatus(session);
			else {
				session.approval = undefined;
				session.status = "running";
				session.stopReason = undefined;
				push(session, {
					event_id: `evt_${randomUUID().slice(0, 8)}`,
					type: "session_status",
					metadata: { status: "running" },
				});
				void generate(session, `审批已处理：${approval.text}`, /artifact|文件|报告/.test(approval.text));
			}
			return { event_ids: [eventId] };
		},
		async archiveSession(sessionId) {
			const session = sessions.get(sessionId);
			if (session) session.status = "archived";
		},
		async deleteSession(sessionId) {
			sessions.delete(sessionId);
		},
		async mountSessionResource(sessionId, { fileId, mountPath }) {
			const session = sessions.get(sessionId);
			if (!session) throw new Error(`mock: session ${sessionId} not found`);
			const resourceId = `sesrsc_mock_${randomUUID().slice(0, 8)}`;
			session.resources.set(resourceId, { fileId, mountPath });
			session.files = [
				...session.files,
				{ file_id: fileId, filename: uploads.get(fileId)?.filename, mount_path: mountPath },
			];
			return { resourceId, mountPath };
		},
		async unmountSessionResource(sessionId, resourceId) {
			const session = sessions.get(sessionId);
			const mounted = session?.resources.get(resourceId);
			if (!session || !mounted) return;
			session.resources.delete(resourceId);
			session.files = session.files.filter((f) => f.mount_path !== mounted.mountPath);
		},
		async uploadFile({ filename, bytes, mimeType }) {
			const fileId = `file_${randomUUID().slice(0, 8)}`;
			uploads.set(fileId, {
				bytes,
				filename,
				mimeType: mimeType ?? "application/octet-stream",
				availableAt: Date.now() + (options.fileScanDelayMs ?? 0),
			});
			return { file_id: fileId, filename, size: bytes.byteLength };
		},
		async fileStatus(fileId) {
			const upload = uploads.get(fileId);
			// 查不到就当作可用：与 SdkGateway 一致，不因「状态未知」阻塞建会话（provider 会给更准确的错）
			if (!upload) return { available: true, status: "unknown" };
			return upload.availableAt <= Date.now()
				? { available: true, status: "available" }
				: { available: false, status: "checking" };
		},
		async interrupt(sessionId) {
			const session = sessions.get(sessionId);
			if (!session) return;
			session.status = "idle";
			session.stopReason = "interrupted";
			session.generation += 1;
			session.approval = undefined;
			push(session, {
				event_id: `evt_${randomUUID().slice(0, 8)}`,
				type: "interrupt",
				created_at: new Date().toISOString(),
				metadata: { status: "interrupted" },
			});
			push(session, {
				event_id: `evt_${randomUUID().slice(0, 8)}`,
				type: "session_status",
				created_at: new Date().toISOString(),
				metadata: { status: "idle" },
			});
		},
		async listEvents(sessionId, options = {}) {
			const session = sessions.get(sessionId);
			if (!session) return { events: [], next_page_token: null };
			const snapshots = latestEvents(session.events);
			const start = options.pageToken
				? Number(options.pageToken.slice(5))
				: options.afterId
					? snapshots.findIndex((e) => e.event_id === options.afterId) + 1
					: 0;
			const end = Math.max(0, start) + (options.limit ?? 100);
			return {
				events: snapshots.slice(Math.max(0, start), end),
				next_page_token: end < snapshots.length ? `page:${end}` : null,
			};
		},
		async listThreads(sessionId, options = {}) {
			options.signal?.throwIfAborted();
			const session = sessions.get(sessionId);
			if (!session) throw new KitError("not_found", "会话不存在");
			const start = options.pageToken ? Number(options.pageToken.slice(5)) : 0;
			const end = start + (options.limit ?? 50);
			return {
				data: session.threads.slice(start, end),
				next_page_token: end < session.threads.length ? `page:${end}` : null,
			};
		},
		async listThreadEvents(sessionId, threadId, options = {}) {
			options.signal?.throwIfAborted();
			const session = sessions.get(sessionId);
			if (!session?.threads.some((thread) => thread.id === threadId)) throw new KitError("not_found", "线程不存在");
			const events = latestEvents(session.events)
				.filter((event) => threadIdOf(event) === threadId)
				.reverse();
			const start = options.pageToken ? Number(options.pageToken.slice(5)) : 0;
			const end = start + (options.limit ?? 50);
			return { events: events.slice(start, end), next_page_token: end < events.length ? `page:${end}` : null };
		},
		async *streamEvents(sessionId, options = {}) {
			const session = sessions.get(sessionId);
			if (!session) return;
			options.onReady?.();
			let index = Math.max(
				0,
				options.afterId ? session.events.findIndex((e) => e.event_id === options.afterId) + 1 : 0,
			);
			for (;;) {
				if (options.signal?.aborted) return;
				index = yield* drainFrom(session, index);
				await waitForChange(session, options.signal);
			}
		},
		async downloadFile(fileId) {
			const uploaded = uploads.get(fileId);
			if (uploaded) return { body: uploaded.bytes, contentType: uploaded.mimeType, filename: uploaded.filename };
			return {
				body: new TextEncoder().encode(`# mock artifact ${fileId}\n\n这是 mock gateway 的交付文件内容。\n`),
				contentType: "text/markdown; charset=utf-8",
				filename: "mock-report.md",
			};
		},
		async listRemoteAgents() {
			return remoteAgents.map((agent) => ({
				...agent,
				...(isRemoteCoordinator({ multiagent: publishedRosters.get(`${agent.agent_id}:${agent.version}`) })
					? { is_coordinator: true }
					: {}),
			}));
		},
		async listRemoteAgentVersions(agentId) {
			const agent = remoteAgents.find((item) => item.agent_id === agentId);
			if (!agent) throw new KitError("not_found", "智能体不存在");
			return Array.from({ length: agent.version }, (_, index) => ({ version: agent.version - index }));
		},
		async getRemoteAgentVersion(agentId, version) {
			const agent = remoteAgents.find((item) => item.agent_id === agentId);
			if (!agent || !Number.isSafeInteger(version) || version < 1 || version > agent.version) return null;
			return { ...agent, version };
		},
		async getRemoteAgentVersionDetail(agentId, version) {
			const agent = remoteAgents.find((item) => item.agent_id === agentId);
			if (!agent || !Number.isSafeInteger(version) || version < 1 || version > agent.version) return null;
			return {
				agent_id: agentId,
				name: agent.name,
				version,
				created_at: `2026-10-0${version}T00:00:00Z`,
				description: `${agent.name} 的版本配置`,
				configuration: {
					model: `qwen-mock-v${version}`,
					instructions: `这是 ${agent.name} 的 v${version} 版本指令。`,
					tools: { builtin: ["read-file"], permissions: { ReadFile: "allow" } },
					skills: [],
					mcp_servers: [],
					...(publishedRosters.has(`${agentId}:${version}`)
						? { multiagent: projectMultiagentConfiguration(publishedRosters.get(`${agentId}:${version}`)) }
						: {}),
				},
			};
		},
		async getRemoteAgentResources(agentId) {
			if (agentId === "agent_mock_assistant")
				return {
					tools: [
						{ name: "web_search", description: "联网检索公开资料并引用来源", permission: "allow" },
						{ name: "code_interpreter", description: "在沙箱中运行代码处理数据与文件", permission: "ask" },
					],
					skills: [
						{ name: "research", description: "深度调研并产出结构化报告" },
						{ name: "slide-maker", description: "根据大纲生成演示文稿" },
					],
					mcp_servers: [{ name: "github", description: "查询仓库、Issue 与 Pull Request" }],
				};
			if (agentId === "agent_mock_designer")
				return {
					tools: [{ name: "image_gen", description: "根据描述生成示意图" }],
					skills: [],
					mcp_servers: [],
				};
			return null;
		},
		async listRemoteEnvironments() {
			const environments = [
				{ environment_id: "env_mock_default", name: "默认环境" },
				{ environment_id: "env_mock_analysis", name: "数据分析环境" },
			];
			for (const resource of publishedResources.filter((entry) => entry.type === "environment")) {
				if (!environments.some((entry) => entry.environment_id === resource.remote_id))
					environments.push({ environment_id: resource.remote_id, name: resource.name });
			}
			return environments;
		},
		async getRemoteEnvironment(environmentId) {
			const environment = (await this.listRemoteEnvironments()).find((item) => item.environment_id === environmentId);
			if (!environment) return null;
			return {
				...environment,
				description: environmentId === "env_mock_analysis" ? "预装数据处理工具的分析环境" : "通用任务运行环境",
				metadata: { purpose: environmentId === "env_mock_analysis" ? "analysis" : "general", owner: "mock-team" },
				package_status: "ready" as const,
				scope: "organization",
				version: 1,
				type: "environment",
				created_at: "2026-10-27T00:00:00Z",
				updated_at: "2026-10-27T00:00:00Z",
				configuration: {
					type: "cloud",
					networking: { type: "unrestricted" },
					packages: {
						apt: ["git"],
						pip: environmentId === "env_mock_analysis" ? ["pandas", "numpy"] : [],
						npm: [],
						go: [],
						cargo: [],
						gem: [],
					},
					environment_variables: { WORKSPACE: "[redacted]" as const },
				},
			};
		},
		async listRemoteFiles() {
			const ids = new Set([
				...uploads.keys(),
				...publishedResources.filter((entry) => entry.type === "file").map((entry) => entry.remote_id),
			]);
			return [...ids].map(remoteFile).filter((file): file is RemoteFile => file !== null);
		},
		async getRemoteFile(fileId) {
			return remoteFile(fileId);
		},
		async listRemoteMemoryStores() {
			const stores = [
				{ memory_store_id: "memory-guide", name: "项目知识库" },
				{ memory_store_id: "memory-notes", name: "会话笔记" },
			];
			for (const resource of publishedResources.filter((entry) => entry.type === "memory_store")) {
				if (!stores.some((entry) => entry.memory_store_id === resource.remote_id))
					stores.push({ memory_store_id: resource.remote_id, name: resource.name });
			}
			return stores;
		},
		async getRemoteMemoryStoreConfiguration(id) {
			const store = await this.getRemoteMemoryStore(id);
			if (!store) return null;
			const published = publishedResources.find(
				(item) => item.type === "memory_store" && item.remote_id === id,
			)?.memory;
			return memoryStoreConfiguration(
				id,
				store.name,
				published?.description ?? "",
				published?.entries ??
					(id === "memory-guide" ? [{ key: "project/guide.md", content: "项目文档统一使用中文。" }] : []),
			);
		},
		async getRemoteMemoryStore(memoryStoreId) {
			return (await this.listRemoteMemoryStores()).find((store) => store.memory_store_id === memoryStoreId) ?? null;
		},
		async getAgentMemoryStores(config) {
			const descriptions = new Map([
				["memory-guide", "沉淀项目约定与文档要点，需要时先查这里。"],
				["memory-notes", "保存会话过程中的笔记与结论。"],
			]);
			const stores = await this.listRemoteMemoryStores();
			return config.map((item) => {
				const store = stores.find((entry) => entry.memory_store_id === item.memory_store_id);
				if (!store) throw new KitError("provider_error", "记忆库配置读取失败，请稍后重试", { retryable: true });
				const description = descriptions.get(item.memory_store_id);
				return { name: store.name, ...(description ? { description } : {}) };
			});
		},
		async listRemoteVaults() {
			const vaults = Array.from({ length: 11 }, (_, index) => ({
				vault_id: `vlt_mock_${index + 1}`,
				name: `测试密钥库 ${index + 1}`,
			}));
			for (const resource of publishedResources.filter((entry) => entry.type === "vault")) {
				if (!vaults.some((entry) => entry.vault_id === resource.remote_id))
					vaults.push({ vault_id: resource.remote_id, name: resource.name });
			}
			return vaults;
		},
		async getRemoteVault(vaultId) {
			return (await this.listRemoteVaults()).find((vault) => vault.vault_id === vaultId) ?? null;
		},
		async listModelUsage(request) {
			return mockModelUsage(request, sessions, options.telemetry);
		},
		async listToolUsage(request) {
			return mockToolUsage(request, sessions, options.telemetry);
		},
		async getRemoteVaultDetail(vaultId) {
			const vault = await this.getRemoteVault(vaultId);
			return vault
				? {
						...vault,
						credentials:
							vaultId === "vlt_mock_1"
								? [
										{
											credential_id: "cred_mock_service",
											name: "服务密钥",
											secret_name: "SERVICE_TOKEN",
											allowed_hosts: ["api.example.com", "*.example.org"],
										},
									]
								: [],
					}
				: null;
		},
		...createMockRemoteSkillGateway(),
	};
}
