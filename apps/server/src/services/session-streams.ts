import {
	isSessionRemovedStatus,
	KitError,
	type SessionEvent,
	type SseFrame,
	sessionStatusOf,
	threadIdOf,
} from "@openagentpack/kit-sdk/protocol";
import type { GatewaySessionInfo, ProviderGateway } from "../gateway/types.ts";
import type { EventBufferRegistry, EventChange } from "./event-buffer.ts";
import { type AcceptedTurn, projectSessionRuntime } from "./session-runtime.ts";
import { reconcileInitialSnapshots } from "./snapshot-reconciliation.ts";

/** 历史必须完整分页；游标是 Provider 返回的不透明字符串。 */
export async function readSessionHistory(gateway: ProviderGateway, sessionId: string, signal?: AbortSignal) {
	const events: SessionEvent[] = [];
	const cursors = new Set<string>();
	let pageToken: string | undefined;
	do {
		if (signal?.aborted) throw new DOMException("已取消", "AbortError");
		const page = await gateway.listEvents(sessionId, {
			limit: 100,
			...(pageToken ? { pageToken } : {}),
			...(signal ? { signal } : {}),
		});
		events.push(...page.events);
		pageToken = page.next_page_token ?? undefined;
		if (pageToken && cursors.has(pageToken)) throw new KitError("provider_error", "事件分页游标重复");
		if (pageToken) cursors.add(pageToken);
	} while (pageToken);
	return events;
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	void promise.catch(() => {});
	return { promise, resolve, reject };
}
interface Pump {
	controller: AbortController;
	ready: ReturnType<typeof deferred>;
	connected: ReturnType<typeof deferred>;
	references: number;
	error?: KitError;
	terminal: boolean;
	hydrated: boolean;
	pending: SessionEvent[];
	pendingBytes: number;
	lastStatus?: string;
	detachTimer?: ReturnType<typeof setTimeout>;
	project?: (sessionId: string, pump: Pump, force?: boolean) => void;
	hasPendingTurn?: () => boolean;
	forgetTurn?: () => void;
	onStatus?: (sessionId: string, status: string) => void;
}
function streamError(error: unknown): KitError {
	if (error instanceof KitError) return error;
	const detail = error as {
		retryable?: boolean;
		statusCode?: number;
		status?: number;
		code?: string;
		name?: string;
	} | null;
	const status = detail?.statusCode ?? detail?.status;
	let retryable = true;
	if (typeof detail?.retryable === "boolean") retryable = detail.retryable;
	else if (typeof status === "number") retryable = status === 429 || status >= 500;
	else if (
		detail?.code === "BAILIAN_EVENT_PROTOCOL_ERROR" ||
		detail?.code === "protocol" ||
		detail?.name === "UserError"
	)
		retryable = false;
	return new KitError("provider_error", retryable ? "上游事件连接中断，请重新连接" : "上游事件连接被拒绝或协议不兼容", {
		retryable,
	});
}
const MAX_QUEUE_FRAMES = 1024;
const MAX_QUEUE_BYTES = 8 * 1024 * 1024;
const eventSize = (event: SessionEvent) => new TextEncoder().encode(JSON.stringify(event)).byteLength;

function failPump(pump: Pump, buffers: EventBufferRegistry, sessionId: string, error: unknown) {
	pump.error = streamError(error);
	pump.connected.reject(pump.error);
	pump.ready.reject(pump.error);
	buffers.notify(sessionId);
}
function acceptEvent(
	pump: Pump,
	buffers: EventBufferRegistry,
	sessionId: string,
	event: SessionEvent,
): string | undefined {
	if (event.type === "session_status" && !threadIdOf(event) && isSessionRemovedStatus(sessionStatusOf(event)))
		pump.terminal = true;
	if (pump.hydrated) {
		buffers.append(sessionId, event);
		const isMainStatus = event.type === "session_status" && !threadIdOf(event);
		if (isMainStatus || pump.hasPendingTurn?.()) pump.project?.(sessionId, pump);
		return isMainStatus ? sessionStatusOf(event) : undefined;
	}
	pump.pendingBytes += eventSize(event);
	if (pump.pending.length >= MAX_QUEUE_FRAMES || pump.pendingBytes > MAX_QUEUE_BYTES)
		throw new KitError("provider_error", "历史回放期间实时事件缓冲超过上限", { retryable: true });
	pump.pending.push(event);
	return undefined;
}

