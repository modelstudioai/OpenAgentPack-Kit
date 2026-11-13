import type { DatabaseSync } from "node:sqlite";
import { KitError, type ProjectResourceBinding, type ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import type { ResourceDraftPublishedBinding } from "../resource-draft-types.ts";

export interface ResourceDraftRecord {
	draft_id: string;
	owner: string;
	cleanup_key_hash: string | null;
	status: ResourceDraftView["status"];
	phase: "editable" | "executing" | "uncertain" | "succeeded";
	resources_json: string;
	cleanup_pending: number;
	operation_id: string | null;
	expected_revision: string | null;
	created_at: string;
	updated_at: string;
}

export function resourceDraftView(row: ResourceDraftRecord): ResourceDraftView {
	return {
		draft_id: row.draft_id,
		project_name: row.draft_id,
		status: row.status,
		resources: (JSON.parse(row.resources_json) as ResourceDraftPublishedBinding[]).filter(
			(resource): resource is ProjectResourceBinding => resource.type !== "skill",
		),
		cleanup_pending: Boolean(row.cleanup_pending),
		recovery_action:
			row.status === "published"
				? row.cleanup_pending
					? "finalize"
					: "none"
				: row.phase === "editable"
					? "replan"
					: "read_result",
		...(row.operation_id ? { operation_id: row.operation_id } : {}),
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export function createResourceDraftStore(db: DatabaseSync) {
	return {
		get(id: string): ResourceDraftRecord | null {
			return (
				(db.prepare("SELECT * FROM kit_resource_drafts WHERE draft_id=?").get(id) as unknown as ResourceDraftRecord) ??
				null
			);
		},
		active(owner: string): ResourceDraftRecord | null {
			return (
				(db
					.prepare("SELECT * FROM kit_resource_drafts WHERE owner=? AND (status!='published' OR cleanup_pending=1)")
					.get(owner) as unknown as ResourceDraftRecord) ?? null
			);
		},
		create(id: string, owner: string, cleanupKeyHash?: string) {
			const now = new Date().toISOString();
			db.prepare(
				"INSERT INTO kit_resource_drafts (draft_id,owner,cleanup_key_hash,status,phase,created_at,updated_at,engine) VALUES (?,?,?,'draft','editable',?,?,'yaml')",
			).run(id, owner, cleanupKeyHash ?? null, now, now);
			return this.get(id)!;
		},
		operation(id: string, operationId: string) {
			db.prepare("UPDATE kit_resource_drafts SET operation_id=?,updated_at=? WHERE draft_id=?").run(
				operationId,
				new Date().toISOString(),
				id,
			);
		},
		document(id: string) {
			return db.prepare("SELECT * FROM kit_resource_draft_documents WHERE draft_id=?").get(id) as
				| {
						draft_id: string;
						revision: number;
						yaml: string;
						assets_json: string;
						sdk_state_json: string;
						proof_json: string | null;
				  }
				| undefined;
		},
		initializeDocument(id: string, yaml: string) {
			db.prepare("INSERT OR IGNORE INTO kit_resource_draft_documents (draft_id,yaml) VALUES (?,?)").run(id, yaml);
		},
		writeDocument(id: string, expected: string, yaml: string, assets?: string) {
			const result = db
				.prepare(
					"UPDATE kit_resource_draft_documents SET yaml=?,assets_json=COALESCE(?,assets_json),revision=revision+1 WHERE draft_id=? AND CAST(revision AS TEXT)=? AND EXISTS (SELECT 1 FROM kit_resource_drafts WHERE draft_id=? AND phase='editable' AND status!='published')",
				)
				.run(yaml, assets ?? null, id, expected, id);
			if (!result.changes) throw new KitError("conflict", "批次配置已变化，请重新加载");
			return String(this.document(id)!.revision);
		},
		writeState(id: string, state: string) {
			const result = db
				.prepare("UPDATE kit_resource_draft_documents SET sdk_state_json=? WHERE draft_id=?")
				.run(state, id);
			if (!result.changes) throw new KitError("conflict", "发布批次已关闭");
		},
		writeProof(id: string, proof: string) {
			const result = db.prepare("UPDATE kit_resource_draft_documents SET proof_json=? WHERE draft_id=?").run(proof, id);
			if (!result.changes) throw new KitError("conflict", "发布批次已关闭");
		},
		clearDocument(id: string) {
			db.prepare("DELETE FROM kit_resource_draft_documents WHERE draft_id=?").run(id);
		},
		begin(id: string, revision: string) {
			const result = db
				.prepare(
					"UPDATE kit_resource_drafts SET status='publishing',phase='executing',expected_revision=?,updated_at=? WHERE draft_id=? AND phase='editable' AND status!='published'",
				)
				.run(revision, new Date().toISOString(), id);
			if (!result.changes) throw new KitError("conflict", "此发布批次已完成或结果待核对，不能再次发布");
		},
		fail(id: string, retryable: boolean) {
			db.prepare(
				"UPDATE kit_resource_drafts SET status='failed',phase=?,updated_at=? WHERE draft_id=? AND status!='published'",
			).run(retryable ? "editable" : "uncertain", new Date().toISOString(), id);
		},
		receipt(id: string, resources: ResourceDraftPublishedBinding[]) {
			db.prepare(
				"UPDATE kit_resource_drafts SET status='published',phase='succeeded',resources_json=?,cleanup_pending=1,updated_at=? WHERE draft_id=?",
			).run(JSON.stringify(resources), new Date().toISOString(), id);
		},
		cleaned(id: string) {
			db.prepare(
				"UPDATE kit_resource_drafts SET cleanup_pending=0,updated_at=? WHERE draft_id=? AND status='published'",
			).run(new Date().toISOString(), id);
		},
		discard(id: string, owner: string) {
			const result = db
				.prepare(
					"DELETE FROM kit_resource_drafts WHERE draft_id=? AND owner=? AND phase='editable' AND status!='published'",
				)
				.run(id, owner);
			if (!result.changes) throw new KitError("conflict", "批次状态已变化，不能丢弃");
		},
		recover() {
			db.prepare(
				"UPDATE kit_resource_drafts SET status='failed',phase='uncertain',updated_at=? WHERE status='publishing'",
			).run(new Date().toISOString());
		},
	};
}
export type ResourceDraftStore = ReturnType<typeof createResourceDraftStore>;
