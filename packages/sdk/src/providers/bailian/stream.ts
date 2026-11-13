import { createBailianSessionEventNormalizer } from "@openagentpack/sdk/session-events";
import { AbortScope } from "../../internal/abort-scope.ts";
import { KitError, type RawSseMessage, type SessionEvent } from "../../protocol/index.ts";
import { createSseStream, SseStreamError } from "../../stream/index.ts";
import type { StreamSessionOptions } from "../contract.ts";
import type { BailianChatProviderOptions, BailianStreamResponse } from "./contract.ts";
import { closeResponse, executeOperation } from "./operation.ts";
import { BailianReplay } from "./replay.ts";

const protocolError = () => new KitError("provider_error", "百炼事件流或历史不符合接入合同");
const networkError = () => new KitError("provider_error", "自建后端事件连接失败", { retryable: true });
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function streamFailure(error: unknown): KitError {
	if (error instanceof KitError) return error;
	return error instanceof SseStreamError ? protocolError() : networkError();
}

function validateStream(opened: BailianStreamResponse): ReadableStream<Uint8Array> {
	if (
		!opened.ready ||
		typeof opened.ready.then !== "function" ||
		!opened.response.body ||
		opened.response.headers.get("content-type")?.split(";")[0]?.trim() !== "text/event-stream"
	)
		throw protocolError();
	return opened.response.body;
}

function parseEvent(frame: RawSseMessage): Record<string, unknown> {
	let raw: unknown;
	try {
		raw = JSON.parse(frame.data);
	} catch {
		throw protocolError();
	}
	if (!isRecord(raw)) throw protocolError();
	// 有 type 的错误是 Provider 业务事件；无业务身份的 error envelope 是连接错误。
	if (frame.event === "error" && typeof raw.type !== "string")
		throw new KitError("provider_error", "上游事件连接报告错误", { retryable: raw.retryable === true });
	return raw;
}

function nextHistoryPage(next: string | null | undefined, pages: Set<string>): string | undefined {
	if (next === undefined || next === null) return;
	if (typeof next !== "string" || !next || pages.has(next)) throw protocolError();
	pages.add(next);
	return next;
}

