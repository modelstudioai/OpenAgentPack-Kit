import type { DatabaseSync } from "node:sqlite";
import { KitError, type MembersPage, type MembersQuery, type MemberView } from "@openagentpack/kit-sdk/protocol";

type MemberRow = Omit<MemberView, "email"> & { email: string | null };
interface Cursor {
	created_at: string;
	member_id: string;
	search: string;
}

const VIEW_COLUMNS = "member_id, username, display_name, email, auth_type, status, created_at, updated_at";

function toView(row: MemberRow): MemberView {
	const { email, ...member } = row;
	return { ...member, ...(email ? { email } : {}) };
}

function readCursor(token: string | undefined, search: string): Cursor | undefined {
	if (!token) return undefined;
	try {
		const cursor: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
		if (
			cursor &&
			typeof cursor === "object" &&
			"created_at" in cursor &&
			typeof cursor.created_at === "string" &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor.created_at) &&
			"member_id" in cursor &&
			typeof cursor.member_id === "string" &&
			/^member_[0-9a-f-]{36}$/.test(cursor.member_id) &&
			"search" in cursor &&
			cursor.search === search
		) {
			return { created_at: cursor.created_at, member_id: cursor.member_id, search };
		}
	} catch {
		// 不回显游标原文；它可能来自不可信输入。
	}
	throw new KitError("invalid_request", "成员分页游标无效或与搜索条件不匹配，请重新查询");
}

/** 成员目录与本地密码派生值；所有查询显式选择展示列，密码字段不进入视图。 */
export function createMemberStore(db: DatabaseSync) {
	return {
		findById(memberId: string): MemberView | null {
			const row = db.prepare(`SELECT ${VIEW_COLUMNS} FROM kit_members WHERE member_id = ?`).get(memberId) as
				| MemberRow
				| undefined;
			return row ? toView(row) : null;
		},
		/** 仅供服务端密码验证使用；此返回值不可用于 API 或审计。 */
		findCredentials(username: string): { member: MemberView; passwordHash: string } | null {
			const row = db
				.prepare(`SELECT ${VIEW_COLUMNS}, password_hash FROM kit_members WHERE username = ?`)
				.get(username) as (MemberRow & { password_hash: string }) | undefined;
			if (!row) return null;
			const { password_hash: passwordHash, ...view } = row;
			return { member: toView(view), passwordHash };
		},
		create(member: MemberView, passwordHash: string): MemberView {
			const inserted = db
				.prepare(
					`INSERT INTO kit_members (${VIEW_COLUMNS}, password_hash)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING`,
				)
				.run(
					member.member_id,
					member.username,
					member.display_name,
					member.email ?? null,
					member.auth_type,
					member.status,
					member.created_at,
					member.updated_at,
					passwordHash,
				);
			if (!inserted.changes) throw new KitError("conflict", "用户名已存在，请使用其他用户名");
			return member;
		},
		list(options: MembersQuery): MembersPage {
			const search = (options.search ?? "").toLowerCase();
			const cursor = readCursor(options.page_token, search);
			// LIKE 的通配符按字面搜索，避免用户名中的下划线匹配其他成员。
			const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
			const rows = db
				.prepare(
					`SELECT ${VIEW_COLUMNS} FROM kit_members
					 WHERE (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
					 ${cursor ? "AND (created_at < ? OR (created_at = ? AND member_id < ?))" : ""}
					 ORDER BY created_at DESC, member_id DESC LIMIT ?`,
				)
				.all(
					pattern,
					pattern,
					...(cursor ? [cursor.created_at, cursor.created_at, cursor.member_id] : []),
					options.limit + 1,
				) as unknown as MemberRow[];
			const data = rows.slice(0, options.limit).map(toView);
			const last = data.at(-1);
			return {
				data,
				...(rows.length > options.limit && last
					? {
							next_page_token: Buffer.from(
								JSON.stringify({ created_at: last.created_at, member_id: last.member_id, search }),
							).toString("base64url"),
						}
					: {}),
			};
		},
	};
}

export type MemberStore = ReturnType<typeof createMemberStore>;
