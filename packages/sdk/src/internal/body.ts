/** reader 的唯一持有者；取消在消费方暂停迭代期间也立即生效。 */
export function openBodyReader(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
	const reader = body.getReader();
	let closing: Promise<void> | undefined;
	const onAbort = () => {
		void close();
	};
	function close(): Promise<void> {
		signal?.removeEventListener("abort", onAbort);
		closing ??= reader
			.cancel()
			.catch(() => undefined)
			.finally(() => reader.releaseLock());
		return closing;
	}
	if (signal?.aborted) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });
	return { reader, close };
}

/** 自定义 fetch 即便忽略 signal，Response.json/text 与自定义 mapper 也能中断读取。 */
export function abortableResponse(response: Response, signal?: AbortSignal, onClose?: () => void): Response {
	if (!response.body || [204, 205, 304].includes(response.status)) {
		onClose?.();
		return response;
	}
	if (!signal && !onClose) return response;
	signal ??= new AbortController().signal;
	const owned = openBodyReader(response.body, signal);
	let finished = false;
	let onAbort: () => void;
	const finish = () => {
		if (finished) return owned.close();
		finished = true;
		signal.removeEventListener("abort", onAbort);
		return owned.close().finally(onClose);
	};
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			onAbort = () => {
				controller.error(signal.reason);
				void finish();
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		},
		async pull(controller) {
			try {
				const chunk = await owned.reader.read();
				if (finished) return;
				if (chunk.done) {
					controller.close();
					await finish();
				} else controller.enqueue(chunk.value);
			} catch (error) {
				if (!finished) controller.error(error);
				await finish();
			}
		},
		cancel: finish,
	});
	const wrapped = new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
	// Response 构造器不能设置这三个只读元数据；映射器仍需看到原请求的值。
	for (const key of ["url", "redirected", "type"] as const)
		Object.defineProperty(wrapped, key, { value: response[key] });
	return wrapped;
}
