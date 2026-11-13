import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import type { TemplateUsageRow, TemplateVersionView, TemplateView } from "@openagentpack/kit-sdk/protocol";
import * as Tabs from "@radix-ui/react-tabs";
import { useEffect, useMemo, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { ghostButtonClass, primaryButtonClass } from "../../lib/styles.ts";
import { useConsoleRoute } from "../navigation/console-router.tsx";
import { InnerLayout } from "../navigation/inner-layout.tsx";
import { TemplateUsageDetail, TemplateUsagePanel } from "../usage/template-usage-panel.tsx";
import { TemplateApplyVersionAction } from "./template-apply-version-action.tsx";
import { TemplateDetailDebug } from "./template-detail-debug.tsx";
import styles from "./template-pages.module.less";
import { SavedConfiguration } from "./template-saved-configuration.tsx";
import { TemplateVersionDrawer } from "./template-version-drawer.tsx";

function useTemplateDetail(id: string) {
	const client = useMemo(getAdminClient, []);
	const { route, navigate, complete } = useConsoleRoute();
	const selectedVersion = route.version ?? null;
	const setSelectedVersion = (version: number | null) => navigate({ ...route, version: version ?? undefined });
	const identity = useAdminQuery(`templates:detail:identity:${id}`, (signal) => client.identity(signal));
	const current = useAdminQuery(`templates:current:${id}`, (signal) => client.templates.get(id, signal));
	const history = useAdminQuery<TemplateVersionView>(
		`templates:detail:${id}:${selectedVersion}`,
		(signal) => client.templates.version(id, selectedVersion!, signal),
		{ enabled: selectedVersion !== null },
	);
	const detail = selectedVersion === null ? current : history;
	const loading = detail.loading || (!detail.data && !detail.error);
	const template = !loading && !detail.error ? detail.data : undefined;
	const displayedVersion = selectedVersion ?? template?.version;
	const currentTemplate = current.data;
	const canApply =
		identity.data?.role === "admin" &&
		!current.loading &&
		!current.error &&
		currentTemplate &&
		template &&
		template.version !== currentTemplate.version;
	const savedAt =
		template &&
		("updated_at" in template && typeof template.updated_at === "string" ? template.updated_at : template.created_at);
	const applyTarget = canApply ? { template, currentVersion: currentTemplate.version } : null;
	return {
		identity,
		current,
		detail,
		template,
		displayedVersion,
		savedAt,
		loading,
		selectedVersion,
		setSelectedVersion,
		applyTarget,
		resetVersion: () => complete({ ...route, version: undefined }, true),
	};
}

/** 详情页的用量 tab：以当前模版为唯一行复用用量页的模版用量面板，会话明细与限额设置沿用同一套子视图。 */
function TemplateUsageTab({ templateId }: { templateId: string }) {
	const client = useMemo(getAdminClient, []);
	/** 与用量页共用同一查询缓存，两边看到同一份模版用量行。 */
	const templates = useAdminQuery("usage:templates", (signal) => client.usage.templates({}, signal));
	const [detail, setDetail] = useState<{ row: TemplateUsageRow; editLimits: boolean } | null>(null);
	if (detail) {
		return (
			<TemplateUsageDetail
				key={detail.row.template_id}
				template={detail.row}
				editLimits={detail.editLimits}
				onBack={() => {
					setDetail(null);
					void templates.refresh();
				}}
				onRefresh={async () => {
					const data = await templates.refresh();
					const next = (data ?? []).find((item) => item.template_id === detail.row.template_id);
					if (next) setDetail({ row: next, editLimits: detail.editLimits });
				}}
			/>
		);
	}
	const loading = templates.loading || (!templates.data && !templates.error);
	if (loading) return <EmptyState loading title="正在加载模版用量…" />;
	if (templates.error) return <ErrorState message={templates.error} onRetry={() => void templates.refresh()} />;
	const row = templates.data?.find((item) => item.template_id === templateId) ?? null;
	if (!row) return <EmptyState title="暂无该模版的用量" hint="模版保存并产生体验会话后，这里会展示用量统计。" />;
	return (
		<TemplateUsagePanel
			rows={[row]}
			loading={false}
			error={null}
			onRetry={() => void templates.refresh()}
			onSelect={(next) => setDetail({ row: next, editLimits: false })}
			onLimits={(next) => setDetail({ row: next, editLimits: true })}
		/>
	);
}

/** 详情页顶部反馈：保存成功提示与身份/版本查询错误。 */
function DetailAlerts({
	notice,
	identityError,
	identityRetry,
	currentError,
	currentRetry,
	selectedVersion,
}: {
	notice: string;
	identityError: string | null;
	identityRetry: () => void;
	currentError: string | null;
	currentRetry: () => void;
	selectedVersion: number | null;
}) {
	return (
		<>
			{notice ? (
				<p role="status" className={styles.successNote}>
					{notice}
				</p>
			) : null}
			{identityError ? <ErrorState message={identityError} onRetry={identityRetry} /> : null}
			{selectedVersion !== null && currentError ? <ErrorState message={currentError} onRetry={currentRetry} /> : null}
		</>
	);
}

export function TemplateDetail({
	id,
	onBack,
	onEdit,
	onApplied,
	onPendingChange,
}: {
	id: string;
	onBack: () => void;
	onEdit: () => void;
	onApplied: (template: TemplateView) => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const {
		identity,
		current,
		detail,
		template,
		displayedVersion,
		savedAt,
		loading,
		selectedVersion,
		setSelectedVersion,
		applyTarget,
		resetVersion,
	} = useTemplateDetail(id);
	const { route, navigate } = useConsoleRoute();
	const tab = route.tab === "debug" || route.tab === "usage" ? route.tab : "information";
	const [applying, setApplying] = useState(false);
	const [debugBusy, setDebugBusy] = useState(false);
	const busy = applying || debugBusy;
	const [notice, setNotice] = useState("");
	useEffect(() => {
		onPendingChange(busy);
		return () => onPendingChange(false);
	}, [busy, onPendingChange]);
	return (
		<section aria-label="模版详情" className={styles.pageStack}>
			<InnerLayout
				title={template?.name ?? "模版详情"}
				description={
					<div className={styles.stack2}>
						<p className={styles.kitMonoCaption}>{id}</p>
						{displayedVersion !== undefined ? (
							<p className={styles.kitMetaNote}>模版版本：v{displayedVersion}</p>
						) : null}
						{savedAt ? (
							<p className={styles.kitMetaNote}>
								保存时间：
								<time dateTime={savedAt}>{new Date(savedAt).toLocaleString("zh-CN", { hour12: false })}</time>
							</p>
						) : null}
					</div>
				}
				onBack={onBack}
				backLabel="返回模版列表"
				right={
					<>
						<TemplateVersionDrawer
							templateId={id}
							disabled={busy}
							selectedVersion={displayedVersion}
							onSelect={(version) => {
								if (version === displayedVersion && !detail.error) return;
								setNotice("");
								void current.refresh();
								if (version === selectedVersion && detail.error) void detail.refresh();
								else setSelectedVersion(version);
							}}
						/>
						{identity.data?.role === "admin" ? (
							<button type="button" title="编辑当前版本" className={ghostButtonClass} disabled={busy} onClick={onEdit}>
								编辑
							</button>
						) : null}
						{applyTarget ? (
							<TemplateApplyVersionAction
								key={`${applyTarget.template.version}:${applyTarget.currentVersion}`}
								template={applyTarget.template}
								currentVersion={applyTarget.currentVersion}
								disabled={debugBusy}
								onPendingChange={setApplying}
								onApplied={(saved) => {
									setNotice(`已应用 v${applyTarget.template.version}，当前版本为 v${saved.version}`);
									resetVersion();
									void current.refresh();
									onApplied(saved);
								}}
							/>
						) : null}
					</>
				}
			/>
			<DetailAlerts
				notice={notice}
				identityError={identity.error}
				identityRetry={() => void identity.refresh()}
				currentError={current.error}
				currentRetry={() => void current.refresh()}
				selectedVersion={selectedVersion}
			/>
			{loading ? <EmptyState loading title="正在加载模版…" /> : null}
			{detail.error ? <ErrorState message={detail.error} onRetry={() => void detail.refresh()} /> : null}
			<Tabs.Root
				value={tab}
				activationMode="manual"
				onValueChange={(value) => {
					if (!busy) navigate({ ...route, tab: value === "information" ? undefined : (value as "debug" | "usage") });
				}}
				className={styles.pageStack}
			>
				<Tabs.List aria-label="模版详情" className={styles.tabList}>
					{(["information", "usage", "debug"] as const).map((value) => (
						<Tabs.Trigger
							key={value}
							value={value}
							disabled={busy}
							className={tab === value ? primaryButtonClass : ghostButtonClass}
						>
							{value === "information" ? "模版信息" : value === "usage" ? "用量" : "调试"}
						</Tabs.Trigger>
					))}
				</Tabs.List>
				<Tabs.Content value="information">
					{template ? <SavedConfiguration key={`${id}:${template.version}`} template={template} /> : null}
				</Tabs.Content>
				<Tabs.Content value="usage">
					<TemplateUsageTab templateId={id} />
				</Tabs.Content>
				<Tabs.Content value="debug">
					{template ? (
						<TemplateDetailDebug
							key={`${id}:${template.version}`}
							template={template}
							canDebug={identity.data?.role === "admin"}
							readOnly={identity.data?.role === "auditor"}
							onBusyChange={setDebugBusy}
						/>
					) : null}
				</Tabs.Content>
			</Tabs.Root>
		</section>
	);
}