export async function streamBailianBackend(
	sessionId: string,
	options: BailianChatProviderOptions,
	handlers: StreamSessionOptions,
): Promise<void> {
	const scope = new AbortScope(handlers.signal);
	const signal = scope.signal;
	const maxFrames = options.maxBufferedFrames ?? 1024;
	const maxBytes = options.maxBufferedBytes ?? 8 * 1024 * 1024;
	const maxHistory = options.maxHistoryEvents ?? 10_000;
	const normalizer = createBailianSessionEventNormalizer({
		redact: false,
		truncate: false,
		includeRaw: false,
		maxEntries: maxHistory + maxFrames,
	});
	const replay = new BailianReplay();
	const identities = new Set<string>();
	const unresolvedContent = new Set<string>();
	let buffered: Record<string, unknown>[] = [];
	let bytes = 0;
	let live = false;
	let response: Response | undefined;
	let pump: Promise<void> | undefined;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const connectTimer = setTimeout(
		() => scope.fail(new KitError("provider_error", "订阅就绪或历史重建超时", { retryable: true })),
		options.connectTimeoutMs ?? 30_000,
	);
	const activity = () => {
		scope.check();
		clearTimeout(idleTimer);
		idleTimer = setTimeout(
			() => scope.fail(new KitError("provider_error", "事件连接长时间没有响应", { retryable: true })),
			options.idleTimeoutMs ?? 45_000,
		);
	};
	function trackIdentity(raw: Record<string, unknown>, event: SessionEvent | undefined) {
		if (live) return;
		if (raw.object === "content") {
			const identity = raw.type === "event_delta" ? raw.event_id : raw.msg_id;
			if (typeof identity === "string" && !identities.has(identity)) unresolvedContent.add(identity);
		} else if (event?.event_id) {
			identities.add(event.event_id);
			unresolvedContent.delete(event.event_id);
		}
	}
	function convert(raw: Record<string, unknown>, history = false): SessionEvent | undefined {
		try {
			const event = history ? normalizer.seed(raw) : normalizer.push(raw);
			if (event && !event.event_id) throw protocolError();
			trackIdentity(raw, event);
			return event;
		} catch {
			throw protocolError();
		}
	}
	function consume(frame: RawSseMessage) {
		scope.check();
		if (frame.event === "heartbeat") {
			activity();
			handlers.onPing?.(Date.now());
			return;
		}
		const raw = parseEvent(frame);
		activity();
		if (live) {
			const event = convert(raw);
			scope.check();
			if (event) handlers.onEvent?.(event);
		} else {
			bytes += new TextEncoder().encode(frame.data).byteLength;
			if (buffered.length >= maxFrames || bytes > maxBytes)
				throw new KitError("provider_error", "历史重建期间实时事件缓冲超限");
			buffered.push(raw);
		}
	}
	async function readStream(body: ReadableStream<Uint8Array>) {
		try {
			for await (const frame of createSseStream(body, {
				signal,
				utf8Fatal: true,
				maxFrameChars: maxBytes,
				onComment: activity,
				flushOnEnd: false,
			})) {
				scope.check();
				try {
					consume(frame);
				} catch (error) {
					scope.check();
					throw error instanceof KitError ? error : protocolError();
				}
			}
			throw new KitError("provider_error", "事件连接意外关闭", { retryable: true });
		} catch (error) {
			// 已明确取消/超时的错误由 scope 保留；底层解码错误不能包含响应内容。
			scope.fail(streamFailure(error));
		}
	}
	async function loadHistory() {
		const pages = new Set<string>();
		let pageToken: string | undefined;
		let count = 0;
		const applyHistory = (events: Record<string, unknown>[]) => {
			if (!Array.isArray(events)) throw protocolError();
			for (const raw of events) {
				scope.check();
				if (!isRecord(raw) || ++count > maxHistory) throw protocolError();
				const event = convert(raw, true);
				if (event) replay.addHistory(event);
			}
		};
		do {
			const page = await executeOperation(
				options.request,
				options.listEvents,
				{ sessionId, ...(pageToken ? { pageToken } : {}) },
				scope,
			);
			if (!isRecord(page)) throw protocolError();
			applyHistory(page.events);
			pageToken = nextHistoryPage(page.nextPageToken, pages);
		} while (pageToken);
	}
	function finishReplay() {
		for (const raw of buffered) {
			scope.check();
			const event = convert(raw);
			if (event) replay.addBuffered(event);
		}
		buffered = [];
		bytes = 0;
		// SDK 会暂存身份尚未到达的 content；没有输出不能据此判定会话为空或空闲。
		if (unresolvedContent.size) throw protocolError();
		const events = replay.finish();
		for (const event of events) {
			scope.check();
			handlers.onEvent?.(event);
		}
		scope.check();
		clearTimeout(connectTimer);
		live = true;
		identities.clear();
		handlers.onReady?.({ sessionId, replayed: events.length, cursor: null });
	}
	try {
		scope.check();
		const opened = await executeOperation(options.request, options.openStream, { sessionId }, scope, (result) => {
			// ready 的拒绝始终有处理器；即便映射忽略 signal，迟到响应也必须关闭。
			void result.ready?.catch(() => undefined);
			if (signal.aborted) void closeResponse(result.response);
		});
		response = opened.response;
		const body = validateStream(opened);
		activity();
		pump = readStream(body);
		await scope.wait(opened.ready);
		handlers.onReset?.();
		await loadHistory();
		finishReplay();
		await scope.wait(pump);
	} catch (error) {
		scope.check();
		throw error instanceof KitError ? error : networkError();
	} finally {
		clearTimeout(connectTimer);
		clearTimeout(idleTimer);
		scope.dispose();
		if (!pump) await closeResponse(response);
		await pump;
		buffered = [];
		normalizer.clear();
	}
}
