import { randomInt, randomUUID } from "node:crypto";
import {
	type CreateMemberRequest,
	CreateMemberRequestSchema,
	type CreateMemberResponse,
	KitError,
	type MembersQuery,
	MembersQuerySchema,
} from "@openagentpack/kit-sdk/protocol";
import type { AuditLog } from "../store/audit.ts";
import type { MemberStore } from "../store/members.ts";
import { hashPassword } from "./passwords.ts";

const PASSWORD_CLASSES = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*_-+=?"];
const PASSWORD_ALPHABET = PASSWORD_CLASSES.join("");

function generatePassword(username: string): string {
	for (;;) {
		const chars = PASSWORD_CLASSES.map((alphabet) => alphabet[randomInt(alphabet.length)] as string);
		while (chars.length < 20) chars.push(PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)] as string);
		for (let i = chars.length - 1; i > 0; i--) {
			const j = randomInt(i + 1);
			[chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
		}
		const password = chars.join("");
		if (!password.toLowerCase().includes(username)) return password;
	}
}

export function createMemberService({ store, audit }: { store: MemberStore; audit: AuditLog }) {
	return {
		get(memberId: string) {
			const member = store.findById(memberId);
			if (!member) throw new KitError("not_found", "成员不存在");
			return member;
		},
		list(input: MembersQuery) {
			const parsed = MembersQuerySchema.safeParse(input);
			if (!parsed.success) throw new KitError("invalid_request", "成员查询参数无效");
			return store.list(parsed.data);
		},
		async create(input: CreateMemberRequest, subject: string): Promise<CreateMemberResponse["data"]> {
			// 服务入口也校验，避免非 HTTP 调用绕过密码规则；异常不能携带原始输入。
			const parsed = CreateMemberRequestSchema.safeParse(input);
			if (!parsed.success) throw new KitError("invalid_request", parsed.error.issues[0]?.message ?? "成员参数无效");
			const value = parsed.data;
			const password = value.password_mode === "auto" ? generatePassword(value.username) : value.password;
			const passwordHash = await hashPassword(password);
			const now = new Date().toISOString();
			const member = store.create(
				{
					member_id: `member_${randomUUID()}`,
					username: value.username,
					display_name: value.display_name,
					...(value.email ? { email: value.email } : {}),
					auth_type: "local",
					status: "active",
					created_at: now,
					updated_at: now,
				},
				passwordHash,
			);
			audit.append({ subject, action: "members.create", target: member.member_id });
			return { member, ...(value.password_mode === "auto" ? { initial_password: password } : {}) };
		},
	};
}

export type MemberService = ReturnType<typeof createMemberService>;
