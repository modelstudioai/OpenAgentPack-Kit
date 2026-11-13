import { KitError, type OperationView, type ProjectPlan } from "@openagentpack/kit-sdk/protocol";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminOperation } from "../../lib/admin/use-admin-operation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { pendingPublishResources, publishResourceNames } from "./template-publish-resources.ts";
import { type TemplateResourceDraft, useTemplateResourceDraft } from "./template-resource-draft.tsx";

const PROGRESS = {
	loading: "正在读取资源草稿…",
	validate: "正在校验新建资源…",
	plan: "正在生成发布计划…",
	submitting: "正在提交发布…",
	publishing: "正在发布新建资源…",
	finalizing: "正在确认发布结果并清理临时文件…",
} as const;
type Phase = "idle" | "review" | keyof typeof PROGRESS;
interface Review {
	name: string;
	plan: ProjectPlan;
	resourceNames: Record<string, string>;
	verifyOnly?: boolean;
}
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const recoveryFor = (draft: TemplateResourceDraft) => {
	if (!draft.recovery_action || draft.recovery_action === "replan") return null;
	return draft.recovery_action === "finalize" ? "finalize" : "result";
};

/** 只发布本轮隔离草稿；远端选择不触发 Build，成功后的恢复只读取凭证或重试清理。 */
export function useTemplatePublish({ onPublished }: { onPublished: (projectName?: string) => void }) {
	const client = useMemo(getAdminClient, []);
	const drafts = useTemplateResourceDraft();
	const completed = useRef(onPublished);
	useLayoutEffect(() => {
		completed.current = onPublished;
	});
	const active = useRef<AbortController | null>(null);
	const locked = useRef(false);
	const confirming = useRef(false);
	const submitted = useRef(false);
	const uncertain = useRef(false);
	const handledOperation = useRef<string | null>(null);
	const draftId = useRef<string | undefined>(undefined);
	const reportGeneration = useRef(0);
	const [phase, setPhase] = useState<Phase>("idle");
	const [review, setReview] = useState<Review | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [operationId, setOperationId] = useState<string | null>(null);
	const [terminalOperation, setTerminalOperation] = useState<OperationView>();
	const [reportError, setReportError] = useState<string | null>(null);
	const [recovery, setRecovery] = useState<"result" | "finalize" | null>(null);
	const identity = useAdminQuery("template-publish:identity", (signal) => client.identity(signal), { enabled: false });
	const observed = useAdminOperation(client, operationId);
	useEffect(() => () => active.current?.abort(), []);

	const fail = useCallback((reason: unknown, signal: AbortSignal) => {
		if (signal.aborted) return;
		locked.current = false;
		setPhase("idle");
		setError(errorMessage(reason));
	}, []);
	const done = useCallback((name?: string) => {
		locked.current = false;
		uncertain.current = false;
		setRecovery(null);
		setPhase("idle");
		completed.current(name);
	}, []);
	function observe(draft: TemplateResourceDraft) {
		if (!draft.operation_id) {
			uncertain.current = true;
			setRecovery("result");
			throw new Error("发布结果尚未确认，请重试读取发布结果，避免重复提交。");
		}
		draftId.current = draft.draft_id;
		handledOperation.current = null;
		setOperationId(draft.operation_id);
		setPhase("publishing");
	}
	const finishPublished = useCallback(
		async (name: string, signal: AbortSignal, knownSucceeded = false) => {
			setPhase("finalizing");
			setRecovery("finalize");
			let draft = await client.resourceDrafts.get(name, signal);
			signal.throwIfAborted();
			if (knownSucceeded || draft.status === "published" || draft.recovery_action === "finalize") {
				if (draft.status !== "published" || draft.cleanup_pending) draft = await client.resourceDrafts.finalize(name);
				signal.throwIfAborted();
				if (draft.status !== "published" || draft.cleanup_pending)
					throw new Error("发布结果已确认，临时文件尚未清理完成，请重试清理。");
				done(name);
				return;
			}
			throw new Error("尚未取得发布成功凭证，请重试读取发布结果。");
		},
		[client, done],
	);
	const prepare = useAdminMutation(async (signal: AbortSignal) => {
		const currentIdentity = await identity.refresh();
		signal.throwIfAborted();
		if (!currentIdentity) throw new Error("无法读取管理员身份，请重试。");
		if (currentIdentity.role !== "admin") throw new Error("当前身份无权发布资源。");
		const draft = await drafts.readActive(signal);
		signal.throwIfAborted();
		if (!draft) {
			done();
			return;
		}
		const name = draft.draft_id;
		draftId.current = draft.draft_id;
		if (draft.status === "published") {
			await finishPublished(name, signal);
			return;
		}
		if (draft.status === "publishing") {
			observe(draft);
			return;
		}
		if (draft.status === "failed" && (await restoreFailedReceipt(name, signal))) return;
		await preparePlan(name, signal);
	});

	async function restoreOperationReport(draft: TemplateResourceDraft, signal: AbortSignal) {
		if (!draft.operation_id || !draft.recovery_action) return;
		const generation = ++reportGeneration.current;
		try {
			const operation = await client.operations.get(draft.operation_id, signal);
			if (signal.aborted || generation !== reportGeneration.current) return;
			setTerminalOperation(operation);
			setReportError(null);
		} catch (reason) {
			if (signal.aborted || generation !== reportGeneration.current) return;
			setReportError(errorMessage(reason));
		}
	}
	async function restoreFailedReceipt(name: string, signal: AbortSignal) {
		const draft = await client.resourceDrafts.get(name, signal);
		signal.throwIfAborted();
		// 报告只供展示，既不决定也不阻塞服务端已允许的恢复动作。
		void restoreOperationReport(draft, signal);
		if (draft.recovery_action === "replan") {
			setRecovery(null);
			uncertain.current = false;
			return false;
		}
		if (draft.recovery_action === "read_result") {
			setRecovery("result");
			uncertain.current = true;
			throw new Error("发布已开始或结果待核对，草稿已保留。请核对下方资源结果；此批次不能重新发布。");
		}
		if (draft.recovery_action === "finalize") {
			uncertain.current = true;
			await finishPublished(name, signal);
			return true;
		}
		try {
			await client.resourceDrafts.finalize(name);
			signal.throwIfAborted();
		} catch (reason) {
			// 仅兼容未提供 recovery_action 的旧服务端；新响应已按持久阶段处理。
			if (reason instanceof KitError && reason.status === 409) return false;
			setRecovery("finalize");
			throw reason;
		}
		await finishPublished(name, signal, true);
		return true;
	}

	async function preparePlan(name: string, signal: AbortSignal) {
		const before = await client.draftResources.overview(name, signal);
		signal.throwIfAborted();
		if (before.active_mutation) throw new Error("资源草稿正在修改，请完成后重试。");
		setPhase("validate");
		const validation = await client.draftResources.validate(name);
		signal.throwIfAborted();
		if (validation.diagnostics.length) throw new Error(validation.diagnostics.join("\n"));
		setWarnings(validation.warnings ?? []);
		setPhase("plan");
		const plan = await client.draftResources.plan(name);
		signal.throwIfAborted();
		await reviewPlan(name, plan, signal);
	}

	async function assertPlanCurrent(name: string, plan: ProjectPlan, signal: AbortSignal) {
		if (plan.expires_at <= Date.now()) throw new Error("发布计划已过期，请重新准备发布。");
		const overview = await client.draftResources.overview(name, signal);
		signal.throwIfAborted();
		if (plan.expires_at <= Date.now()) throw new Error("发布计划已过期，请重新准备发布。");
		if (overview.active_mutation || overview.project_revision !== plan.project_revision)
			throw new Error("资源草稿已变化，请重新准备发布。");
	}
	async function reviewPlan(name: string, plan: ProjectPlan, signal: AbortSignal) {
		const changes = pendingPublishResources(plan);
		const declarations = await client.draftResources.declarations(name, signal).catch(() => undefined);
		signal.throwIfAborted();
		await assertPlanCurrent(name, plan, signal);
		signal.throwIfAborted();
		if (!changes.length) {
			if (plan.destructive) throw new Error("发布计划缺少变更明细，请重新准备发布。");
			if (!declarations) throw new Error("无法确认资源草稿是否为空，请重新读取并准备发布。");
			// 空草稿没有远端写入；保留它供下一次新建，不伪造发布成功凭证。
			if (!declarations.length) {
				done(name);
				return;
			}
		}
		setReview({ name, plan, resourceNames: publishResourceNames(declarations ?? []), verifyOnly: !changes.length });
		setPhase("review");
	}
	const execute = useAdminMutation(async (current: Review, signal: AbortSignal) => {
		await assertPlanCurrent(current.name, current.plan, signal);
		signal.throwIfAborted();
		submitted.current = true;
		reportGeneration.current++;
		setReportError(null);
		setTerminalOperation(undefined);
		const result = await client.draftResources.execute(current.name, {
			plan_id: current.plan.plan_id,
			confirm_token: current.plan.confirm_token,
		});
		signal.throwIfAborted();
		if (!result.operation_id) throw new Error("发布响应缺少操作标识。");
		setOperationId(result.operation_id);
		setPhase("publishing");
	});
	function start() {
		if (locked.current || uncertain.current || recovery) return;
		locked.current = true;
		confirming.current = false;
		submitted.current = false;
		handledOperation.current = null;
		active.current?.abort();
		const controller = new AbortController();
		active.current = controller;
		setError(null);
		setWarnings([]);
		setReview(null);
		setOperationId(null);
		reportGeneration.current++;
		setTerminalOperation(undefined);
		setReportError(null);
		setPhase("loading");
		void prepare.run(controller.signal).catch((reason: unknown) => fail(reason, controller.signal));
	}
	function confirm() {
		if (!review || confirming.current || phase !== "review") return;
		const controller = active.current;
		if (!controller || controller.signal.aborted) return;
		confirming.current = true;
		const current = review;
		setReview(null);
		setPhase("submitting");
		void execute.run(current, controller.signal).catch((reason: unknown) => {
			if (controller.signal.aborted) return;
			if (submitted.current && (!(reason instanceof KitError) || reason.status >= 500)) {
				uncertain.current = true;
				setRecovery("result");
				fail(new Error("发布结果尚未确认，请重试读取发布结果，避免重复提交。"), controller.signal);
				return;
			}
			fail(reason, controller.signal);
		});
	}
	function cancel() {
		if (phase !== "review") return;
		setReview(null);
		setPhase("idle");
		locked.current = false;
	}
	const recover = useAdminMutation(async (signal: AbortSignal) => {
		if (!draftId.current) throw new Error("缺少发布草稿标识，请重新进入页面读取。");
		const draft = await client.resourceDrafts.get(draftId.current, signal);
		signal.throwIfAborted();
		if (draft.status === "published" || recovery === "finalize") {
			await finishPublished(draft.draft_id, signal, recovery === "finalize");
		} else if (draft.status === "publishing" && draft.operation_id) {
			setRecovery(null);
			uncertain.current = false;
			observe(draft);
		} else if (draft.status === "failed" && draft.operation_id) {
			if (await restoreFailedReceipt(draft.draft_id, signal)) return;
			setRecovery(null);
			uncertain.current = false;
			throw new Error("未取得发布成功凭证，草稿已保留。重新准备时会再次核对是否可以安全重试。");
		} else throw new Error("发布结果尚未确认，请稍后重试读取，避免重复提交。");
	});
	function retryRecovery() {
		if (locked.current) return;
		locked.current = true;
		active.current?.abort();
		const controller = new AbortController();
		active.current = controller;
		setError(null);
		setPhase("finalizing");
		void recover.run(controller.signal).catch((reason: unknown) => fail(reason, controller.signal));
	}
	useEffect(() => {
		const operation = observed.operation;
		if (
			!operationId ||
			!operation ||
			operation.operation_id !== operationId ||
			handledOperation.current === operationId ||
			active.current?.signal.aborted ||
			!["succeeded", "failed", "cancelled"].includes(operation.status)
		)
			return;
		handledOperation.current = operationId;
		reportGeneration.current++;
		setReportError(null);
		setTerminalOperation(operation);
		setOperationId(null);
		const controller = active.current;
		if (operation.status === "succeeded" && draftId.current && controller) {
			void finishPublished(draftId.current, controller.signal, true).catch((reason: unknown) =>
				fail(reason, controller.signal),
			);
		} else {
			locked.current = false;
			setPhase("idle");
			setError(operation.error || (operation.status === "cancelled" ? "资源发布已取消。" : "资源发布失败。"));
			// 下一步只能来自服务端持久阶段，不能从 HTTP retryable 或单项成功自行推断可重发。
			uncertain.current = true;
			setRecovery("result");
			if (draftId.current && controller) {
				void client.resourceDrafts
					.get(draftId.current, controller.signal)
					.then((draft) => {
						if (controller.signal.aborted) return;
						const action = recoveryFor(draft);
						uncertain.current = action !== null;
						setRecovery(action);
					})
					.catch(() => {
						/* 暂时无法核对时继续阻止重发。 */
					});
			}
		}
	}, [observed.operation, operationId, finishPublished, fail, client]);
	return {
		start,
		confirm,
		cancel,
		phase,
		review,
		warnings,
		resumeAvailable: Boolean(
			drafts.draft &&
				(drafts.draft.status === "publishing" || drafts.draft.status === "failed" || drafts.draft.cleanup_pending),
		),
		blocked: recovery !== null,
		recovery,
		retryRecovery,
		error,
		busy: phase !== "idle",
		progress: phase in PROGRESS ? PROGRESS[phase as keyof typeof PROGRESS] : "",
		operation: operationId ? observed.operation : terminalOperation,
		observationError: operationId ? observed.error : null,
		reportError,
		reconnect: () => void observed.retry(),
	};
}
export type TemplatePublish = ReturnType<typeof useTemplatePublish>;
