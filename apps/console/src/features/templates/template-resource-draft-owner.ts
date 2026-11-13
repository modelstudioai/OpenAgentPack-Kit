import { KitError, type ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import type { AdminClient } from "../../lib/admin/index.ts";

type DraftClient = Pick<AdminClient["resourceDrafts"], "active" | "create" | "discard" | "get">;

/** 仅限制本地资源；已有远端资源仍可直接预览。 */
export class TemplateResourceDraftUnavailableError extends Error {}

function ownedElsewhere(error: unknown): error is KitError {
	return (
		error instanceof KitError &&
		error.status === 409 &&
		typeof error.details === "object" &&
		error.details !== null &&
		"reason" in error.details &&
		error.details.reason === "draft_owned_elsewhere"
	);
}

function publicationUnresolved(error: unknown) {
	return (
		error instanceof KitError &&
		error.status === 409 &&
		typeof error.details === "object" &&
		error.details !== null &&
		"reason" in error.details &&
		error.details.reason === "publication_unresolved"
	);
}

/** 创建页拥有批次；退出先处理在途创建，再释放跨页锁，避免旧页清理新页正在使用的批次。 */
export function createTemplateResourceDraftOwner(options: {
	client: DraftClient;
	claim: () => Promise<{ release: () => void; cleanupKey: string }>;
	onDraft: (draft: ResourceDraftView | null) => void;
}) {
	let leases = 0;
	let left = false;
	let draft: ResourceDraftView | null = null;
	let releaseLock: (() => void) | undefined;
	let cleanupKey: string | undefined;
	let initialized: Promise<ResourceDraftView | null> | undefined;
	let creating: Promise<ResourceDraftView> | undefined;
	let leaving: Promise<void> | undefined;
	let keepalive = false;
	const assertActive = () => {
		if (left || leases === 0) throw new Error("已离开创建页面，请重新进入后新建资源。");
	};
	const accept = (result: ResourceDraftView | null) => {
		draft = result;
		if (!left && leases > 0) options.onDraft(result);
	};
	async function discardCurrent() {
		if (!draft || draft.status === "published") return;
		const current = draft;
		const result = await options.client.discard(current.draft_id, { keepalive, cleanupKey });
		let remaining: ResourceDraftView | null = null;
		if (!result.discarded) {
			try {
				remaining = await options.client.get(current.draft_id);
			} catch (error) {
				if (!(error instanceof KitError && error.status === 404)) throw error;
			}
		}
		if (draft === current) draft = remaining;
	}
	async function discardAbandoned() {
		try {
			await discardCurrent();
		} catch (error) {
			// 只有服务端明确保护的发布中/未知结果可继续进入恢复路径。
			if (!publicationUnresolved(error))
				throw new Error("未发布资源清理失败，请重试清理后再新建资源。", { cause: error });
		}
	}
	function initialize() {
		assertActive();
		if (initialized) return initialized;
		const request = (async () => {
			if (!releaseLock) {
				const claim = await options.claim();
				releaseLock = claim.release;
				cleanupKey = claim.cleanupKey;
			}
			assertActive();
			// 服务端先核验清理凭证；Web Lock 不能证明另一浏览器已经离开。
			draft = await readOwnedActive();
			await discardAbandoned();
			assertActive();
			accept(draft);
			return draft;
		})();
		initialized = request;
		void request.catch(() => {
			if (initialized === request) initialized = undefined;
		});
		return request;
	}
	async function readOwnedActive(signal?: AbortSignal) {
		try {
			return await options.client.active(signal, cleanupKey);
		} catch (error) {
			if (ownedElsewhere(error)) throw new TemplateResourceDraftUnavailableError(error.message);
			throw error;
		}
	}
	function leave(immediateKeepalive = false) {
		keepalive ||= immediateKeepalive;
		if (leaving) return leaving;
		left = true;
		leaving = (async () => {
			// 创建返回前不释放锁：同管理员下一页不能接管仍将被旧页清理的 ID。
			await Promise.allSettled([initialized, creating]);
			try {
				await discardCurrent();
			} catch {
				// 失败现场保留；下次进入先重试清理，不能静默恢复为可选候选。
			} finally {
				releaseLock?.();
				releaseLock = undefined;
			}
		})();
		return leaving;
	}
	return {
		acquire() {
			leases += 1;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				leases -= 1;
				queueMicrotask(() => {
					if (leases === 0) void leave();
				});
			};
		},
		initialize,
		leave,
		accept,
		async readActive(signal?: AbortSignal) {
			try {
				await initialize();
			} catch (error) {
				// 另一页拥有本地批次时，本页仍允许只用已有远端资源。
				if (error instanceof TemplateResourceDraftUnavailableError) return null;
				throw error;
			}
			signal?.throwIfAborted();
			let result: ResourceDraftView | null;
			try {
				result = await readOwnedActive(signal);
			} catch (error) {
				if (error instanceof TemplateResourceDraftUnavailableError) return null;
				throw error;
			}
			signal?.throwIfAborted();
			assertActive();
			accept(result);
			return result;
		},
		ensureDraft() {
			assertActive();
			if (creating) return creating;
			const request = (async () => {
				await initialize();
				assertActive();
				const result = await options.client.create(cleanupKey);
				// 即使此时已退出，也记录 ID，由 leave 在释放锁前清理。
				accept(result);
				assertActive();
				if (result.status !== "draft" && result.status !== "failed")
					throw new Error("当前资源草稿尚未完成，请关闭弹窗后恢复发布或清理。");
				return result;
			})();
			creating = request;
			void request
				.finally(() => {
					if (creating === request) creating = undefined;
				})
				.catch(() => {});
			return request;
		},
	};
}

/** Web Locks 由浏览器在崩溃/关闭时自动释放，避免用不可靠的过期时间抢占另一页。 */
export function claimTemplateResourceDraftLock(scope: string): Promise<() => void> {
	if (!globalThis.navigator?.locks)
		return Promise.reject(
			new TemplateResourceDraftUnavailableError("当前浏览器不支持安全创建本地资源，请使用支持 Web Locks 的浏览器。"),
		);
	return new Promise((resolve, reject) => {
		void navigator.locks
			.request(`kit:template-resource-draft:${scope}`, { ifAvailable: true }, async (lock) => {
				if (!lock) {
					reject(new TemplateResourceDraftUnavailableError("另一个页面正在创建资源，请先退出该页面后重试。"));
					return;
				}
				await new Promise<void>((release) => resolve(release));
			})
			.catch(reject);
	});
}
