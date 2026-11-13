import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { KitError, type SessionPage, type SessionSummary } from "@openagentpack/kit-sdk/protocol";

export interface SessionDirectoryQuery {
	agentSlug?: string;
	limit?: number;
	pageToken?: string;
	includeArchived?: boolean;
	q?: string;
	/** 当前 Catalog 展示名命中的智能体；与标题/slug 命中一起在分页前过滤。 */
	agentSlugs?: string[];
}

interface Cursor {
	context: string;
	at: string;
	id: string;
}

function readCursor(token: string | undefined, context: string): Cursor | undefined {
	if (!token) return undefined;
	try {
		const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
		if (
			value &&
			typeof value === "object" &&
			"context" in value &&
			value.context === context &&
			"at" in value &&
			typeof value.at === "string" &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.at) &&
			"id" in value &&
			typeof value.id === "string" &&
			value.id.length > 0
		)
			return { context, at: value.at, id: value.id };
	} catch {
		// 不回显不可信游标正文。
	}
	throw new KitError("invalid_request", "会话分页游标无效或与当前查询不匹配，请重新查询");
}

function nextCursor(data: SessionSummary[], hasMore: boolean, context: string): string | null {
	const last = data.at(-1);
	if (!hasMore || !last) return null;
	return Buffer.from(
		JSON.stringify({ context, at: last.last_event_at ?? last.created_at, id: last.session_id }),
	).toString("base64url");
}

/** SQLite LIKE 的转义规则：用户输入里的通配符按字面量匹配。 */
function likePattern(value: string) {
	return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function searchClause(q: string | undefined, agentSlugs: string[]) {
	if (!q) return "";
	const agentMatch = agentSlugs.length ? ` OR agent_slug IN (${agentSlugs.map(() => "?").join(", ")})` : "";
	return `AND (title LIKE ? ESCAPE '\\' OR agent_slug LIKE ? ESCAPE '\\'${agentMatch})`;
}

function cursorClause(cursor: Cursor | undefined) {
	return cursor
		? "AND (COALESCE(last_event_at, created_at) < ? OR (COALESCE(last_event_at, created_at) = ? AND session_id < ?))"
		: "";
}

function pageParams(
	subjectId: string,
	query: SessionDirectoryQuery,
	q: string | undefined,
	agentSlugs: string[],
	cursor: Cursor | undefined,
) {
	const params: SQLInputValue[] = [subjectId];
	if (query.agentSlug) params.push(query.agentSlug);
	if (q) params.push(likePattern(q), likePattern(q), ...agentSlugs);
	if (cursor) params.push(cursor.at, cursor.at, cursor.id);
	params.push((query.limit ?? 50) + 1);
	return params;
}

function toSummary(
	row: Omit<SessionSummary, "title" | "status" | "last_event_at"> & {
		title: string | null;
		status: string | null;
		last_event_at: string | null;
	},
): SessionSummary {
	const { title, status, last_event_at, ...rest } = row;
	return {
		...rest,
		...(title ? { title } : {}),
		...(status ? { status } : {}),
		...(last_event_at ? { last_event_at } : {}),
	};
}

/** 本人会话的两级只读目录；仅投影索引摘要，不读取事件或 Provider 配置。 */
export function createSessionDirectoryIndex(db: DatabaseSync) {
	return {
		agents(subjectId: string): string[] {
			const rows = db
				.prepare(`SELECT agent_slug FROM kit_sessions
				WHERE subject_id = ? AND purpose = 'experience' AND agent_slug IS NOT NULL
				AND COALESCE(status, '') <> 'archived'
				GROUP BY agent_slug ORDER BY MAX(COALESCE(last_event_at, created_at)) DESC, agent_slug ASC`)
				.all(subjectId) as { agent_slug: string }[];
			return rows.map((row) => row.agent_slug);
		},
		page(subjectId: string, query: SessionDirectoryQuery = {}): SessionPage {
			const limit = query.limit ?? 50;
			const includeArchived = query.includeArchived !== false;
			const q = query.q?.trim();
			const agentSlugs = q ? (query.agentSlugs ?? []) : [];
			const context = JSON.stringify([subjectId, query.agentSlug ?? null, includeArchived, q ?? null]);
			const cursor = readCursor(query.pageToken, context);
			const rows = db
				.prepare(`SELECT session_id, agent_slug, title, status, created_at, last_event_at
				FROM kit_sessions WHERE subject_id = ? AND purpose = 'experience' AND agent_slug IS NOT NULL
				${query.agentSlug ? "AND agent_slug = ?" : ""}
				${includeArchived ? "" : "AND COALESCE(status, '') <> 'archived'"}
				${searchClause(q, agentSlugs)}
				${cursorClause(cursor)}
				ORDER BY COALESCE(last_event_at, created_at) DESC, session_id DESC LIMIT ?`)
				.all(...pageParams(subjectId, query, q, agentSlugs, cursor)) as unknown as (Omit<
				SessionSummary,
				"title" | "status" | "last_event_at"
			> & {
				title: string | null;
				status: string | null;
				last_event_at: string | null;
			})[];
			const data = rows.slice(0, limit).map(toSummary);
			return {
				data,
				next_page_token: nextCursor(data, rows.length > limit, context),
			};
		},
	};
}
