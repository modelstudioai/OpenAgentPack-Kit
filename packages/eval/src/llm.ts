/** judge/生成模型通道：dashscope compatible-mode（与 agentstudio 同 key，见探针记录）。 */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LlmClient {
	chat(messages: ChatMessage[], options?: { temperature?: number }): Promise<string>;
}

export function createLlmClient(options: { apiKey: string; model: string; baseUrl?: string }): LlmClient {
	const base = options.baseUrl ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
	return {
		async chat(messages, chatOptions = {}) {
			const res = await fetch(`${base}/chat/completions`, {
				method: "POST",
				headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
				body: JSON.stringify({
					model: options.model,
					messages,
					...(chatOptions.temperature != null ? { temperature: chatOptions.temperature } : {}),
				}),
				// judge/gen 调用必须有界：曾观测到无超时 fetch 把整 run 挂死（2026-10-23）
				signal: AbortSignal.timeout(180_000),
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`judge/gen 模型调用失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
			}
			const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
			const content = body.choices?.[0]?.message?.content;
			if (!content) throw new Error("judge/gen 模型返回空内容");
			return content;
		},
	};
}

/** 从模型回复里抠出第一个 JSON 对象/数组（容忍 markdown 围栏与前后废话）。 */
export function extractJson<T>(text: string): T {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced?.[1] ?? text;
	const start = candidate.search(/[[{]/);
	if (start < 0) throw new Error(`模型回复里没有 JSON：${text.slice(0, 120)}`);
	const slice = candidate.slice(start);
	try {
		return JSON.parse(slice) as T;
	} catch {
		// 截到最后一个配对括号再试一次（模型偶尔追加解释）
		const end = Math.max(slice.lastIndexOf("}"), slice.lastIndexOf("]"));
		return JSON.parse(slice.slice(0, end + 1)) as T;
	}
}
