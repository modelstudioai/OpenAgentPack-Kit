import type { DatabaseSync } from "node:sqlite";
import {
	type OperationView,
	PublicationErrorDetailsSchema,
	PublicationReportSchema,
} from "@openagentpack/kit-sdk/protocol";

interface Row {
	operation_id: string;
	kind: string;
	subject: string | null;
	status: string;
	phase: string | null;
	progress: number;
	log: string;
	result: string | null;
	error: string | null;
	publication_json: string | null;
	error_details_json: string | null;
	created_at: string;
	updated_at: string;
}

const storedJson = (value: unknown, current: unknown) => {
	const next = value === undefined ? current : value;
	return next === undefined ? null : JSON.stringify(next);
};

function toView(row: Row): OperationView {
	return {
		operation_id: row.operation_id,
		kind: row.kind,
		status: row.status as OperationView["status"],
		...(row.phase ? { phase: row.phase } : {}),
		progress: row.progress,
		log: JSON.parse(row.log) as string[],
		...(row.result ? { result: JSON.parse(row.result) } : {}),
		...(row.error ? { error: row.error } : {}),
		...(row.publication_json ? { publication: PublicationReportSchema.parse(JSON.parse(row.publication_json)) } : {}),
		...(row.error_details_json
			? { error_details: PublicationErrorDetailsSchema.parse(JSON.parse(row.error_details_json)) }
			: {}),
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export function createOperationStore(db: DatabaseSync) {
	const listeners = new Map<string, Set<(view: OperationView) => void>>();
	const notify = (view: OperationView) => {
		for (const listener of listeners.get(view.operation_id) ?? []) listener(view);
	};
	return {
		recoverIncomplete() {
			const now = new Date().toISOString();
			db.prepare(
				"UPDATE kit_operations SET error_details_json=? WHERE kind='resourceDraft.publish' AND status IN ('pending','running')",
			).run(
				JSON.stringify({
					code: "publication.interrupted",
					phase: "interrupted",
					retryable: false,
					mutation_started: true,
				}),
			);
			db.prepare(
				"UPDATE kit_operations SET status='failed', phase='interrupted', error=?, updated_at=? WHERE status IN ('pending','running')",
			).run("服务已重启，操作结果待核对；请检查远端状态后重新计划，不会自动重试", now);
		},
		create(input: { operationId: string; kind: string; subject?: string }) {
			const now = new Date().toISOString();
			db.prepare(
				`INSERT INTO kit_operations (operation_id, kind, subject, status, phase, progress, log, created_at, updated_at)
				 VALUES (?,?,?,?,?,?,?,?,?)`,
			).run(input.operationId, input.kind, input.subject ?? null, "pending", null, 0, "[]", now, now);
			return this.get(input.operationId) as OperationView;
		},
		get(operationId: string): OperationView | null {
			const row = db.prepare("SELECT * FROM kit_operations WHERE operation_id = ?").get(operationId) as unknown as
				| Row
				| undefined;
			return row ? toView(row) : null;
		},
		owns(operationId: string, subject: string): boolean {
			return Boolean(
				db.prepare("SELECT 1 FROM kit_operations WHERE operation_id=? AND subject=?").get(operationId, subject),
			);
		},
		update(
			operationId: string,
			patch: {
				status?: OperationView["status"];
				phase?: string;
				progress?: number;
				result?: unknown;
				error?: string;
				publication?: OperationView["publication"];
				error_details?: OperationView["error_details"];
				logLine?: string;
			},
		) {
			const current = this.get(operationId);
			if (!current) return null;
			const log = patch.logLine ? [...current.log, patch.logLine] : current.log;
			db.prepare(
				`UPDATE kit_operations SET status=?, phase=?, progress=?, log=?, result=?, error=?, publication_json=?, error_details_json=?, updated_at=? WHERE operation_id=?`,
			).run(
				patch.status ?? current.status,
				patch.phase ?? current.phase ?? null,
				patch.progress ?? current.progress,
				JSON.stringify(log),
				storedJson(patch.result, current.result),
				patch.error ?? current.error ?? null,
				storedJson(patch.publication && PublicationReportSchema.parse(patch.publication), current.publication),
				storedJson(
					patch.error_details && PublicationErrorDetailsSchema.parse(patch.error_details),
					current.error_details,
				),
				new Date().toISOString(),
				operationId,
			);
			const view = this.get(operationId) as OperationView;
			notify(view);
			return view;
		},
		list(options: { sessionId?: string; limit?: number } = {}) {
			const limit = options.limit ?? 50;
			const rows = db
				.prepare("SELECT * FROM kit_operations ORDER BY created_at DESC LIMIT ?")
				.all(limit) as unknown as Row[];
			return rows.map(toView);
		},
		subscribe(operationId: string, listener: (view: OperationView) => void): () => void {
			const set = listeners.get(operationId) ?? new Set();
			set.add(listener);
			listeners.set(operationId, set);
			return () => set.delete(listener);
		},
	};
}
export type OperationStore = ReturnType<typeof createOperationStore>;
