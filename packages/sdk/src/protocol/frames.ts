import type { SessionEvent } from "./events.ts";

/** SSE 帧类型。控制帧不是 Event，见 docs/protocol.md 与 AGENTS.md 不变量 4。 */
export type SseFrameType = "reset" | "ready" | "event" | "done" | "error" | "ping" | "operation";

export interface ReadyPayload {
	session_id: string;
	after: string | null;
	replayed: number;
	cursor?: string | null;
}
export interface DonePayload {
	session_id: string;
	status: string;
	last_event_id: string | null;
	reason: string | null;
	cursor?: string | null;
}
export interface ErrorPayload {
	code: string;
	message: string;
	retryable: boolean;
}
export interface PingPayload {
	t: number;
}
export interface OperationProgress {
	operation_id: string;
	phase: string;
	progress: number;
	message?: string;
}

export type SseFrame =
	| { type: "reset"; data: { session_id: string } }
	| { type: "ready"; data: ReadyPayload }
	| { type: "event"; data: SessionEvent; cursor?: string }
	| { type: "done"; data: DonePayload }
	| { type: "error"; data: ErrorPayload }
	| { type: "ping"; data: PingPayload }
	| { type: "operation"; data: OperationProgress };

/** 原始 SSE 块：parser 只负责切分，不做业务解码。 */
export interface RawSseMessage {
	event: string;
	data: string;
	id?: string;
}

export function encodeFrame(frame: SseFrame): string {
	return encodeRaw({
		event: frame.type,
		data: JSON.stringify(frame.data),
		...(frame.type === "event" && frame.cursor ? { id: frame.cursor } : {}),
	});
}

export function encodeRaw(message: RawSseMessage): string {
	const data = message.data
		.split("\n")
		.map((line) => `data: ${line}`)
		.join("\n");
	if (message.id && /[\r\n\0]/.test(message.id)) throw new Error("Invalid stream cursor");
	return `${message.id === undefined ? "" : `id: ${message.id}\n`}event: ${message.event}\n${data}\n\n`;
}

/**
 * 增量 SSE 解析器：处理分片、粘包、多行 data、CRLF 与注释行。
 * 未知 event 名会原样吐出（由调用方决定丢弃或降级），保证「不静默丢帧」。
 */
export interface SseParserOptions {
	/** 完整注释行可作为保活；不进入业务事件解码。 */
	onComment?: () => void;
	/** 可选帧大小上限，包含未结束的行；旧调用不增加限制。 */
	maxFrameChars?: number;
}

export function createSseParser(onMessage: (message: RawSseMessage) => void, options: SseParserOptions = {}) {
	if (
		options.maxFrameChars !== undefined &&
		(!Number.isSafeInteger(options.maxFrameChars) || options.maxFrameChars < 1)
	)
		throw new RangeError("SSE frame limit must be a positive integer");
	let buffer = "";
	let frameChars = 0;
	let eventName = "";
	let eventId: string | undefined;
	let skipLf = false;
	const dataLines: string[] = [];

	const dispatch = () => {
		if (dataLines.length === 0 && eventName === "") return;
		const message: RawSseMessage = {
			event: eventName || "message",
			data: dataLines.join("\n"),
			...(eventId === undefined ? {} : { id: eventId }),
		};
		eventName = "";
		eventId = undefined;
		dataLines.length = 0;
		onMessage(message);
	};

	const applyField = (field: string, value: string) => {
		if (field === "data") dataLines.push(value);
		else if (field === "event") eventName = value;
		else if (field === "id" && !value.includes("\0")) eventId = value;
	};

	const applyBareField = (field: string) => {
		// 只有字段名、无值：按 SSE 规范等价于空值
		if (field === "data") dataLines.push("");
		else if (field === "event") eventName = "";
		else if (field === "id") eventId = "";
	};

	const parseField = (line: string): { field: string; value: string } | null => {
		const colon = line.indexOf(":");
		if (colon === -1) return null;
		const rawValue = line.slice(colon + 1);
		return { field: line.slice(0, colon), value: rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue };
	};

	/** 消费一行（不含换行符）：空行派发、注释跳过、字段累加。 */
	const consumeLine = (rawLine: string) => {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (line === "") {
			frameChars = 0;
			return dispatch();
		}
		if (line.startsWith(":")) {
			frameChars -= rawLine.length;
			options.onComment?.();
			return;
		}
		const parsed = parseField(line);
		if (!parsed) return applyBareField(line);
		applyField(parsed.field, parsed.value);
	};
	const appendCharacter = (character: string) => {
		frameChars += character.length;
		if (frameChars > (options.maxFrameChars ?? Number.POSITIVE_INFINITY))
			throw new RangeError("SSE frame exceeded its size limit");
		buffer += character;
	};

	return {
		push(chunk: string) {
			for (const character of chunk) {
				if (skipLf) {
					skipLf = false;
					if (character === "\n") continue;
				}
				if (character === "\r" || character === "\n") {
					consumeLine(buffer);
					buffer = "";
					skipLf = character === "\r";
				} else appendCharacter(character);
			}
		},
		end() {
			if (buffer) consumeLine(buffer);
			buffer = "";
			// 流结束时若还有未以空行收尾的消息，补一次派发，避免尾帧丢失
			dispatch();
		},
	};
}

/** 把原始消息解码成强类型帧；未知 event 返回 null（调用方计数并忽略）。 */
export function decodeFrame(message: RawSseMessage): SseFrame | null {
	let data: unknown;
	try {
		data = JSON.parse(message.data || "null");
	} catch {
		return null;
	}
	switch (message.event) {
		case "event":
			return { type: "event", data: data as SessionEvent, ...(message.id ? { cursor: message.id } : {}) };
		case "reset":
		case "ready":
		case "done":
		case "error":
		case "ping":
		case "operation":
			return { type: message.event, data } as SseFrame;
		default:
			return null;
	}
}