function statusOfInfo(info: GatewaySessionInfo): string | undefined {
	if (info.status === "running" || info.status === "rescheduling") return "running";
	if (info.status === "idle") return info.stop_reason?.type === "requires_action" ? "requires_action" : "idle";
	return info.status === "failed" ? "failed" : undefined;
}

function shouldStopAfterEvent(pump: Pump) {
	if (!pump.hydrated) return false;
	if (pump.terminal) return true;
	return pump.references === 0 && pump.lastStatus !== undefined && pump.lastStatus !== "running";
}

function runDetachedCleanup(pump: Pump, onDetachedTerminal: () => void) {
	if (pump.references === 0) onDetachedTerminal();
}

async function consumeSource(
	gateway: ProviderGateway,
	buffers: EventBufferRegistry,
	sessionId: string,
	pump: Pump,
	onDetachedTerminal: () => void,
) {
	try {
		for await (const event of gateway.streamEvents(sessionId, {
			signal: pump.controller.signal,
			onReady: pump.connected.resolve,
		})) {
			if (pump.controller.signal.aborted) return;
			acceptEvent(pump, buffers, sessionId, event);
			if (shouldStopAfterEvent(pump)) {
				pump.controller.abort();
				runDetachedCleanup(pump, onDetachedTerminal);
				return;
			}
		}
		if (!pump.controller.signal.aborted)
			throw new KitError("provider_error", "上游事件流意外结束", { retryable: true });
	} catch (error) {
		if (!pump.controller.signal.aborted) {
			failPump(pump, buffers, sessionId, error);
			pump.controller.abort();
			runDetachedCleanup(pump, onDetachedTerminal);
		}
	}
}

function applyHydratedStatus(pump: Pump, buffers: EventBufferRegistry, sessionId: string) {
	// 历史含主状态时回写一次，修复无人订阅期间滞留在 SQLite 的旧 running；无历史则不制造 idle 回调。
	pump.project?.(sessionId, pump, buffers.get(sessionId)?.latestStatus !== undefined);
}

function failInitialization(
	error: unknown,
	pump: Pump,
	buffers: EventBufferRegistry,
	sessionId: string,
	onDetachedTerminal: () => void,
) {
	// Provider 明确返回会话不存在：索引里的 running 再也等不到终态，回正为 idle 免得侧栏常驻运行标记。
	if (error instanceof KitError && error.code === "not_found") {
		pump.forgetTurn?.();
		pump.onStatus?.(sessionId, "idle");
	}
	failPump(pump, buffers, sessionId, error);
	pump.controller.abort();
	runDetachedCleanup(pump, onDetachedTerminal);
}

