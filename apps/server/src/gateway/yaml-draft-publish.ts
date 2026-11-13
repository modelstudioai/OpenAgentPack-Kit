import { type DeclarationType, KitError } from "@openagentpack/kit-sdk/protocol";
import {
	executePlannedProject,
	type ProjectRuntimeContext,
	planProjectContext,
	type ResourcePlanResult,
	ResourceRuntimeError,
	type ResourceState,
	readProjectRuntime,
	writeProjectRuntime,
} from "@openagentpack/sdk";
import { PublicationError } from "../publication-error.ts";
import { executeMockYamlDraft, type MockDraftPublisher, mockPublicationResult } from "./mock-yaml-draft.ts";
import { sdkPublicationFailure } from "./sdk-publication.ts";
import type { ProjectExecutionPlan, ProjectFeedback, ResourceDraftPublishedBinding } from "./types.ts";
import { draftAssetsHash } from "./yaml-draft-assets.ts";
import { digest, sections, type YamlDraftDocument } from "./yaml-draft-document.ts";
import { type PublicationAttempt, withPublicationResult } from "./yaml-draft-execution.ts";

export function draftReferences(doc: YamlDraftDocument) {
	const { raw } = doc.snapshot();
	return (Object.keys(sections) as DeclarationType[]).flatMap((type) =>
		Object.keys(raw[sections[type]] ?? {}).map((id) => ({ type, id })),
	);
}

export function createYamlDraftPublisher(doc: YamlDraftDocument, publishMock?: MockDraftPublisher) {
	const settings = () => ({
		mode: "create-only" as const,
		resultDetail: "structured" as const,
		refresh: !publishMock,
		quiet: true,
		scope: {
			roots: draftReferences(doc).map(({ type, id }) => ({ provider: "bailian", type, name: id })),
			includeDependencies: true,
		},
	});
	const logFeedback = (feedback?: ProjectFeedback) =>
		feedback ? (event: { type: string }) => feedback.log(event.type) : undefined;
	async function bindings(required: boolean, references = draftReferences(doc)) {
		// 先检查整个请求的声明，再读取绑定；缺失声明不能被其他项的未发布状态掩盖。
		for (const { type, id } of references) doc.declaration(type, id);
		const runtime = await doc.runtime();
		return readProjectRuntime(runtime, (context) =>
			references.flatMap((reference) => {
				const state = context.state.findResource({ provider: "bailian", type: reference.type, name: reference.id });
				return resourceBinding(reference, state, required);
			}),
		);
	}
	async function snapshot(planned: ResourcePlanResult): Promise<ProjectExecutionPlan> {
		const current = doc.snapshot();
		if (planned.refreshResult?.errors.length || planned.plan.diagnostics.some((entry) => entry.severity === "error"))
			throw new PublicationError(
				{ code: "publication.plan_invalid", phase: "plan", retryable: false, mutation_started: false },
				"无法确认资源配置和远端状态，请重新准备发布",
			);
		if (!planned.fingerprint) throw new KitError("provider_error", "SDK 未返回发布计划指纹");
		const assetHash = await draftAssetsHash(doc);
		const destructive = new Set(
			planned.destructiveActions.map((entry) => `${entry.address.type}:${entry.address.name}`),
		);
		return {
			project_revision: current.revision,
			yaml_hash: digest(current.yaml),
			fingerprint: digest([current.revision, digest(current.yaml), assetHash, planned.fingerprint]),
			diff: planned.plan.actions.map((entry) => ({
				resource: `${entry.address.type}:${entry.address.name}`,
				action:
					entry.action === "no-op"
						? "noop"
						: entry.action === "create"
							? "create"
							: entry.action === "delete"
								? "delete"
								: "update",
				destructive: destructive.has(`${entry.address.type}:${entry.address.name}`),
				summary: entry.reason,
			})),
		};
	}
	async function plan() {
		try {
			const runtime = await doc.runtime(true);
			return await readProjectRuntime(runtime, async (context) => {
				if (draftReferences(doc).length) return snapshot(await planProjectContext(context, settings()));
				// SDK create-only 不接受空 scope。仅当声明和 state 都为空时生成只读空计划；
				// 不刷新远端，也不能将残留 state 解释为待删除资源。
				if (context.state.listResources().length)
					throw new KitError("conflict", "空批次仍有发布状态，请先核对发布结果");
				return snapshot(await planProjectContext(context, { resultDetail: "structured", refresh: false, quiet: true }));
			});
		} catch (error) {
			if (error instanceof KitError) throw error;
			throw sdkPublicationFailure(error, false, "plan");
		}
	}
	async function executeInContext(
		context: ProjectRuntimeContext,
		expected: ProjectExecutionPlan,
		attempt: PublicationAttempt,
		feedback?: ProjectFeedback,
	) {
		if (!draftReferences(doc).length) throw new KitError("invalid_request", "此批次没有需要发布的资源");
		const planned = await planProjectContext(context, settings());
		const actual = await snapshot(planned);
		if (
			actual.project_revision !== expected.project_revision ||
			actual.yaml_hash !== expected.yaml_hash ||
			actual.fingerprint !== expected.fingerprint
		)
			throw new KitError("conflict", "发布前配置、上传内容或计划已变化，请重新预览");
		attempt.enteredExecutor = true;
		if (publishMock) {
			await executeMockYamlDraft(doc, context, publishMock, draftReferences(doc));
			attempt.execution = mockPublicationResult(planned);
		} else {
			try {
				attempt.execution = await executePlannedProject(planned, {
					policy: "force",
					resultDetail: "structured",
					onFeedback: logFeedback(feedback),
				});
			} catch (error) {
				if (error instanceof ResourceRuntimeError) attempt.execution = error.execution;
				throw error;
			}
		}
		return { revision: actual.project_revision };
	}
	async function execute(expected: ProjectExecutionPlan, feedback?: ProjectFeedback) {
		return withPublicationResult(async (attempt) => {
			const runtime = await doc.runtime(true);
			return writeProjectRuntime(runtime, async (context) => {
				try {
					return await executeInContext(context, expected, attempt, feedback);
				} catch (error) {
					attempt.failure = error;
					throw error;
				}
			});
		}, feedback);
	}
	return { plan, execute, bindings };
}

function resourceBinding(
	reference: { type: DeclarationType; id: string },
	state: ResourceState | undefined,
	required: boolean,
): ResourceDraftPublishedBinding[] {
	if (!state?.remote_id) {
		if (required) throw new KitError("conflict", "发布结果缺少资源绑定，已保留批次");
		return [];
	}
	if (!/^[\w-]+$/.test(state.remote_id)) throw new KitError("provider_error", "发布返回的资源身份无效");
	const version = Number.isSafeInteger(state.version) && state.version! > 0 ? state.version : undefined;
	if (reference.type === "agent" && !version) {
		if (required) throw new KitError("conflict", "已发布智能体缺少具体版本，已保留批次");
		return [];
	}
	if (reference.type === "skill")
		return [
			{ ...reference, type: "skill", remote_id: state.remote_id, ...(version ? { version: String(version) } : {}) },
		];
	return [{ ...reference, type: reference.type, remote_id: state.remote_id, ...(version ? { version } : {}) }];
}
