import { randomUUID } from "node:crypto";
import {
	type ApplyRequest,
	type GroupInput,
	GroupInputSchema,
	type GroupMembershipQuery,
	GroupMembershipQuerySchema,
	type GroupMembersPatch,
	GroupMembersPatchSchema,
	type GroupsQuery,
	GroupsQuerySchema,
	KitError,
	type MemberGroupsPatch,
	MemberGroupsPatchSchema,
	type PlanResponse,
} from "@openagentpack/kit-sdk/protocol";
import type { z } from "zod";
import type { AuditLog } from "../store/audit.ts";
import type { GroupStore } from "../store/groups.ts";
import type { ConfirmGate } from "./confirm-gate.ts";

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
	const parsed = schema.safeParse(input);
	if (!parsed.success) throw new KitError("invalid_request", parsed.error.issues[0]?.message ?? "用户组参数无效");
	return parsed.data;
}

export function createGroupService({ store, audit, gate }: { store: GroupStore; audit: AuditLog; gate: ConfirmGate }) {
	return {
		get: store.get,
		summaries: store.summaries,
		list: (query: GroupsQuery) => store.list(validated(GroupsQuerySchema, query)),
		groupMembers: (groupId: string, query: GroupMembershipQuery) =>
			store.groupMembers(groupId, validated(GroupMembershipQuerySchema, query)),
		memberGroups: (memberId: string, query: GroupMembershipQuery) =>
			store.memberGroups(memberId, validated(GroupMembershipQuerySchema, query)),
		create(input: GroupInput, subject: string) {
			const group = store.create(validated(GroupInputSchema, input));
			audit.append({ subject, action: "groups.create", target: group.group_id });
			return group;
		},
		update(groupId: string, input: GroupInput, subject: string) {
			const group = store.update(groupId, validated(GroupInputSchema, input));
			audit.append({ subject, action: "groups.update", target: groupId, detail: { revision: group.revision } });
			return group;
		},
		updateGroupMembers(groupId: string, input: GroupMembersPatch, subject: string) {
			const patch = validated(GroupMembersPatchSchema, input);
			const group = store.updateGroupMembers(groupId, patch.add_member_ids, patch.remove_member_ids);
			audit.append({ subject, action: "groups.members.update", target: groupId, detail: patch });
			return group;
		},
		updateMemberGroups(memberId: string, input: MemberGroupsPatch, subject: string) {
			const patch = validated(MemberGroupsPatchSchema, input);
			store.updateMemberGroups(memberId, patch.add_group_ids, patch.remove_group_ids);
			audit.append({ subject, action: "members.groups.update", target: memberId, detail: patch });
			return { updated: true as const };
		},
		async planDelete(groupId: string, subject: string): Promise<PlanResponse> {
			const group = store.get(groupId);
			// 身份、目标与快照版本由签名共同绑定；随机 nonce 保证每次确认只能消费一次。
			const planId = `group_delete:${groupId}:${group.revision}:${randomUUID()}`;
			const issued = await gate.issue({ planId, action: `groups.delete:${groupId}`, subject });
			return {
				plan_id: planId,
				confirm_token: issued.confirmToken,
				expires_at: issued.expiresAt,
				destructive: true,
				diff: [
					{
						resource: `group:${groupId}`,
						action: "delete",
						destructive: true,
						summary: `删除用户组「${group.name}」，移除 ${group.member_count} 位成员的组关联；用户账号、会话与历史数据保留。`,
					},
				],
			};
		},
		async remove(groupId: string, input: Partial<ApplyRequest>, subject: string) {
			const planId = input.plan_id ?? "";
			await gate.consume({ planId, action: `groups.delete:${groupId}`, subject, token: input.confirm_token ?? "" });
			const parts = planId.split(":");
			const revision = Number(parts[2]);
			if (
				parts.length !== 4 ||
				parts[0] !== "group_delete" ||
				parts[1] !== groupId ||
				!Number.isSafeInteger(revision) ||
				revision < 1
			) {
				throw new KitError("confirmation_required", "删除确认计划无效");
			}
			// gate.consume 会 await：数据库事务内再次检查，防止期间成员变化或另一管理员修改。
			store.delete(groupId, revision);
			audit.append({ subject, action: "groups.delete", target: groupId });
			return { deleted: true as const };
		},
	};
}
export type GroupService = ReturnType<typeof createGroupService>;
