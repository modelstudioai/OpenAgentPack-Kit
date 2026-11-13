import type { PublicationErrorDetails, PublicationReport } from "@openagentpack/kit-sdk/protocol";
import {
	type ResourceActionResult,
	type ResourceErrorInfo,
	type ResourceExecutionResult,
	ResourceRuntimeError,
} from "@openagentpack/sdk";
import { PublicationError } from "../publication-error.ts";

const types = new Set(["agent", "environment", "skill", "file", "memory_store", "vault"]);
const identity = (value: string) => /^[\w-]{1,200}$/.test(value);

function status(entry: ResourceActionResult): PublicationReport["resources"][number]["status"] {
	if (entry.status === "success") return "succeeded";
	if (entry.status === "skipped") return "skipped";
	return entry.errorInfo?.mutationStarted === false ? "failed" : "unknown";
}

function knownIdentity(resource: ResourceActionResult["resource"]) {
	if (!resource) return {};
	return {
		...(identity(resource.remoteId) ? { remote_id: resource.remoteId } : {}),
		...(Number.isSafeInteger(resource.version) && resource.version! > 0 ? { version: resource.version } : {}),
	};
}

/** 只投影白名单事实；SDK 原异常、error 字符串、Plan、声明和快照不进入 Operation。 */
export function publicationErrorDetails(info: ResourceErrorInfo): PublicationErrorDetails {
	return {
		code: /^[a-z][a-z0-9_.-]{0,100}$/.test(info.code) ? info.code : "publication.failed",
		phase: info.phase,
		retryable: info.retryable,
		mutation_started: info.mutationStarted,
		...(info.httpStatus === undefined ? {} : { http_status: info.httpStatus }),
	};
}

export function publicationReport(result: ResourceExecutionResult): PublicationReport {
	return {
		outcome: result.outcome ?? "unknown",
		mutation_started: result.mutationStarted ?? true,
		resources: result.results.flatMap((entry) => {
			if (!types.has(entry.action.address.type) || !identity(entry.action.address.name)) return [];
			return [
				{
					type: entry.action.address.type as PublicationReport["resources"][number]["type"],
					id: entry.action.address.name,
					status: status(entry),
					...knownIdentity(entry.resource),
					...(entry.errorInfo ? { error_details: publicationErrorDetails(entry.errorInfo) } : {}),
				},
			];
		}),
	};
}

export function sdkPublicationFailure(
	error: unknown,
	mutationStarted: boolean,
	phase: "plan" | "prepare" | "persist_state" = "prepare",
) {
	if (error instanceof PublicationError) return error;
	const details =
		error instanceof ResourceRuntimeError
			? publicationErrorDetails(error.info)
			: {
					code: `publication.${phase}_failed`,
					phase,
					retryable: false,
					mutation_started: mutationStarted,
				};
	return new PublicationError(
		{ ...details, mutation_started: mutationStarted || details.mutation_started },
		mutationStarted
			? "资源发布未完成或结果待核对，已保留批次，请读取发布结果"
			: "发布准备失败，尚未写入远端，请重新准备发布",
	);
}
