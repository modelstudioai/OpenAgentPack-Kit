import { useIsMobile } from "@openagentpack/kit-sdk/hooks";
import {
	PLAZA_CATEGORY_LABELS,
	type PlazaCategory,
	type TemplatesQuery,
	type TemplateView,
} from "@openagentpack/kit-sdk/protocol";
import type { TableColumnsType } from "antd";
import { Button, Empty, Input, Result, Select, Table } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { useConsoleRoute } from "../navigation/console-router.tsx";
import { EditTemplatePage } from "./edit-template-page.tsx";
import { TemplateDeleteDialog } from "./template-delete-dialog.tsx";
import { TemplateDetail } from "./template-detail.tsx";
import { useTemplateConfigurationColumns } from "./template-list-configuration.tsx";
import { TemplateListingDialog } from "./template-listing-dialog.tsx";
import styles from "./template-pages.module.less";

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
type TemplateAction = { kind: "listing" | "delete"; template: TemplateView };
type TemplateStatusFilter = "" | NonNullable<TemplatesQuery["status"]>;
type TemplateCategoryFilter = "" | PlazaCategory;
const CATEGORIES = Object.keys(PLAZA_CATEGORY_LABELS) as PlazaCategory[];

function useTemplateList(client: ReturnType<typeof getAdminClient>, paused: boolean) {
	const [search, setSearch] = useState("");
	const [composing, setComposing] = useState(false);
	const [query, setQuery] = useState({
		search: "",
		status: "" as TemplateStatusFilter,
		category: "" as TemplateCategoryFilter,
		cursors: [""],
		revision: 0,
	});
	const searchPending = composing || search.trim() !== query.search;
	useEffect(() => {
		if (composing || paused || search.trim() === query.search) return;
		const timer = setTimeout(() => {
			setQuery((current) => ({ ...current, search: search.trim(), cursors: [""], revision: current.revision + 1 }));
		}, SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	}, [search, composing, paused, query.search]);
	const changeFilter = (patch: Partial<Pick<typeof query, "status" | "category">>) =>
		setQuery((current) => ({
			...current,
			search: composing ? current.search : search.trim(),
			...patch,
			cursors: [""],
			revision: current.revision + 1,
		}));
	const list = useAdminQuery(`templates:list:${JSON.stringify(query)}`, (signal) =>
		client.templates.list(
			{
				search: query.search,
				status: query.status || undefined,
				category: query.category || undefined,
				limit: PAGE_SIZE,
				page_token: query.cursors.at(-1) || undefined,
			},
			signal,
		),
	);
	const loading = list.loading || (!list.data && !list.error);
	const rows = !loading && !list.error ? (list.data?.data ?? []) : [];
	const nextCursor = list.data?.next_page_token;
	const refreshAfterRemoval = () =>
		setQuery((current) => ({
			...current,
			cursors: rows.length === 1 && current.cursors.length > 1 ? current.cursors.slice(0, -1) : current.cursors,
			revision: current.revision + 1,
		}));
	const refreshAfterUpdate = (template: TemplateView) => {
		const removed = query.category && template.category !== query.category;
		if (removed && rows.some((row) => row.template_id === template.template_id)) refreshAfterRemoval();
		else void list.refresh();
	};
	return {
		search,
		setSearch,
		setComposing,
		searchPending,
		changeFilter,
		list,
		query,
		setQuery,
		loading,
		rows,
		nextCursor,
		refreshAfterRemoval,
		refreshAfterUpdate,
	};
}

function TemplateListFilters({
	search,
	setSearch,
	setComposing,
	status,
	changeStatus,
	category,
	changeCategory,
	busy,
}: {
	search: string;
	setSearch: (value: string) => void;
	setComposing: (value: boolean) => void;
	status: TemplateStatusFilter;
	changeStatus: (value: TemplateStatusFilter) => void;
	category: TemplateCategoryFilter;
	changeCategory: (value: TemplateCategoryFilter) => void;
	busy: boolean;
}) {
	return (
		<div className={styles.filterRow}>
			<Input
				type="search"
				aria-label="搜索模版"
				placeholder="搜索智能体名称或智能体 ID"
				maxLength={254}
				disabled={busy}
				value={search}
				onChange={(event) => setSearch(event.target.value)}
				onCompositionStart={() => setComposing(true)}
				onCompositionEnd={(event) => {
					setComposing(false);
					setSearch(event.currentTarget.value);
				}}
				className={styles.searchWide}
			/>
			<div className={styles.filterGroup}>
				<span>上架状态</span>
				<Select
					aria-label="上架状态"
					className={styles.selectStatus}
					value={status}
					disabled={busy}
					options={[
						{ value: "", label: "全部" },
						{ value: "listed", label: "已上架" },
						{ value: "unlisted", label: "未上架" },
					]}
					onChange={(value) => changeStatus(value as TemplateStatusFilter)}
				/>
			</div>
			<div className={styles.filterGroup}>
				<span>分类</span>
				<Select
					aria-label="分类"
					className={styles.selectCategory}
					value={category}
					disabled={busy}
					options={[
						{ value: "", label: "全部" },
						...CATEGORIES.map((value) => ({ value, label: PLAZA_CATEGORY_LABELS[value] })),
					]}
					onChange={(value) => changeCategory(value as TemplateCategoryFilter)}
				/>
			</div>
		</div>
	);
}

export function TemplateListPage({
	onCreate,
	savedName,
	onPendingChange,
}: {
	onCreate: () => void;
	savedName?: string;
	onPendingChange?: (pending: boolean) => void;
}) {
	const client = useMemo(getAdminClient, []);
	const identity = useAdminQuery("templates:list:identity", (signal) => client.identity(signal));
	const { route, navigate, complete } = useConsoleRoute();
	const selected = route.page === "template-detail" ? route.id : undefined;
	const editingId = route.page === "template-edit" ? route.id : undefined;
	const setSelected = (id: string | null, tab?: "debug") =>
		navigate(id ? { page: "template-detail", id, tab } : { page: "template-list" });
	const setEditingId = (id: string | null) => navigate(id ? { page: "template-edit", id } : { page: "template-list" });
	const [action, setAction] = useState<TemplateAction | null>(null);
	const [actionBusy, setActionBusy] = useState(false);
	const [notice, setNotice] = useState<string>();
	const {
		search,
		setSearch,
		setComposing,
		searchPending,
		changeFilter,
		list,
		query,
		setQuery,
		loading,
		rows,
		nextCursor,
		refreshAfterRemoval,
		refreshAfterUpdate,
	} = useTemplateList(client, Boolean(action || editingId || selected));
	const resultBusy = actionBusy || searchPending;
	const filtersActive = Boolean(query.search || query.status || query.category);
	useEffect(() => {
		onPendingChange?.(actionBusy);
		return () => onPendingChange?.(false);
	}, [actionBusy, onPendingChange]);
	if (editingId)
		return (
			<EditTemplatePage
				key={editingId}
				id={editingId}
				onBack={() => setEditingId(null)}
				onPendingChange={onPendingChange}
				onSaved={(template) => {
					setNotice(`模版「${template.name}」已更新`);
					complete({ page: "template-list" });
					refreshAfterUpdate(template);
				}}
			/>
		);
	if (selected)
		return (
			<TemplateDetail
				key={selected}
				id={selected}
				onBack={() => setSelected(null)}
				onEdit={() => setEditingId(selected)}
				onPendingChange={setActionBusy}
				onApplied={(template) => {
					setNotice(`模版「${template.name}」已更新`);
					refreshAfterUpdate(template);
				}}
			/>
		);
	return (
		<section aria-label="模版列表" className={styles.pageStack}>
			<header className={styles.rowBetween}>
				<h2 className={styles.pageTitle}>智能体管理</h2>
				{identity.data?.role === "admin" ? (
					<Button type="primary" disabled={actionBusy} onClick={onCreate}>
						创建智能体
					</Button>
				) : null}
			</header>
			<TemplateListNotice savedName={savedName} notice={notice} />
			<TemplateListFilters
				search={search}
				setSearch={setSearch}
				setComposing={setComposing}
				status={query.status}
				changeStatus={(status) => changeFilter({ status })}
				category={query.category}
				changeCategory={(category) => changeFilter({ category })}
				busy={actionBusy}
			/>
			{identity.error ? (
				<Result
					status="error"
					title={identity.error}
					extra={<Button onClick={() => void identity.refresh()}>重试</Button>}
				/>
			) : null}
			{list.error ? (
				<Result status="error" title={list.error} extra={<Button onClick={() => void list.refresh()}>重试</Button>} />
			) : null}
			{!list.error ? (
				<TemplateTable
					rows={rows}
					loading={loading}
					filtered={filtersActive}
					onSelect={setSelected}
					canManage={identity.data?.role === "admin"}
					busy={resultBusy}
					onAction={setAction}
					onEdit={setEditingId}
				/>
			) : null}
			<TemplatePagination
				page={query.cursors.length}
				hasNext={Boolean(nextCursor)}
				loading={loading || resultBusy}
				onPrevious={() => setQuery((current) => ({ ...current, cursors: current.cursors.slice(0, -1) }))}
				onNext={() => {
					if (nextCursor) setQuery((current) => ({ ...current, cursors: [...current.cursors, nextCursor] }));
				}}
			/>
			<TemplateActionDialog
				action={action}
				onClose={() => setAction(null)}
				onPendingChange={setActionBusy}
				onComplete={(message, deleted) => {
					setNotice(message);
					setAction(null);
					if (deleted || query.status) refreshAfterRemoval();
					else void list.refresh();
				}}
			/>
		</section>
	);
}

function TemplateEmptyState({ filtered }: { filtered: boolean }) {
	return (
		<Empty
			description={
				<span className={styles.mutedOnly}>
					{filtered ? "未找到匹配的模版" : "暂无模版"}
					<br />
					<span className={styles.textXs}>
						{filtered ? "请调整搜索内容、上架状态或分类。" : "完成智能体配置后，点击保存智能体。"}
					</span>
				</span>
			}
		/>
	);
}

function TemplateListNotice({ savedName, notice }: { savedName?: string; notice?: string }) {
	const message = notice ?? (savedName ? `模版「${savedName}」已保存` : undefined);
	if (!message) return null;
	return (
		<p role="status" className={styles.successAny}>
			{message}
		</p>
	);
}

function TemplateTime({ value }: { value?: string }) {
	return value ? <time dateTime={value}>{new Date(value).toLocaleString("zh-CN", { hour12: false })}</time> : "—";
}

function TemplateTable({
	rows,
	loading,
	filtered,
	onSelect,
	canManage,
	busy,
	onAction,
	onEdit,
}: {
	rows: TemplateView[];
	loading: boolean;
	filtered: boolean;
	onSelect: (id: string, tab?: "debug") => void;
	canManage: boolean;
	busy: boolean;
	onAction: (action: TemplateAction) => void;
	onEdit: (id: string) => void;
}) {
	const { columns: configurationColumns, loading: configurationLoading } = useTemplateConfigurationColumns(rows);
	const narrow = useIsMobile();
	const tableLoading = loading || configurationLoading;
	const columns = [
		{
			key: "name",
			title: "智能体名称",
			width: 200,
			fixed: narrow ? undefined : "left",
			render: (_, template: TemplateView) => (
				<div className={styles.nameCellWide}>
					<span className={styles.nameAny}>{template.name}</span>
				</div>
			),
		},
		...configurationColumns,
		{
			title: "保存时间",
			render: (_, template: TemplateView) => (
				<span className={styles.nowrapMuted}>
					<TemplateTime value={template.created_at} />
				</span>
			),
		},
		{
			title: "状态",
			render: (_, template: TemplateView) => (
				<span className={template.listing?.status === "listed" ? styles.nowrapSuccess : styles.nowrapMuted}>
					{template.listing?.status === "listed" ? "已上架" : "未上架"}
				</span>
			),
		},
		{
			title: "上架时间",
			render: (_, template: TemplateView) => (
				<span className={styles.nowrapMuted}>
					<TemplateTime value={template.listing?.listed_at} />
				</span>
			),
		},
		{
			title: "操作",
			fixed: narrow ? undefined : "right",
			width: 300,
			render: (_, template: TemplateView) => (
				<TemplateActions
					template={template}
					onSelect={onSelect}
					canManage={canManage}
					busy={busy || tableLoading}
					onAction={onAction}
					onEdit={onEdit}
				/>
			),
		},
	] satisfies TableColumnsType<TemplateView>;
	return (
		<Table
			rowKey="template_id"
			size="middle"
			columns={columns}
			dataSource={rows}
			loading={tableLoading}
			locale={{ emptyText: tableLoading ? null : <TemplateEmptyState filtered={filtered} /> }}
			pagination={false}
			scroll={{ x: "max-content" }}
			sticky
		/>
	);
}

function TemplateActions({
	template,
	onSelect,
	canManage,
	busy,
	onAction,
	onEdit,
}: {
	template: TemplateView;
	onSelect: (id: string, tab?: "debug") => void;
	canManage: boolean;
	busy: boolean;
	onAction: (action: TemplateAction) => void;
	onEdit: (id: string) => void;
}) {
	return (
		<div className={styles.actionsRow}>
			<Button
				type="link"
				size="small"
				aria-label={`查看模版 ${template.name}`}
				disabled={busy}
				onClick={() => onSelect(template.template_id)}
			>
				查看详情
			</Button>
			{canManage ? (
				<Button
					type="link"
					size="small"
					aria-label={`编辑模版 ${template.name}`}
					disabled={busy}
					onClick={() => onEdit(template.template_id)}
				>
					编辑
				</Button>
			) : null}
			{canManage ? (
				<Button
					type="link"
					size="small"
					aria-label={`调试模版 ${template.name}`}
					disabled={busy}
					onClick={() => onSelect(template.template_id, "debug")}
				>
					调试
				</Button>
			) : null}
			{canManage ? (
				<Button
					type="link"
					size="small"
					aria-label={`${template.listing?.status === "listed" ? "下架" : "上架"}模版 ${template.name}`}
					disabled={busy}
					onClick={() => onAction({ kind: "listing", template })}
				>
					{template.listing?.status === "listed" ? "下架" : "上架"}
				</Button>
			) : null}
			{canManage ? (
				<Button
					type="link"
					size="small"
					danger
					aria-label={`删除模版 ${template.name}`}
					disabled={busy}
					onClick={() => onAction({ kind: "delete", template })}
				>
					删除
				</Button>
			) : null}
		</div>
	);
}

function TemplateActionDialog({
	action,
	onClose,
	onComplete,
	onPendingChange,
}: {
	action: TemplateAction | null;
	onClose: () => void;
	onComplete: (message: string, deleted?: boolean) => void;
	onPendingChange: (pending: boolean) => void;
}) {
	if (!action) return null;
	const template = action.template;
	if (action.kind === "delete")
		return (
			<TemplateDeleteDialog
				key={template.template_id}
				template={template}
				onClose={onClose}
				onPendingChange={onPendingChange}
				onDeleted={() => onComplete(`模版「${template.name}」已删除`, true)}
			/>
		);
	return (
		<TemplateListingDialog
			key={template.template_id}
			template={template}
			onClose={onClose}
			onPendingChange={onPendingChange}
			onUpdated={(catalog) =>
				onComplete(`模版「${template.name}」${catalog.status === "listed" ? "已上架" : "已下架"}`)
			}
		/>
	);
}

function TemplatePagination({
	page,
	hasNext,
	loading,
	onPrevious,
	onNext,
}: {
	page: number;
	hasNext: boolean;
	loading: boolean;
	onPrevious: () => void;
	onNext: () => void;
}) {
	if (page === 1 && !hasNext) return null;
	return (
		<nav aria-label="模版列表分页" className={styles.rowEnd13}>
			<Button size="small" disabled={loading || page === 1} onClick={onPrevious}>
				上一页
			</Button>
			<span>第 {page} 页</span>
			<Button size="small" disabled={loading || !hasNext} onClick={onNext}>
				下一页
			</Button>
		</nav>
	);
}
