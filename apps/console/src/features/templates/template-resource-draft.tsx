import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AdminClient } from "../../lib/admin/index.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { adminBaseUrl } from "../../lib/auth.ts";
import { useTemplateUnpublishedExit } from "./template-exit-confirmation.tsx";
import {
	claimTemplateResourceDraftLock,
	createTemplateResourceDraftOwner,
	TemplateResourceDraftUnavailableError,
} from "./template-resource-draft-owner.ts";

export type TemplateResourceDraft = NonNullable<Awaited<ReturnType<AdminClient["resourceDrafts"]["active"]>>>;

/** 页面只接管/清理旧批次；只有新建入口显式请求时才创建隔离项目。 */
function useResourceDraft() {
	const client = useMemo(getAdminClient, []);
	const [override, setOverride] = useState<TemplateResourceDraft | null | undefined>();
	const [modifiedProject, setModifiedProject] = useState<string>();
	const [agentDirty, setAgentDirty] = useState(false);
	const [environmentDirty, setEnvironmentDirty] = useState(false);
	const [fileDirty, setFileDirty] = useState(false);
	const [memoryDirty, setMemoryDirty] = useState(false);
	const [vaultDirty, setVaultDirty] = useState(false);
	const markContent = useCallback((projectName: string) => setModifiedProject(projectName), []);
	const owner = useMemo(
		() =>
			createTemplateResourceDraftOwner({
				client: client.resourceDrafts,
				onDraft: setOverride,
				claim: async () => {
					const identity = await client.identity();
					const scope = `${adminBaseUrl()}:${identity.subject}`;
					const release = await claimTemplateResourceDraftLock(scope);
					try {
						// 同源页面由 Web Lock 互斥；跨浏览器凭证不同，由服务端拒绝接管。
						// 只保存随机清理凭证，不保存模版配置；刷新/退出请求丢失仍可从原入口重试。
						const storageKey = `kit:resource-draft-cleanup:${scope}`;
						const cleanupKey = localStorage.getItem(storageKey) ?? crypto.randomUUID();
						localStorage.setItem(storageKey, cleanupKey);
						return { release, cleanupKey };
					} catch {
						release();
						throw new TemplateResourceDraftUnavailableError("无法保存资源清理凭证，请允许浏览器存储后重试。");
					}
				},
			}),
		[client],
	);
	useEffect(() => {
		const release = owner.acquire();
		const hide = () => {
			void owner.leave(true);
		};
		// bfcache 恢复时原批次已丢弃，重新进入页面以清除旧选择和表单。
		const show = (event: PageTransitionEvent) => {
			if (event.persisted) window.location.reload();
		};
		window.addEventListener("pagehide", hide);
		window.addEventListener("pageshow", show);
		return () => {
			window.removeEventListener("pagehide", hide);
			window.removeEventListener("pageshow", show);
			release();
		};
	}, [owner]);
	const initial = useAdminQuery("templates:resource-draft:active", async (signal) => {
		const result = await owner.initialize();
		signal.throwIfAborted();
		return result;
	});
	const draft = override === undefined ? initial.data : override;
	useTemplateUnpublishedExit(
		agentDirty ||
			environmentDirty ||
			fileDirty ||
			memoryDirty ||
			vaultDirty ||
			Boolean(draft && draft.status !== "published" && modifiedProject === draft.draft_id),
	);
	return {
		draft,
		markContent,
		setAgentDirty,
		setEnvironmentDirty,
		setFileDirty,
		setMemoryDirty,
		setVaultDirty,
		loading: override === undefined && initial.loading,
		error: override === undefined ? initial.error : null,
		retry: initial.refresh,
		ensureDraft: owner.ensureDraft,
		readActive: owner.readActive,
		accept: owner.accept,
	};
}

const Context = createContext<ReturnType<typeof useResourceDraft> | null>(null);
export function TemplateResourceDraftProvider({ children }: { children: ReactNode }) {
	const value = useResourceDraft();
	return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTemplateResourceDraft() {
	const value = useContext(Context);
	if (!value) throw new Error("缺少资源草稿上下文");
	return value;
}
