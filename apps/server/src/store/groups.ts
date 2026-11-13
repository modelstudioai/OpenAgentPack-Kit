import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
	type GroupInput,
	type GroupMembershipQuery,
	type GroupMembersPage,
	type GroupSummary,
	type GroupsPage,
	type GroupsQuery,
	type GroupView,
	KitError,
	type MemberGroupsPage,
	type MemberView,
} from "@openagentpack/kit-sdk/protocol";

type GroupRow = Omit<GroupView, "description"> & { description: string | null };
type MemberRow = Omit<MemberView, "email"> & { email: string | null; is_member: number };
interface Cursor {
	created_at: string;
	id: string;
	context: string;
}
const GROUP_COLUMNS = `g.group_id, g.name, g.description, g.revision, g.created_at, g.updated_at,
 (SELECT COUNT(*) FROM kit_group_members gm WHERE gm.group_id=g.group_id) AS member_count`;
const MEMBER_COLUMNS =
	"m.member_id, m.username, m.display_name, m.email, m.auth_type, m.status, m.created_at, m.updated_at";
const asGroup = ({ description, ...row }: GroupRow): GroupView => ({ ...row, ...(description ? { description } : {}) });
const patternFor = (search: string) => `%${search.replace(/[\\%_]/g, "\\$&")}%`;

function cursorFor(token: string | undefined, context: string): Cursor | undefined {
	if (!token) return undefined;
	try {
		const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
		if (
			value &&
			typeof value === "object" &&
			"context" in value &&
			value.context === context &&
			"id" in value &&
			typeof value.id === "string" &&
			/^(group|member)_[0-9a-f-]{36}$/.test(value.id) &&
			"created_at" in value &&
			typeof value.created_at === "string" &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.created_at)
		) {
			return { id: value.id, created_at: value.created_at, context };
		}
	} catch {
		/* 游标不能回显不可信原文。 */
	}
	throw new KitError("invalid_request", "分页游标无效或与当前查询不匹配，请重新查询");
}

function page<T extends { created_at: string }>(rows: T[], limit: number, context: string, id: (row: T) => string) {
	const data = rows.slice(0, limit);
	const last = data.at(-1);
	return {
		data,
		...(rows.length > limit && last
			? {
					next_page_token: Buffer.from(JSON.stringify({ created_at: last.created_at, id: id(last), context })).toString(
						"base64url",
					),
				}
			: {}),
	};
}

