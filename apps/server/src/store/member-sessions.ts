import type { DatabaseSync } from "node:sqlite";

export interface MemberSessionRecord {
	token_hash: string;
	member_id: string;
	created_at: string;
	expires_at: string;
}

/** 只存登录凭据的 SHA-256 摘要；随机 token 原文只返回给登录者。 */
export function createMemberSessionStore(db: DatabaseSync) {
	return {
		create(session: MemberSessionRecord) {
			db.prepare("DELETE FROM kit_member_sessions WHERE expires_at <= ?").run(session.created_at);
			db.prepare(
				"INSERT INTO kit_member_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
			).run(session.token_hash, session.member_id, session.created_at, session.expires_at);
		},
		find(tokenHash: string): MemberSessionRecord | null {
			return (
				(db.prepare("SELECT * FROM kit_member_sessions WHERE token_hash = ?").get(tokenHash) as unknown as
					| MemberSessionRecord
					| undefined) ?? null
			);
		},
		revoke(tokenHash: string): void {
			db.prepare("DELETE FROM kit_member_sessions WHERE token_hash = ?").run(tokenHash);
		},
	};
}

export type MemberSessionStore = ReturnType<typeof createMemberSessionStore>;
