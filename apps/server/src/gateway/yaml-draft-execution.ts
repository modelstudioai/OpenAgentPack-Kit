import { KitError } from "@openagentpack/kit-sdk/protocol";
import { type ResourceExecutionResult, ResourceRuntimeError } from "@openagentpack/sdk";
import { PublicationError } from "../publication-error.ts";
import { publicationErrorDetails, publicationReport, sdkPublicationFailure } from "./sdk-publication.ts";
import type { ProjectFeedback } from "./types.ts";

export interface PublicationAttempt {
	enteredExecutor: boolean;
	execution?: ResourceExecutionResult;
	failure?: unknown;
}

function normalizeFailure(attempt: PublicationAttempt, error: unknown, outerSaveFailed: boolean) {
	if (error instanceof PublicationError) return error;
	if (!attempt.enteredExecutor && error instanceof KitError)
		return new PublicationError(
			{ code: "publication.prepare_failed", phase: "prepare", retryable: false, mutation_started: false },
			error.message,
			error.code,
		);
	if (outerSaveFailed)
		return new PublicationError(
			{
				code: "publication.state_persist_failed",
				phase: "persist_state",
				retryable: false,
				mutation_started: attempt.execution?.mutationStarted ?? true,
			},
			"发布状态保存失败，已保留资源结果，请读取发布结果",
		);
	const mutationStarted =
		attempt.execution?.mutationStarted ??
		(attempt.failure instanceof ResourceRuntimeError ? attempt.failure.info.mutationStarted : attempt.enteredExecutor);
	return sdkPublicationFailure(attempt.failure ?? error, mutationStarted);
}

function assertCompleted(result: ResourceExecutionResult | undefined) {
	if (!result) throw sdkPublicationFailure(undefined, true);
	if (result.outcome === "succeeded") return;
	const info = result.results.find((entry) => entry.errorInfo)?.errorInfo;
	const details = info
		? publicationErrorDetails(info)
		: { code: "publication.incomplete", phase: "execute" as const, retryable: false, mutation_started: true };
	throw new PublicationError(
		{ ...details, mutation_started: result.mutationStarted ?? true },
		result.mutationStarted === false
			? "发布准备失败，尚未写入远端，请重新准备发布"
			: "部分资源发布未完成，已保留批次，请读取发布结果",
	);
}

/** 等待 StateBackend 边界结束后保存终态事实，再允许业务层生成完整成功证明。 */
export async function withPublicationResult<T>(
	work: (attempt: PublicationAttempt) => Promise<T>,
	feedback?: ProjectFeedback,
): Promise<T> {
	const attempt: PublicationAttempt = { enteredExecutor: false };
	let value: T;
	try {
		value = await work(attempt);
	} catch (error) {
		const outerSaveFailed = Boolean(attempt.execution) && error !== attempt.failure;
		if (attempt.execution)
			feedback?.publication?.(
				publicationReport(outerSaveFailed ? { ...attempt.execution, outcome: "unknown" } : attempt.execution),
			);
		throw normalizeFailure(attempt, error, outerSaveFailed);
	}
	if (attempt.execution) feedback?.publication?.(publicationReport(attempt.execution));
	assertCompleted(attempt.execution);
	return value;
}
