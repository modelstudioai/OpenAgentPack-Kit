import { KitError, SessionThreadsResponseSchema } from "../../protocol/index.ts";
import type { BailianThreadOperations, BailianThreadQuery } from "./contract.ts";

/** 自建服务保留百炼标准路径/包装即可接入；应用身份由 RequestClient 注入。 */
export function createBailianThreadOperations(options: { basePath?: string } = {}): BailianThreadOperations {
	const base = (options.basePath ?? "/api/v1/agentstudio").replace(/\/+$/, "");
	const path = (input: BailianThreadQuery, tail: string) => {
		const query = new URLSearchParams();
		query.set("limit", String(input.limit ?? 50));
		if (input.pageToken) query.set("page", input.pageToken);
		if (tail) query.set("order", "desc");
		return `${base}/sessions/${encodeURIComponent(input.sessionId)}/threads${tail}?${query}`;
	};
	const read = async (response: Response) => {
		const value: unknown = await response.json();
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new KitError("provider_error", "百炼线程响应格式无效");
		const page = value as Record<string, unknown>;
		if (
			!Array.isArray(page.data) ||
			(page.next_page != null && typeof page.next_page !== "string") ||
			(page.has_more === true && !page.next_page)
		)
			throw new KitError("provider_error", "百炼线程分页格式无效");
		return {
			data: page.data,
			next_page_token: typeof page.next_page === "string" && page.next_page ? page.next_page : null,
		};
	};
	return {
		listThreads: {
			buildRequest: (input) => ({ path: path(input, "") }),
			mapResponse: async (response) => SessionThreadsResponseSchema.parse(await read(response)),
		},
		listThreadEvents: {
			buildRequest: (input) => ({ path: path(input, `/${encodeURIComponent(input.threadId)}/events`) }),
			mapResponse: async (response) => {
				const page = await read(response);
				if (page.data.some((item) => !item || typeof item !== "object" || Array.isArray(item)))
					throw new KitError("provider_error", "百炼线程事件格式无效");
				return { events: (page.data as Record<string, unknown>[]).toReversed(), nextPageToken: page.next_page_token };
			},
		},
	};
}
