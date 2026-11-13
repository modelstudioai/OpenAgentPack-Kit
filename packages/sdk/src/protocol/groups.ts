import { z } from "zod";
import { MembersQuerySchema, MemberViewSchema } from "./api.ts";

/** 用户组只组织本地成员；不授予管理端角色或 Agent 访问权限。 */
export const GroupSummarySchema = z.object({ group_id: z.string(), name: z.string() });
export type GroupSummary = z.infer<typeof GroupSummarySchema>;
export const GroupViewSchema = GroupSummarySchema.extend({
	description: z.string().optional(),
	member_count: z.number().int().nonnegative(),
	created_at: z.string(),
	updated_at: z.string(),
	revision: z.number().int().nonnegative(),
});
export type GroupView = z.infer<typeof GroupViewSchema>;
export const GroupInputSchema = z.object({
	name: z.string().trim().min(1, "请输入用户组名称").max(64, "用户组名称最多 64 个字符"),
	description: z.string().trim().max(500, "描述最多 500 个字符").optional(),
});
export type GroupInput = z.infer<typeof GroupInputSchema>;
export const GroupsQuerySchema = MembersQuerySchema;
export type GroupsQuery = z.infer<typeof GroupsQuerySchema>;
export const GroupMembershipQuerySchema = GroupsQuerySchema.extend({
	membership: z.enum(["included", "excluded", "all"]).default("included"),
});
export type GroupMembershipQuery = z.infer<typeof GroupMembershipQuerySchema>;
export const GroupMemberViewSchema = MemberViewSchema.extend({ is_member: z.boolean() });
export type GroupMemberView = z.infer<typeof GroupMemberViewSchema>;
export const MemberGroupViewSchema = GroupViewSchema.extend({ is_member: z.boolean() });
export type MemberGroupView = z.infer<typeof MemberGroupViewSchema>;
export const GroupsPageSchema = z.object({
	data: z.array(GroupViewSchema),
	next_page_token: z.string().optional(),
});
export type GroupsPage = z.infer<typeof GroupsPageSchema>;
export const GroupMembersPageSchema = GroupsPageSchema.extend({ data: z.array(GroupMemberViewSchema) });
export type GroupMembersPage = z.infer<typeof GroupMembersPageSchema>;
export const MemberGroupsPageSchema = GroupsPageSchema.extend({ data: z.array(MemberGroupViewSchema) });
export type MemberGroupsPage = z.infer<typeof MemberGroupsPageSchema>;
export const AdminMemberViewSchema = MemberViewSchema.extend({ groups: z.array(GroupSummarySchema) });
export type AdminMemberView = z.infer<typeof AdminMemberViewSchema>;
export const AdminMembersPageSchema = GroupsPageSchema.extend({ data: z.array(AdminMemberViewSchema) });
export type AdminMembersPage = z.infer<typeof AdminMembersPageSchema>;

const ids = z.array(z.string().trim().min(1).max(128)).max(1000).default([]);
export const GroupMembersPatchSchema = z
	.object({ add_member_ids: ids, remove_member_ids: ids })
	.refine((value) => !value.add_member_ids.some((id) => value.remove_member_ids.includes(id)), {
		message: "同一用户不能同时添加和移除",
	});
export type GroupMembersPatch = z.infer<typeof GroupMembersPatchSchema>;
export const MemberGroupsPatchSchema = z
	.object({ add_group_ids: ids, remove_group_ids: ids })
	.refine((value) => !value.add_group_ids.some((id) => value.remove_group_ids.includes(id)), {
		message: "同一用户组不能同时添加和移除",
	});
export type MemberGroupsPatch = z.infer<typeof MemberGroupsPatchSchema>;
