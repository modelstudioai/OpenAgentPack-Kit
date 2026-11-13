import { AbortScope } from "../internal/abort-scope.ts";
import { openBodyReader } from "../internal/body.ts";
import { createSseParser, type RawSseMessage, type SseParserOptions } from "../protocol/index.ts";

export type { RawSseMessage } from "../protocol/index.ts";

/** 解码/分帧错误与 reader 的网络错误分开，供协议层决定是否重试。 */
export class SseStreamError extends Error {
	override readonly name = "SseStreamError";

	constructor(cause: unknown) {
		super("Invalid SSE framing or text encoding", { cause });
	}
}

export interface SseStreamOptions extends SseParserOptions {
	signal?: AbortSignal;
	/** 默认 false：以替换字符解码非法 UTF-8；原始百炼适配使用 true。 */
	utf8Fatal?: boolean;
	/** 默认 true：自然 EOF 时交付尚未用空行结束的尾帧。 */
	flushOnEnd?: boolean;
}

/** 只解码并分帧。取消、提前 break 或解析失败都会释放读取锁。 */
export async function* createSseStream(
	body: ReadableStream<Uint8Array>,
	options: SseStreamOptions = {},
): AsyncGenerator<RawSseMessage, void, unknown> {
	const scope = new AbortScope(options.signal);
	let owned: ReturnType<typeof openBodyReader> | undefined;
	try {
		owned = openBodyReader(body, scope.signal);
		scope.check();
		const decoder = new TextDecoder("utf-8", { fatal: options.utf8Fatal ?? false });
		let pending: RawSseMessage[] = [];
		const parser = createSseParser((frame) => pending.push(frame), {
			maxFrameChars: options.maxFrameChars,
			onComment: () => {
				scope.check();
				options.onComment?.();
			},
		});
		while (true) {
			const { done, value } = await scope.wait(owned.reader.read());
			let failure: unknown;
			let failed = false;
			try {
				if (!done) parser.push(decoder.decode(value, { stream: true }));
				else if (options.flushOnEnd !== false) {
					parser.push(decoder.decode());
					parser.end();
				}
			} catch (error) {
				scope.check();
				failed = true;
				failure = new SseStreamError(error);
			}
			for (const frame of pending) {
				scope.check();
				yield frame;
			}
			pending = [];
			scope.check();
			if (failed) throw failure;
			if (done) return;
		}
	} finally {
		scope.dispose();
		await owned?.close();
	}
}
