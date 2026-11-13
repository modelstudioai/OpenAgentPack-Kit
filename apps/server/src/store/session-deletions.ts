import type { DatabaseSync } from "node:sqlite";

export type DeletionStage = "preparing" | "captured" | "deleting" | "uncertain" | "deleted";
export interface SessionDeletion {
	session_id: string;
	subject_id: string;
	stage: DeletionStage;
	updated_at: string;
}

/** 仅保存删除阶段；重启后结果未确认的会话仍不允许产生新用量。 */
export function createSessionDeletionStore(db: DatabaseSync) {
	return {
		get(sessionId: string) {
			return db.prepare("SELECT * FROM kit_session_deletions WHERE session_id = ?").get(sessionId) as
				| SessionDeletion
				| undefined;
		},
		set(sessionId: string, subjectId: string, stage: DeletionStage) {
			db.prepare(`INSERT INTO kit_session_deletions (session_id, subject_id, stage, updated_at)
				VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET stage=excluded.stage, updated_at=excluded.updated_at`).run(
				sessionId,
				subjectId,
				stage,
				new Date().toISOString(),
			);
		},
		clear(sessionId: string) {
			db.prepare("DELETE FROM kit_session_deletions WHERE session_id = ? AND stage != 'deleted'").run(sessionId);
		},
	};
}
export type SessionDeletionStore = ReturnType<typeof createSessionDeletionStore>;