async function initializePump(
	gateway: ProviderGateway,
	buffers: EventBufferRegistry,
	sessionId: string,
	pump: Pump,
	onDetachedTerminal: () => void,
) {
	try {
		const info = await gateway.getSession(sessionId);
		if (!info) throw new KitError("not_found", "会话不存在");
		pump.terminal = isSessionRemovedStatus(info.status);
		pump.lastStatus = statusOfInfo(info);
		if (!pump.terminal) {
			void consumeSource(gateway, buffers, sessionId, pump, onDetachedTerminal);
			await pump.connected.promise;
		}
		const history = await readSessionHistory(gateway, sessionId, pump.controller.signal);
		if (pump.controller.signal.aborted) return;
		if (pump.error) throw pump.error;
		const events = reconcileInitialSnapshots(history, pump.pending);
		buffers.reset(sessionId);
		buffers.seed(sessionId, events);
		pump.pending = [];
		pump.pendingBytes = 0;
		pump.hydrated = true;
		pump.ready.resolve();
		// 水合以 Provider 历史为准回正索引：上一轮无人订阅时的终态（含遗留 running）在这里收敛。
		applyHydratedStatus(pump, buffers, sessionId);
		if (pump.terminal) {
			pump.controller.abort();
			runDetachedCleanup(pump, onDetachedTerminal);
		}
	} catch (error) {
		if (pump.controller.signal.aborted) return;
		failInitialization(error, pump, buffers, sessionId, onDetachedTerminal);
	}
}
async function waitForReady(pump: Pump, signal?: AbortSignal) {
	if (!signal) return pump.ready.promise;
	let cancel!: () => void;
	const cancelled = new Promise<void>((resolve) => {
		cancel = resolve;
	});
	signal.addEventListener("abort", cancel, { once: true });
	try {
		if (!signal.aborted) await Promise.race([pump.ready.promise, cancelled]);
	} finally {
		signal.removeEventListener("abort", cancel);
	}
}
function createSubscription(buffers: EventBufferRegistry, sessionId: string, interval: number, signal?: AbortSignal) {
	const queue: { change: EventChange; bytes: number }[] = [];
	let totalBytes = 0;
	let error: KitError | undefined;
	let wake: (() => void) | undefined;
	const poke = () => wake?.();
	const unsubscribe = buffers.subscribe(sessionId, (change) => {
		if (!change || error) {
			poke();
			return;
		}
		const bytes = eventSize(change.event);
		if (queue.length >= MAX_QUEUE_FRAMES || totalBytes + bytes > MAX_QUEUE_BYTES)
			error = new KitError("provider_error", "客户端读取事件过慢，请重新连接", { retryable: true });
		else {
			totalBytes += bytes;
			queue.push({ change, bytes });
		}
		poke();
	});
	const timer = setInterval(poke, interval);
	signal?.addEventListener("abort", poke, { once: true });
	return {
		get error() {
			return error;
		},
		shift: () => {
			const entry = queue.shift();
			if (entry) totalBytes -= entry.bytes;
			return entry?.change;
		},
		wait: () =>
			new Promise<void>((resolve) => {
				wake = resolve;
			}),
		close: () => {
			clearInterval(timer);
			unsubscribe();
			signal?.removeEventListener("abort", poke);
		},
	};
}

function* replayFrames(buffers: EventBufferRegistry, sessionId: string, after?: string): Generator<SseFrame> {
	const replay = buffers.replay(sessionId, after);
	const cursor = buffers.cursor(sessionId);
	if (replay.reset) yield { type: "reset", data: { session_id: sessionId } };
	for (const change of replay.changes) yield { type: "event", data: change.event, cursor: change.cursor };
	yield {
		type: "ready",
		data: { session_id: sessionId, after: after ?? null, replayed: replay.changes.length, cursor },
	};
}
async function* liveFrames(
	pump: Pump,
	subscription: ReturnType<typeof createSubscription>,
	sessionId: string,
	buffers: EventBufferRegistry,
	interval: number,
	signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
	let lastActivity = Date.now();
	while (!signal?.aborted) {
		if (subscription.error) throw subscription.error;
		const change = subscription.shift();
		if (change) {
			lastActivity = Date.now();
			yield { type: "event", data: change.event, cursor: change.cursor };
			continue;
		}
		if (pump.error) throw pump.error;
		if (pump.terminal) {
			yield {
				type: "done",
				data: {
					session_id: sessionId,
					status: "terminated",
					last_event_id: buffers.get(sessionId)?.events.at(-1)?.event_id ?? null,
					reason: "session_terminal",
					cursor: buffers.cursor(sessionId),
				},
			};
			return;
		}
		if (Date.now() - lastActivity >= interval) {
			lastActivity = Date.now();
			yield { type: "ping", data: { t: lastActivity } };
			continue;
		}
		await subscription.wait();
	}
}

/** 一个 Session 一条持久上游连接；消费者退出时释放，断流不伪造业务完成。 */
export interface SessionStreamsOptions {
	/** 非线程 session_status 归一后的回调（running/requires_action/failed/idle）：live 事件逐条触发，水合后按历史终态触发一次。 */
	onStatus?: (sessionId: string, status: string) => void;
}

