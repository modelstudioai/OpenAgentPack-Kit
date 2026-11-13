import type { KitClient } from "../providers/kit/client.ts";
import { createObservable, createQuery } from "../state.ts";
import { createSessionActions, type SessionAction } from "./session-actions.ts";
import { createSessionPages, EMPTY_SESSION_PAGE } from "./session-pages.ts";

export function createSessionDirectory(
	client: KitClient,
	options: { onExecuted?: (id: string, action: SessionAction) => void } = {},
) {
	const groups = createQuery((signal) => client.sessionAgents(signal));
	const pages = createSessionPages(client, { label: "历史会话" });
	const recentPages = createSessionPages(client, { label: "最近会话" });
	let statusRefresh: AbortController | undefined;
	let agentCheck: AbortController | undefined;
	let previousChat: { sessionId: string | null; phase: string; failed: boolean } | undefined;
	const store = createObservable(read());
	function read() {
		const groupState = groups.getSnapshot();
		const rows = (groupState.data ?? []).map((slug) => ({ slug, ...pages.page(slug) }));
		return {
			groups: rows,
			sessions: rows.flatMap((row) => row.sessions),
			loading: groupState.loading,
			error: groupState.error ? "历史会话加载失败，请重试。" : null,
			recent: { ...recentPages.page(""), applySummaries: recentPages.applySummaries },
		};
	}
	const update = () => store.set(read());
	const subscriptions = [groups.subscribe(update), pages.subscribe(update), recentPages.subscribe(update)];
	const reloadGroups = () => {
		if (client.supports("sessionAgents")) void groups.refresh();
	};
	const reload = () => {
		reloadGroups();
		pages.reloadLoaded();
		recentPages.reload("");
	};
	const actions = createSessionActions(client, (id, action) => {
		reload();
		options.onExecuted?.(id, action);
	});
	async function refreshStatuses() {
		if (statusRefresh || !client.supports("sessions")) return;
		const owner = new AbortController();
		statusRefresh = owner;
		try {
			await Promise.all([
				...store
					.getSnapshot()
					.groups.filter((group) => group.initialized)
					.map(async (group) => {
						const result = await client.sessions(
							{
								agentSlug: group.slug,
								limit: Math.min(200, Math.max(10, group.sessions.length)),
								includeArchived: false,
							},
							owner.signal,
						);
						if (!owner.signal.aborted) pages.applySummaries(result.sessions);
					}),
				client.sessions({ limit: 200, includeArchived: false }, owner.signal).then((result) => {
					if (!owner.signal.aborted) recentPages.applySummaries(result.sessions);
				}),
			]);
		} catch {
			/* A refresh failure retains the current page and its cursors. */
		} finally {
			if (statusRefresh === owner) statusRefresh = undefined;
		}
	}
	return {
		...store,
		actions,
		reload,
		reloadGroups,
		refreshStatuses,
		async checkAgent(slug: string) {
			agentCheck?.abort();
			const owner = new AbortController();
			agentCheck = owner;
			const agents = await client.agents(owner.signal);
			owner.signal.throwIfAborted();
			return agents.some((agent) => agent.slug === slug);
		},
		observeChat(state: { sessionId: string | null; phase: string; failed: boolean }) {
			const previous = previousChat;
			previousChat = state;
			if (state.failed && (!previous?.failed || previous.sessionId !== state.sessionId)) reload();
			if (
				previous?.sessionId === state.sessionId &&
				["running", "stopping", "requires_action"].includes(previous.phase) &&
				!["running", "stopping", "requires_action"].includes(state.phase)
			)
				reload();
		},
		watchStatuses(sessionId: string | null, currentExecuting: boolean) {
			let timer: ReturnType<typeof setInterval> | undefined;
			const reconcile = () => {
				const state = store.getSnapshot();
				const running = [...state.sessions, ...state.recent.sessions].filter((row) => row.status === "running");
				const needed = running.some((row) => row.session_id !== sessionId) || (!currentExecuting && running.length > 0);
				if (needed && !timer) {
					timer = setInterval(() => void refreshStatuses(), 4000);
					void refreshStatuses();
				}
				if (!needed && timer) {
					clearInterval(timer);
					timer = undefined;
				}
			};
			const stop = store.subscribe(reconcile);
			reconcile();
			return () => {
				stop();
				clearInterval(timer);
			};
		},
		start() {
			reloadGroups();
			recentPages.load("");
		},
		rename: async (id: string, title: string) => {
			const detail = await client.renameSession(id, title);
			reload();
			return detail;
		},
		dispose() {
			agentCheck?.abort();
			statusRefresh?.abort();
			groups.dispose();
			pages.dispose();
			recentPages.dispose();
			actions.dispose();
			for (const unsubscribe of subscriptions) unsubscribe();
		},
	};
}

/** Debouncing and pagination share the same cache implementation as the directory. */
export function createSessionSearch(client: KitClient, delayMs = 250) {
	const store = createObservable({ ...EMPTY_SESSION_PAGE, query: "", pending: false });
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pages: ReturnType<typeof createSessionPages> | undefined;
	let unsubscribe: (() => void) | undefined;
	let input = "";
	const update = () => store.set({ ...(pages?.page("") ?? EMPTY_SESSION_PAGE), query: input, pending: false });
	return {
		...store,
		setQuery(value: string) {
			const query = value.trim();
			if (query === input) return;
			input = query;
			clearTimeout(timer);
			unsubscribe?.();
			pages?.dispose();
			pages = undefined;
			store.set({ ...EMPTY_SESSION_PAGE, query, pending: Boolean(query) });
			if (!query) return;
			timer = setTimeout(() => {
				pages = createSessionPages(client, { query, limit: 50, label: "搜索会话" });
				unsubscribe = pages.subscribe(update);
				pages.load("");
			}, delayMs);
		},
		load: () => pages?.load(""),
		reload: () => pages?.reload(""),
		retry: () => pages?.retry(""),
		loadMore: () => pages?.loadMore(""),
		dispose() {
			clearTimeout(timer);
			unsubscribe?.();
			pages?.dispose();
		},
	};
}
