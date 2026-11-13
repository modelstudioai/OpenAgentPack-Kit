import type { AdminMembersPage, CreateMemberRequest, CreateMemberResponse } from "@openagentpack/kit-sdk/protocol";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { useEffect, useRef, useState } from "react";
import { adminApi } from "../../lib/api.ts";

function errorMessage(cause: unknown, fallback: string) {
	return cause instanceof Error ? cause.message : fallback;
}

/** 查询变更会取消旧请求；分页游标只属于当前搜索条件。 */
export function useMembers() {
	const [query, setQuery] = useState({ search: "", cursors: [""], revision: 0 });
	const [result, setResult] = useState<AdminMembersPage | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const pageToken = query.cursors.at(-1) || undefined;
		setLoading(true);
		setError(null);
		setResult(null);
		const load = () =>
			adminApi.members
				.list({ search: query.search, page_token: pageToken, limit: 20 }, controller.signal)
				.then((page) => {
					if (controller.signal.aborted) return;
					setResult(page);
					if (page.data.some((member) => member.usage_summary?.refresh_status === "refreshing")) {
						timer = setTimeout(() => void load(), 2_000);
					}
				})
				.catch((cause: unknown) => {
					if (controller.signal.aborted) return;
					if (pageToken && cause instanceof KitError && cause.code === "invalid_request") {
						setQuery((current) => ({ ...current, cursors: [""] }));
						return;
					}
					setError(errorMessage(cause, "成员列表加载失败"));
				})
				.finally(() => {
					if (!controller.signal.aborted) setLoading(false);
				});
		void load();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [query]);
	return {
		rows: result?.data ?? [],
		loading,
		error,
		search: query.search,
		page: query.cursors.length,
		hasNext: !!result?.next_page_token,
		reload: () => setQuery((current) => ({ ...current, revision: current.revision + 1 })),
		refresh: () => setQuery((current) => ({ ...current, cursors: [""], revision: current.revision + 1 })),
		searchFor: (search: string) =>
			setQuery((current) => ({ search: search.trim(), cursors: [""], revision: current.revision + 1 })),
		next: () => {
			const cursor = result?.next_page_token;
			if (!loading && cursor) setQuery((current) => ({ ...current, cursors: [...current.cursors, cursor] }));
		},
		previous: () => {
			if (!loading && query.cursors.length > 1) {
				setQuery((current) => ({ ...current, cursors: current.cursors.slice(0, -1) }));
			}
		},
	};
}

/** 密码与一次性创建结果只保留在当前页面状态，不写持久存储。 */
export function useCreateMember(onPendingChange: (pending: boolean) => void) {
	const [result, setResult] = useState<CreateMemberResponse["data"] | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const active = useRef(true);
	const submitting = useRef(false);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
			onPendingChange(false);
		};
	}, [onPendingChange]);
	useEffect(() => {
		if (!pending) return;
		const warnBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warnBeforeUnload);
		return () => window.removeEventListener("beforeunload", warnBeforeUnload);
	}, [pending]);
	return {
		result,
		pending,
		error,
		async create(input: CreateMemberRequest) {
			if (submitting.current) return;
			submitting.current = true;
			setPending(true);
			onPendingChange(true);
			setError(null);
			try {
				const created = await adminApi.members.create(input);
				if (active.current) {
					setResult(created);
					return true;
				}
			} catch (cause) {
				if (active.current) setError(errorMessage(cause, "创建用户失败，请重试"));
			} finally {
				submitting.current = false;
				if (active.current) {
					setPending(false);
					onPendingChange(false);
				}
			}
		},
	};
}
