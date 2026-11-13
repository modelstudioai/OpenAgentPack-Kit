import { randomUUID } from "node:crypto";
import type { PublicationReport } from "@openagentpack/kit-sdk/protocol";
import { redactSecrets } from "../config.ts";
import { PublicationError } from "../publication-error.ts";
import type { OperationStore } from "../store/operations.ts";

export interface OperationLogger {
	log(line: string): void;
	progress(value: number, phase?: string): void;
	publication?(report: PublicationReport): void;
}

/** 长任务执行器：状态与日志落库，进度经 SSE 暴露。见 docs/interfaces.md operations。 */
export function createOperationRunner(store: OperationStore) {
	store.recoverIncomplete();
	return {
		async run<T>(input: {
			kind: string;
			subject?: string;
			fn: (logger: OperationLogger) => Promise<T>;
			onCreated?: (operationId: string) => void | Promise<void>;
		}): Promise<string> {
			const operationId = `op_${randomUUID().slice(0, 12)}`;
			store.create({ operationId, kind: input.kind, ...(input.subject ? { subject: input.subject } : {}) });
			try {
				await input.onCreated?.(operationId);
			} catch (error) {
				store.update(operationId, { status: "failed", phase: "prepare", error: "操作准备失败，未执行发布" });
				throw error;
			}
			const logger: OperationLogger = {
				publication: (report) => {
					store.update(operationId, { publication: report });
				},
				log: (line) => store.update(operationId, { logLine: redactSecrets(line) }),
				progress: (value, phase) =>
					store.update(operationId, { progress: Math.max(0, Math.min(1, value)), ...(phase ? { phase } : {}) }),
			};
			void (async () => {
				store.update(operationId, { status: "running", phase: "start", progress: 0.05 });
				try {
					const result = await input.fn(logger);
					store.update(operationId, { status: "succeeded", phase: "done", progress: 1, result });
				} catch (error) {
					store.update(operationId, {
						status: "failed",
						phase: "error",
						error: redactSecrets(error instanceof Error ? error.message : String(error)),
						...(error instanceof PublicationError ? { error_details: error.errorDetails } : {}),
					});
				}
			})();
			return operationId;
		},
	};
}
export type OperationRunner = ReturnType<typeof createOperationRunner>;