/** 用户组与成员关系的唯一存储；事务同步执行，不包含 Provider 或访问控制。 */
export function createGroupStore(db: DatabaseSync) {
	function transaction<T>(work: () => T): T {
		db.exec("BEGIN IMMEDIATE");
		try {
			const value = work();
			db.exec("COMMIT");
			return value;
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}
	function get(groupId: string): GroupView {
		const row = db.prepare(`SELECT ${GROUP_COLUMNS} FROM kit_groups g WHERE g.group_id=?`).get(groupId) as
			| GroupRow
			| undefined;
		if (!row) throw new KitError("not_found", "用户组不存在");
		return asGroup(row);
	}
	function requireMember(memberId: string) {
		if (!db.prepare("SELECT 1 FROM kit_members WHERE member_id=?").get(memberId))
			throw new KitError("not_found", "成员不存在");
	}
	function bump(groupId: string) {
		db.prepare("UPDATE kit_groups SET revision=revision+1, updated_at=? WHERE group_id=?").run(
			new Date().toISOString(),
			groupId,
		);
	}
	function change(groupId: string, memberId: string, add: boolean): boolean {
		const result = add
			? db
					.prepare("INSERT INTO kit_group_members(group_id,member_id) VALUES (?,?) ON CONFLICT DO NOTHING")
					.run(groupId, memberId)
			: db.prepare("DELETE FROM kit_group_members WHERE group_id=? AND member_id=?").run(groupId, memberId);
		return Boolean(result.changes);
	}
	function changeAndBump(groupId: string, memberId: string, add: boolean) {
		if (change(groupId, memberId, add)) bump(groupId);
	}
	return {
		get,
		create(input: GroupInput): GroupView {
			const id = `group_${randomUUID()}`;
			const now = new Date().toISOString();
			const inserted = db
				.prepare(`INSERT INTO kit_groups(group_id,name,description,created_at,updated_at)
				VALUES (?,?,?,?,?) ON CONFLICT(name) DO NOTHING`)
				.run(id, input.name, input.description ?? null, now, now);
			if (!inserted.changes) throw new KitError("conflict", "用户组名称已存在");
			return get(id);
		},
		update(groupId: string, input: GroupInput): GroupView {
			return transaction(() => {
				const current = get(groupId);
				if (db.prepare("SELECT 1 FROM kit_groups WHERE name=? AND group_id<>?").get(input.name, groupId)) {
					throw new KitError("conflict", "用户组名称已存在");
				}
				const description = input.description ?? current.description;
				if (current.name !== input.name || (current.description ?? "") !== (description ?? "")) {
					db.prepare("UPDATE kit_groups SET name=?, description=? WHERE group_id=?").run(
						input.name,
						description ?? null,
						groupId,
					);
					bump(groupId);
				}
				return get(groupId);
			});
		},
		list(query: GroupsQuery): GroupsPage {
			const search = (query.search ?? "").toLowerCase();
			const context = JSON.stringify(["groups", search]);
			const cursor = cursorFor(query.page_token, context);
			const pattern = patternFor(search);
			const rows = db
				.prepare(`SELECT ${GROUP_COLUMNS} FROM kit_groups g
				WHERE (g.name LIKE ? ESCAPE '\\' OR g.description LIKE ? ESCAPE '\\')
				${cursor ? "AND (g.created_at < ? OR (g.created_at=? AND g.group_id<?))" : ""}
				ORDER BY g.created_at DESC, g.group_id DESC LIMIT ?`)
				.all(
					pattern,
					pattern,
					...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : []),
					query.limit + 1,
				) as unknown as GroupRow[];
			return page(rows.map(asGroup), query.limit, context, (row) => row.group_id);
		},
		memberGroups(memberId: string, query: GroupMembershipQuery): MemberGroupsPage {
			requireMember(memberId);
			const search = (query.search ?? "").toLowerCase();
			const context = JSON.stringify(["member-groups", memberId, query.membership, search]);
			const cursor = cursorFor(query.page_token, context);
			const pattern = patternFor(search);
			const included = "EXISTS(SELECT 1 FROM kit_group_members gm WHERE gm.group_id=g.group_id AND gm.member_id=?)";
			const params: SQLInputValue[] = [memberId, pattern, pattern];
			if (query.membership !== "all") params.push(memberId);
			if (cursor) params.push(cursor.created_at, cursor.created_at, cursor.id);
			params.push(query.limit + 1);
			const rows = db
				.prepare(`SELECT ${GROUP_COLUMNS}, ${included} AS is_member FROM kit_groups g
				WHERE (g.name LIKE ? ESCAPE '\\' OR g.description LIKE ? ESCAPE '\\')
				${query.membership === "all" ? "" : `AND ${query.membership === "excluded" ? "NOT" : ""} ${included}`}
				${cursor ? "AND (g.created_at < ? OR (g.created_at=? AND g.group_id<?))" : ""}
				ORDER BY g.created_at DESC, g.group_id DESC LIMIT ?`)
				.all(...params) as unknown as (GroupRow & { is_member: number })[];
			return page(
				rows.map(({ is_member, ...row }) => ({ ...asGroup(row), is_member: Boolean(is_member) })),
				query.limit,
				context,
				(row) => row.group_id,
			);
		},
		groupMembers(groupId: string, query: GroupMembershipQuery): GroupMembersPage {
			get(groupId);
			const search = (query.search ?? "").toLowerCase();
			const context = JSON.stringify(["group-members", groupId, query.membership, search]);
			const cursor = cursorFor(query.page_token, context);
			const pattern = patternFor(search);
			const included = "EXISTS(SELECT 1 FROM kit_group_members gm WHERE gm.member_id=m.member_id AND gm.group_id=?)";
			const params: SQLInputValue[] = [groupId, pattern, pattern];
			if (query.membership !== "all") params.push(groupId);
			if (cursor) params.push(cursor.created_at, cursor.created_at, cursor.id);
			params.push(query.limit + 1);
			const rows = db
				.prepare(`SELECT ${MEMBER_COLUMNS}, ${included} AS is_member FROM kit_members m
				WHERE (m.username LIKE ? ESCAPE '\\' OR m.display_name LIKE ? ESCAPE '\\')
				${query.membership === "all" ? "" : `AND ${query.membership === "excluded" ? "NOT" : ""} ${included}`}
				${cursor ? "AND (m.created_at < ? OR (m.created_at=? AND m.member_id<?))" : ""}
				ORDER BY m.created_at DESC, m.member_id DESC LIMIT ?`)
				.all(...params) as unknown as MemberRow[];
			return page(
				rows.map(({ email, is_member, ...row }) => ({
					...row,
					...(email ? { email } : {}),
					is_member: Boolean(is_member),
				})),
				query.limit,
				context,
				(row) => row.member_id,
			);
		},
		updateGroupMembers(groupId: string, add: string[], remove: string[]): GroupView {
			return transaction(() => {
				get(groupId);
				for (const id of new Set([...add, ...remove])) requireMember(id);
				let changed = false;
				for (const id of add) changed = change(groupId, id, true) || changed;
				for (const id of remove) changed = change(groupId, id, false) || changed;
				if (changed) bump(groupId);
				return get(groupId);
			});
		},
		updateMemberGroups(memberId: string, add: string[], remove: string[]): void {
			transaction(() => {
				requireMember(memberId);
				for (const id of new Set([...add, ...remove])) get(id);
				for (const id of add) changeAndBump(id, memberId, true);
				for (const id of remove) changeAndBump(id, memberId, false);
			});
		},
		summaries(memberIds: string[]): Map<string, GroupSummary[]> {
			const result = new Map<string, GroupSummary[]>();
			if (!memberIds.length) return result;
			const rows = db
				.prepare(`SELECT gm.member_id, g.group_id, g.name FROM kit_group_members gm
				JOIN kit_groups g ON g.group_id=gm.group_id WHERE gm.member_id IN (${memberIds.map(() => "?").join(",")})
				ORDER BY g.name, g.group_id`)
				.all(...memberIds) as { member_id: string; group_id: string; name: string }[];
			for (const { member_id, ...group } of rows) {
				const groups = result.get(member_id) ?? [];
				groups.push(group);
				result.set(member_id, groups);
			}
			return result;
		},
		delete(groupId: string, revision: number): void {
			transaction(() => {
				if (get(groupId).revision !== revision)
					throw new KitError("conflict", "用户组或成员关系已变化，请重新预览删除影响并确认");
				db.prepare("DELETE FROM kit_group_members WHERE group_id=?").run(groupId);
				db.prepare("DELETE FROM kit_groups WHERE group_id=?").run(groupId);
			});
		},
	};
}
export type GroupStore = ReturnType<typeof createGroupStore>;