export function createSessionStreams(
	gateway: ProviderGateway,
	buffers: EventBufferRegistry,
	pingIntervalMs: number,
	options: SessionStreamsOptions = {},
) {
	const pumps = new Map<string, Pump>();
	const turns = new Map<string, AcceptedTurn>();
	const DETACHED_TIMEOUT_MS = 30 * 60_000;
	function project(sessionId: string, pump: Pump, force = false) {
		const projected = projectSessionRuntime(buffers.ensure(sessionId), turns.get(sessionId));
		if (projected.finished) turns.delete(sessionId);
		const changed = pump.lastStatus !== projected.status;
		pump.lastStatus = projected.status;
		if ((changed || force) && !pump.terminal) pump.onStatus?.(sessionId, projected.status);
	}
	function dispose(sessionId: string, pump: Pump) {
		if (pump.detachTimer) clearTimeout(pump.detachTimer);
		if (pumps.get(sessionId) !== pump) return;
		pumps.delete(sessionId);
		buffers.drop(sessionId);
	}
	function stop(sessionId: string, pump: Pump) {
		pump.controller.abort();
		dispose(sessionId, pump);
	}
	function releaseWhenIdle(sessionId: string, pump: Pump) {
		if (pump.references > 0) return;
		if (!pump.controller.signal.aborted && !pump.terminal && pump.lastStatus === "running") {
			if (!pump.detachTimer) {
				pump.detachTimer = setTimeout(() => {
					turns.delete(sessionId);
					stop(sessionId, pump);
				}, DETACHED_TIMEOUT_MS);
				pump.detachTimer.unref?.();
			}
			return;
		}
		stop(sessionId, pump);
	}
	function start(sessionId: string): Pump {
		const pump: Pump = {
			controller: new AbortController(),
			ready: deferred(),
			connected: deferred(),
			references: 0,
			terminal: false,
			hydrated: false,
			pending: [],
			pendingBytes: 0,
			project,
			hasPendingTurn: () => turns.has(sessionId),
			forgetTurn: () => turns.delete(sessionId),
			onStatus: options.onStatus,
		};
		pump.controller.signal.addEventListener(
			"abort",
			() => {
				const error = new DOMException("已取消", "AbortError");
				pump.connected.reject(error);
				pump.ready.reject(error);
			},
			{ once: true },
		);
		pumps.set(sessionId, pump);
		void initializePump(gateway, buffers, sessionId, pump, () => {
			if (pump.references === 0) stop(sessionId, pump);
		});
		return pump;
	}
	function acquire(sessionId: string) {
		const pump = pumps.get(sessionId) ?? start(sessionId);
		pump.references += 1;
		if (pump.detachTimer) {
			clearTimeout(pump.detachTimer);
			pump.detachTimer = undefined;
		}
		let released = false;
		return {
			pump,
			release: () => {
				if (released) return;
				released = true;
				if (--pump.references === 0) releaseWhenIdle(sessionId, pump);
			},
		};
	}
	return {
		/** 受理一笔新回合：pending turn 在 Provider 回显和终态证据到达前保持 running。 */
		acceptTurn(sessionId: string, turn: AcceptedTurn) {
			turns.set(sessionId, turn);
			const pump = pumps.get(sessionId);
			if (pump) project(sessionId, pump);
		},
		/** 当前 Session 是否有活跃订阅者；无订阅时索引 running 可能已落后于 Provider 终态。 */
		hasSubscribers(sessionId: string) {
			return (pumps.get(sessionId)?.references ?? 0) > 0;
		},
		/** 有上游泵在跟踪（含最后订阅者离开后继续跟踪 running 回合）；此时列表不再额外探测。 */
		isTracking(sessionId: string) {
			return pumps.has(sessionId);
		},
		async use<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
			const lease = acquire(sessionId);
			try {
				await lease.pump.ready.promise;
				if (lease.pump.error) throw lease.pump.error;
				if (lease.pump.terminal) throw new KitError("conflict", "会话已终止");
				return await action();
			} finally {
				lease.release();
			}
		},
		async *frames(sessionId: string, options: { after?: string; signal?: AbortSignal }): AsyncGenerator<SseFrame> {
			const lease = acquire(sessionId);
			let subscription: ReturnType<typeof createSubscription> | undefined;
			try {
				await waitForReady(lease.pump, options.signal);
				if (options.signal?.aborted) return;
				subscription = createSubscription(buffers, sessionId, pingIntervalMs, options.signal);
				yield* replayFrames(buffers, sessionId, options.after);
				yield* liveFrames(lease.pump, subscription, sessionId, buffers, pingIntervalMs, options.signal);
			} catch (error) {
				if (!options.signal?.aborted) {
					const failure = streamError(error);
					yield { type: "error", data: { code: failure.code, message: failure.message, retryable: failure.retryable } };
				}
			} finally {
				subscription?.close();
				lease.release();
			}
		},
	};
}
