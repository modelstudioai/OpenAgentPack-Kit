import { AbortScope } from "../internal/abort-scope.ts";
import { KitError, type SessionSummary } from "../protocol/index.ts";

export interface SessionListQuery {
	agentSlug?: string;
	limit?: number;
	pageToken?: string;
	includeArchived?: boolean;
	q?: string;
}

interface DirectorySource {
	sessionAgents: (signal?: AbortSignal) => Promise<string[]>;
	sessions: (
		query: SessionListQuery,
		signal?: AbortSignal,
	) => Promise<{
		sessions: SessionSummary[];
		nextPageToken: string | null;
	}>;
}

type DirectoryPage = Awaited<ReturnType<DirectorySource["sessions"]>>;

async function readAgentPages(agentSlug: string, readPage: (token?: string) => Promise<DirectoryPage>) {
	const sessions: SessionSummary[] = [];
	const cursors = new Set<string>();
	let token: string | undefined;
	do {
		const page = await readPage(token);
		if (page.sessions.some((session) => session.agent_slug !== agentSlug))
			throw new KitError("internal", "会话目录与智能体不匹配，请重新加载");
		sessions.push(...page.sessions);
		token = page.nextPageToken ?? undefined;
		if (token && (cursors.has(token) || page.sessions.length === 0))
			throw new KitError("internal", "会话分页未正常推进，请重新加载");
		if (token) cursors.add(token);
	} while (token);
	return sessions;
}

/** 先枚举本人的会话智能体，再按智能体完整翻页；并发有界，取消和任一分页失败均不交付部分目录。 */
export async function loadSessionDirectory(source: DirectorySource, signal?: AbortSignal): Promise<SessionSummary[]> {
	const scope = new AbortScope(signal);
	// 大量分组可能触发当前身份的读限流；只对明确可重试的限流退避，不重试其他失败。
	const read = async <T>(request: () => Promise<T>): Promise<T> => {
		for (let attempt = 0; ; attempt++) {
			scope.check();
			try {
				return await scope.wait(request());
			} catch (error) {
				if (!(error instanceof KitError) || error.code !== "rate_limited" || !error.retryable || attempt >= 3)
					throw error;
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					await scope.wait(
						new Promise<void>((resolve) => {
							timer = setTimeout(resolve, 1000 * 2 ** attempt);
						}),
					);
				} finally {
					clearTimeout(timer);
				}
			}
		}
	};
	try {
		const agents = [...new Set(await read(() => source.sessionAgents(scope.signal)))];
		const sessions = new Map<string, SessionSummary>();
		let nextAgent = 0;
		const worker = async () => {
			for (;;) {
				scope.check();
				const agentSlug = agents[nextAgent++];
				if (agentSlug === undefined) return;
				const rows = await readAgentPages(agentSlug, (pageToken) =>
					read(() => source.sessions({ agentSlug, limit: 200, includeArchived: false, pageToken }, scope.signal)),
				);
				for (const session of rows) sessions.set(session.session_id, session);
			}
		};
		await Promise.all(Array.from({ length: Math.min(4, agents.length) }, () => worker()));
		scope.check();
		return [...sessions.values()].sort((a, b) => {
			const left = a.last_event_at ?? a.created_at;
			const right = b.last_event_at ?? b.created_at;
			if (left !== right) return left > right ? -1 : 1;
			return a.session_id === b.session_id ? 0 : a.session_id > b.session_id ? -1 : 1;
		});
	} catch (error) {
		scope.fail(error);
		throw error;
	} finally {
		scope.dispose();
	}
}
