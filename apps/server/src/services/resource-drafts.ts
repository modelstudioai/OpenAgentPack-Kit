import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { KitError, type ResourceDraftDiscardResult, type ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import type { ServerConfig } from "../config.ts";
import { type ResourceDraftProof, ResourceDraftProofSchema } from "../gateway/resource-draft-proof.ts";
import { createResourceDraftYamlFiles } from "../gateway/resource-draft-yaml-files.ts";
import type { ProjectExecutionPlan, ProviderGateway, ResourceDraftGateway } from "../gateway/types.ts";
import { PublicationError } from "../publication-error.ts";
import type { AuditLog } from "../store/audit.ts";
import type { OperationStore } from "../store/operations.ts";
import { type ResourceDraftRecord, type ResourceDraftStore, resourceDraftView } from "../store/resource-drafts.ts";
import type { ConfirmGate } from "./confirm-gate.ts";
import { createDraftResourceService, type DraftResourceService } from "./draft-resources.ts";
import type { OperationLogger, OperationRunner } from "./operations.ts";

interface Dependencies {
	config: ServerConfig;
	gateway: ProviderGateway;
	store: ResourceDraftStore;
	gate: ConfirmGate;
	runner: OperationRunner;
	audit: AuditLog;
	operations: OperationStore;
}
interface DraftRuntime {
	service: DraftResourceService;
	gateway: ResourceDraftGateway;
	inFlight: Set<Promise<unknown>>;
	clearTransientState(): void;
	retire(): void;
}

function failedBeforePublication(error: unknown): boolean {
	if (error instanceof PublicationError) return !error.errorDetails.mutation_started;
	const details = error instanceof KitError ? error.details : undefined;
	return Boolean(
		details &&
			typeof details === "object" &&
			"publication_outcome" in details &&
			details.publication_outcome === "not_started",
	);
}

function completionFailure(phase: "receipt" | "bindings" | "cleanup") {
	return new PublicationError(
		{ code: `publication.${phase}_failed`, phase, retryable: false, mutation_started: true },
		phase === "cleanup"
			? "资源已发布，临时文件清理失败，请重试清理"
			: "资源已发布，成功证明或回执保存失败，已保留批次等待核对",
	);
}

/** 一次性发布批次：声明与 state 仅属于本批次，成功 receipt 永不还原为后续批次的 state。 */
export function createResourceDraftService(deps: Dependencies) {
	const { config, gateway, store, gate, runner, audit } = deps;
	function view(row: ResourceDraftRecord): ResourceDraftView {
		const result = resourceDraftView(row);
		if (row.phase === "uncertain") {
			try {
				const text = store.document(row.draft_id)?.proof_json;
				const proof = text ? ResourceDraftProofSchema.safeParse(JSON.parse(text)) : undefined;
				if (
					proof?.success &&
					proof.data.draft_id === row.draft_id &&
					proof.data.owner === row.owner &&
					proof.data.project_revision === row.expected_revision
				)
					result.recovery_action = "finalize";
			} catch {
				/* 无效或缺失证明一律继续核对，不能从报告推断成功。 */
			}
		}
		return result;
	}
	const documents = new Map<string, ReturnType<NonNullable<ProviderGateway["resourceDraftDocument"]>>>();
	const files = createResourceDraftYamlFiles(config.dataDir, {
		read: (id) => store.document(id),
		initialize: (id, yaml) => store.initializeDocument(id, yaml),
		proof: (id, proof) => store.writeProof(id, proof),
		clear: (id) => store.clearDocument(id),
		release: (id) => {
			documents.get(id)?.clearSecrets();
			documents.delete(id);
		},
	});
	function scopedGateway(row: ResourceDraftRecord): ResourceDraftGateway {
		let document = documents.get(row.draft_id);
		if (!document) {
			document = gateway.resourceDraftDocument(
				row.draft_id,
				join(config.dataDir, "resource-draft-uploads", row.draft_id),
				{
					read: () => {
						const value = store.document(row.draft_id);
						if (!value) throw new KitError("conflict", "发布批次声明已清理");
						return value;
					},
					write: (revision, yaml, assets) => store.writeDocument(row.draft_id, revision, yaml, assets),
					writeState: (state) => store.writeState(row.draft_id, state),
				},
			);
			documents.set(row.draft_id, document);
		}
		return document;
	}
	const runtimes = new Map<string, DraftRuntime>();
	const loadingRuntimes = new Map<string, Promise<DraftRuntime>>();
	const creating = new Map<string, Promise<ResourceDraftView>>();
	const discarding = new Map<string, Promise<ResourceDraftDiscardResult>>();
	const busy = new Set<string>();
	store.recover();
	function owned(id: string, owner: string) {
		const row = store.get(id);
		if (!row || row.owner !== owner) throw new KitError("not_found", "资源发布批次不存在");
		return row;
	}
	const cleanupHash = (key?: string) => (key ? createHash("sha256").update(key).digest("hex") : null);
	function createDraftRecord(owner: string, key?: string) {
		return store.create(`draft_${randomUUID().replaceAll("-", "")}`, owner, cleanupHash(key) ?? undefined);
	}
	function requireCleanupOwner(row: ResourceDraftRecord, key?: string) {
		// 未登记凭证的旧 API 批次仅接受旧客户端显式操作，不能被新页面自动接管。
		if (row.cleanup_key_hash !== cleanupHash(key))
			throw new KitError("conflict", "已有资源批次属于另一浏览器或页面，请先从原入口退出并完成清理。", {
				details: { reason: "draft_owned_elsewhere" },
			});
	}
	function assertDiscardable(row: ResourceDraftRecord) {
		const operation = row.operation_id ? deps.operations.get(row.operation_id) : null;
		if (row.phase !== "editable" || (operation && !["succeeded", "failed"].includes(operation.status)))
			throw new KitError("conflict", "此批次已开始发布或发布结果待核对，不能丢弃", {
				details: { reason: "publication_unresolved" },
			});
	}
	function assertNotDiscarding(id: string) {
		if (discarding.has(id)) throw new KitError("conflict", "此批次正在丢弃，请稍后重试");
	}
	async function exclusive<T>(id: string, task: () => Promise<T>) {
		if (busy.has(id)) throw new KitError("conflict", "此批次正在发布或清理，请稍后重试");
		busy.add(id);
		try {
			return await task();
		} finally {
			busy.delete(id);
		}
	}
	async function bindings(proof: ResourceDraftProof, scoped: ResourceDraftGateway) {
		if ((await scoped.overview()).project_revision !== proof.project_revision)
			throw new KitError("conflict", "发布后的批次配置已变化，保留批次等待核对");
		const resources = await scoped.publicationBindings();
		const keys = new Set(resources.map((resource) => `${resource.type}:${resource.id}`));
		if (
			resources.length !== proof.required.length ||
			proof.required.some((resource) => !keys.has(`${resource.type}:${resource.id}`))
		)
			throw new KitError("conflict", "发布结果缺少资源绑定，已保留批次");
		return resources;
	}
	async function clean(row: ResourceDraftRecord, scoped: ResourceDraftGateway) {
		if (await files.exists(row.draft_id)) {
			const proof = await files.readProof(row.draft_id, row.owner);
			if (!proof || proof.project_revision !== row.expected_revision || !proof.resources)
				throw new KitError("conflict", "发布成功凭证不完整，不能清理批次");
			await files.cleanup(row.draft_id, async () => {
				if (proof.cleanup_started) return;
				if ((await scoped.overview()).project_revision !== row.expected_revision)
					throw new KitError("conflict", "发布后的批次配置已变化，保留批次等待核对");
				await files.writeProof({ ...proof, cleanup_started: true });
			});
		}
		store.cleaned(row.draft_id);
	}
	function releaseDraft(id: string) {
		documents.get(id)?.clearSecrets();
		documents.delete(id);
		runtimes.get(id)?.retire();
		runtimes.delete(id);
		loadingRuntimes.delete(id);
	}
	async function finish(
		row: ResourceDraftRecord,
		scoped: ResourceDraftGateway,
		onPhase?: (phase: "bindings" | "receipt" | "cleanup") => void,
	) {
		if (row.status !== "published") {
			const proof = await files.readProof(row.draft_id, row.owner);
			if (!proof || proof.project_revision !== row.expected_revision)
				throw new KitError("conflict", "尚无已确认的发布成功凭证，不能清理或自动重新发布");
			onPhase?.("bindings");
			const resources = proof.resources ?? (await bindings(proof, scoped));
			onPhase?.("receipt");
			if (!proof.resources) await files.writeProof({ ...proof, resources });
			store.receipt(row.draft_id, resources);
		}
		try {
			onPhase?.("cleanup");
			await clean(store.get(row.draft_id)!, scoped);
		} finally {
			// 回执已持久化后批次不可再编辑；磁盘清理重试也不需要保留上传字节或旧计划。
			releaseDraft(row.draft_id);
		}
		return view(store.get(row.draft_id)!);
	}
	async function publish(
		id: string,
		scoped: ResourceDraftGateway,
		expected: ProjectExecutionPlan,
		logger?: OperationLogger,
	) {
		return exclusive(id, async () => {
			const row = store.get(id)!;
			if (row.phase !== "editable") throw new KitError("conflict", "发布结果待核对，不能再次发布");
			await assertReferencedSkills(scoped);
			const required = (await scoped.declarations()).map(({ type, id }) => ({ type, id }));
			if (!required.length) throw new KitError("invalid_request", "此批次没有需要发布的资源");
			store.begin(id, expected.project_revision);
			let remoteSucceeded = false;
			let phase: "receipt" | "bindings" | "cleanup" = "receipt";
			try {
				const result = await scoped.execute(expected, logger);
				remoteSucceeded = true;
				const proof: ResourceDraftProof = {
					draft_id: id,
					owner: row.owner,
					project_revision: expected.project_revision,
					required,
				};
				await files.writeProof(proof);
				logger?.progress(0.85, "saving_receipt");
				await finish(store.get(id)!, scoped, (value) => {
					phase = value;
				});
				return result;
			} catch (error) {
				store.fail(id, !remoteSucceeded && failedBeforePublication(error));
				if (remoteSucceeded && !(error instanceof PublicationError)) throw completionFailure(phase);
				throw error;
			}
		});
	}
	async function assertReferencedSkills(scoped: ResourceDraftGateway) {
		const validation = await scoped.validate();
		if (validation.warnings?.includes("project.skill.unreferenced"))
			throw new KitError("invalid_request", "请先将本批次上传的 Skill 加入智能体，再发布本批次");
	}
	async function loadRuntime(row: ResourceDraftRecord) {
		const existing = runtimes.get(row.draft_id);
		if (existing) return existing;
		if (store.get(row.draft_id)?.status === "published")
			throw new KitError("conflict", "此批次已发布并关闭，请创建新的发布批次");
		const scoped = scopedGateway(row);
		const lifecycleGateway: ResourceDraftGateway = {
			...scoped,
			execute: (expected, logger) => publish(row.draft_id, scoped, expected, logger),
		};
		const scopedRunner: OperationRunner = {
			run: (input) => runner.run({ ...input, onCreated: (id) => store.operation(row.draft_id, id) }),
		};
		const service = createDraftResourceService({
			id: row.draft_id,
			gateway: lifecycleGateway,
			remote: gateway,
			gate,
			runner: scopedRunner,
			audit,
			uploadMaxBytes: config.uploadMaxBytes,
		});
		const inFlight = new Set<Promise<unknown>>();
		let retired = false;
		const closed = () => retired || store.get(row.draft_id)?.status === "published";
		const tracked = Object.fromEntries(
			Object.entries(service).map(([key, method]) => [
				key,
				(...args: never[]) => {
					if (!store.get(row.draft_id)) throw new KitError("not_found", "资源发布批次不存在");
					if (closed()) throw new KitError("conflict", "此批次已发布并关闭，请创建新的发布批次");
					assertNotDiscarding(row.draft_id);
					const result = (method as (...input: never[]) => unknown)(...args);
					if (!(result instanceof Promise)) return result;
					inFlight.add(result);
					return result
						.then((value) => {
							// execute 返回的 Operation ID 即使已成功也仍须交付；迟到上传不可再供调用方提交。
							if (key !== "execute" && closed())
								throw new KitError("conflict", "此批次已发布并关闭，请创建新的发布批次");
							return value;
						})
						.finally(() => {
							inFlight.delete(result);
							// 暂存可能在发布前开始、关闭后才完成，必须在完成后再次释放。
							if (closed()) service.clearTransientState();
						});
				},
			]),
		) as DraftResourceService;
		const entry = {
			service: tracked,
			gateway: scoped,
			inFlight,
			clearTransientState: service.clearTransientState,
			retire() {
				retired = true;
				service.clearTransientState();
			},
		};
		runtimes.set(row.draft_id, entry);
		return entry;
	}
	function runtimeFor(row: ResourceDraftRecord) {
		const existing = loadingRuntimes.get(row.draft_id);
		if (existing) return existing;
		const pending = loadRuntime(row);
		loadingRuntimes.set(row.draft_id, pending);
		void pending.catch(() => loadingRuntimes.delete(row.draft_id));
		return pending;
	}
	return {
		canReadOperation(id: string, owner: string) {
			return deps.operations.get(id)?.kind !== "resourceDraft.publish" || deps.operations.owns(id, owner);
		},
		active(owner: string, cleanupKey?: string) {
			const row = store.active(owner);
			if (row && cleanupKey) requireCleanupOwner(row, cleanupKey);
			return row ? view(row) : null;
		},
		get(id: string, owner: string) {
			return view(owned(id, owner));
		},
		create(owner: string, cleanupKey?: string) {
			const pending = creating.get(owner);
			if (pending)
				return pending.then((result) => {
					requireCleanupOwner(owned(result.draft_id, owner), cleanupKey);
					return result;
				});
			const task = (async () => {
				let row = store.active(owner);
				if (row) requireCleanupOwner(row, cleanupKey);
				if (row && discarding.has(row.draft_id)) throw new KitError("conflict", "上一个批次正在丢弃，请稍后重新创建");
				if (!row) {
					row = createDraftRecord(owner, cleanupKey);
					audit.append({ subject: owner, action: "resourceDraft.create", target: row.draft_id });
				}
				if (row.phase === "editable") await files.initialize(row.draft_id);
				return view(row);
			})();
			creating.set(owner, task);
			void task.finally(() => creating.delete(owner)).catch(() => undefined);
			return task;
		},
		discard(id: string, owner: string, cleanupKey?: string): Promise<ResourceDraftDiscardResult> {
			const existing = store.get(id);
			if (!existing) return Promise.resolve({ discarded: false });
			owned(id, owner);
			requireCleanupOwner(existing, cleanupKey);
			if (existing.status === "published") return Promise.resolve({ discarded: false });
			assertDiscardable(existing);
			const pending = discarding.get(id);
			if (pending) return pending;
			const task = (async () => {
				// 初始化、上传和本地变更可能晚于退出请求完成；封锁新调用后等待它们结束。
				await creating.get(owner)?.catch(() => undefined);
				const scoped = await runtimeFor(existing);
				await Promise.allSettled([...scoped.inFlight]);
				const current = owned(id, owner);
				if (current.status === "published") return { discarded: false };
				assertDiscardable(current);
				return exclusive(id, async () => {
					scoped.clearTransientState();
					await files.cleanup(id, async () => assertDiscardable(owned(id, owner)));
					store.discard(id, owner);
					runtimes.delete(id);
					loadingRuntimes.delete(id);
					audit.append({ subject: owner, action: "resourceDraft.discard", target: id });
					return { discarded: true };
				});
			})();
			discarding.set(id, task);
			void task.finally(() => discarding.delete(id)).catch(() => undefined);
			return task;
		},
		async finalize(id: string, owner: string) {
			const row = owned(id, owner);
			if (row.status === "published" && !row.cleanup_pending) return view(row);
			return exclusive(id, async () => {
				const scoped = runtimes.get(id)?.gateway ?? scopedGateway(row);
				return finish(row, scoped);
			});
		},
		async resourcesFor(name: string, owner: string, method: string, tail: string) {
			const row = owned(name, owner);
			assertNotDiscarding(name);
			const read = method === "GET" || method === "HEAD";
			if (row.status === "published") {
				if (tail !== "/resource-bindings" || !read)
					throw new KitError("conflict", "此批次已发布并关闭，请创建新的发布批次");
				return { published: { resources: resourceDraftView(row).resources } };
			}
			if (!read && row.phase !== "editable")
				throw new KitError("conflict", "此批次发布中或结果待核对，不能修改或重新发布");
			await files.assertSafe(name);
			return (await runtimeFor(row)).service;
		},
	};
}
export type ResourceDraftService = ReturnType<typeof createResourceDraftService>;
