import type { SessionSummary } from "../protocol/index.ts";
import type { KitClient } from "../providers/kit/client.ts";
import { createObservable } from "../state.ts";

export interface SessionPageState {
	sessions: SessionSummary[];
	initialized: boolean;
	loading: boolean;
	loadingMore: boolean;
	hasMore: boolean;
	error: string | null;
}
export interface SessionPage extends SessionPageState {
	load(): void;
	reload(): void;
	loadMore(): void;
	retry(): void;
}
export const EMPTY_SESSION_PAGE: SessionPageState = {
	sessions: [],
	initialized: false,
	loading: false,
	loadingMore: false,
	hasMore: false,
	error: null,
};
interface PendingPage {
	controller: AbortController;
	cursor: string | null;
	seen: Set<string>;
	busy: boolean;
	failed: "reset" | "more" | null;
}

/** Shared paging cache for groups, recent sessions and search. Cursor advancement is validated before committing a page. */
export function createSessionPages(
	client: KitClient,
	options: { label?: string; query?: string; limit?: number } = {},
) {
	const store = createObservable(new Map<string, SessionPageState>());
	const pending = new Map<string, PendingPage>();
	const update = (slug: string, change: (state: SessionPageState) => SessionPageState) =>
		store.set(new Map(store.getSnapshot()).set(slug, change(store.getSnapshot().get(slug) ?? EMPTY_SESSION_PAGE)));
	function request(slug: string, mode: "reset" | "more", retry = false) {
		if (!client.supports("sessions")) return;
		const previous = pending.get(slug);
		if (mode === "more" && (!previous || previous.busy || !previous.cursor || (previous.failed && !retry))) return;
		previous?.controller.abort();
		const current: PendingPage = {
			controller: new AbortController(),
			cursor: mode === "more" ? (previous?.cursor ?? null) : null,
			seen: mode === "more" ? new Set(previous?.seen) : new Set(),
			busy: true,
			failed: null,
		};
		pending.set(slug, current);
		const isCurrent = () => pending.get(slug) === current && !current.controller.signal.aborted;
		update(slug, (page) => ({ ...page, loading: mode === "reset", loadingMore: mode === "more", error: null }));
		void client
			.sessions(
				{
					agentSlug: slug || undefined,
					q: options.query,
					limit: options.limit ?? 10,
					includeArchived: false,
					pageToken: current.cursor ?? undefined,
				},
				current.controller.signal,
			)
			.then((result) => {
				if (!isCurrent()) return;
				if (slug && result.sessions.some((row) => row.agent_slug !== slug)) throw new Error("会话与智能体不匹配");
				if (result.nextPageToken && (current.seen.has(result.nextPageToken) || !result.sessions.length))
					throw new Error("会话游标未推进");
				if (result.nextPageToken) current.seen.add(result.nextPageToken);
				current.cursor = result.nextPageToken;
				update(slug, (page) => {
					const rows = new Map((mode === "more" ? page.sessions : []).map((row) => [row.session_id, row]));
					for (const row of result.sessions) rows.set(row.session_id, row);
					return { ...page, sessions: [...rows.values()], initialized: true, hasMore: result.nextPageToken !== null };
				});
			})
			.catch(() => {
				if (!isCurrent()) return;
				current.failed = mode;
				update(slug, (page) => ({
					...page,
					error: `${mode === "more" ? "更多会话" : (options.label ?? "会话")}加载失败，请重试。`,
				}));
			})
			.finally(() => {
				if (!isCurrent()) return;
				current.busy = false;
				update(slug, (page) => ({ ...page, loading: false, loadingMore: false }));
			});
	}
	const load = (slug: string) => {
		if (!pending.has(slug)) request(slug, "reset");
	};
	const reload = (slug: string) => request(slug, "reset");
	const loadMore = (slug: string) => request(slug, "more");
	const retry = (slug: string) => request(slug, pending.get(slug)?.failed ?? "reset", true);
	function applySummaries(summaries: SessionSummary[]) {
		const updates = new Map(summaries.map((row) => [row.session_id, row]));
		store.set(
			new Map(
				[...store.getSnapshot()].map(([slug, page]) => [
					slug,
					{ ...page, sessions: page.sessions.map((row) => updates.get(row.session_id) ?? row) },
				]),
			),
		);
	}
	return {
		...store,
		load,
		reload,
		loadMore,
		retry,
		applySummaries,
		page: (slug: string): SessionPage => ({
			...(store.getSnapshot().get(slug) ?? EMPTY_SESSION_PAGE),
			load: () => load(slug),
			reload: () => reload(slug),
			loadMore: () => loadMore(slug),
			retry: () => retry(slug),
		}),
		reloadLoaded: () => {
			for (const slug of pending.keys()) reload(slug);
		},
		dispose: () => {
			for (const page of pending.values()) page.controller.abort();
			pending.clear();
		},
	};
}
