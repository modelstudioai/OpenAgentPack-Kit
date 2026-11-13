import type {
	PresetPackAgentResources,
	PresetPackCreateInput,
	PresetPackPreview,
} from "@openagentpack/kit-sdk/protocol";
import type { TableColumnsType } from "antd";
import { Alert, Button, Empty, Result, Space, Spin, Table, Tag } from "antd";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi, getAdminClient } from "../../lib/api.ts";
import type { RemoteAgent } from "../catalog/use-remote-agents.ts";
import {
	PresetPackResourceDetailDrawer,
	type PresetPackResourceTarget,
} from "./preset-pack-resource-detail-drawer.tsx";
import {
	groupPresetPackResources,
	type PresetPackResourceGroup,
	type PresetPackResourceRow,
} from "./preset-pack-resource-groups.ts";
import { presetPackResourceSelectionLimit, selectPresetPackResource } from "./preset-pack-resource-selection.ts";

const resourceTypes: Record<string, string> = {
	environment: "环境",
	file: "文件",
	memory_store: "记忆库",
	vault: "密钥库",
	github_repository: "代码仓库",
};
const resourceColumns: TableColumnsType<PresetPackResourceRow> = [
	{ title: "资源 ID", dataIndex: "id", render: (id?: string) => id ?? "—" },
	{ title: "挂载路径", render: (_, resource) => resource.mountPaths.join("、") || "—" },
	{
		title: "权限",
		render: (_, resource) =>
			resource.accesses.map((access) => (access === "read_only" ? "只读" : "读写")).join("、") || "—",
	},
	{
		title: "来源",
		render: (_, resource) =>
			resource.sources.map((source) => (source === "runtime" ? "运行时挂载" : "会话配置")).join("、"),
	},
];

function ResourceGroupTable({
	group,
	selectedKeys,
	loading,
	disabled,
	complete,
	onView,
	onRemove,
}: {
	group: PresetPackResourceGroup;
	selectedKeys: string[];
	loading: boolean;
	disabled: boolean;
	complete: boolean;
	onView: (resource: PresetPackResourceRow) => void;
	onRemove: (key: string) => void;
}) {
	const label = Object.hasOwn(resourceTypes, group.type) ? resourceTypes[group.type] : group.type;
	const limit = presetPackResourceSelectionLimit(group.type);
	const selectionRule = limit === 1 ? "单选" : limit ? `多选，最多 ${limit} 个` : "暂不支持关联";
	const details =
		group.type === "github_repository"
			? [
					...resourceColumns,
					{
						title: "仓库 URL",
						render: (_: unknown, resource: PresetPackResourceRow) => resource.repositoryUrls.join("、") || "—",
					},
				]
			: resourceColumns;
	const columns: TableColumnsType<PresetPackResourceRow> = [
		...details,
		{
			title: "选择状态",
			render: (_, resource) =>
				selectedKeys.includes(resource.key) ? (
					<Space>
						<Tag color="success">已选择</Tag>
						<Button
							type="link"
							size="small"
							disabled={disabled}
							aria-label={`取消选择${label}资源 ${resource.id}`}
							onClick={(event) => {
								event.stopPropagation();
								onRemove(resource.key);
							}}
						>
							取消选择
						</Button>
					</Space>
				) : (
					<Tag>未选择</Tag>
				),
		},
	];
	return (
		<section aria-label={`${label}资源`} className="space-y-4">
			<h3 className="text-sm font-medium">
				{label}（{selectionRule}）
			</h3>
			<Table<PresetPackResourceRow>
				rowKey="key"
				columns={columns}
				dataSource={group.rows}
				loading={loading}
				rowClassName={
					disabled
						? "cursor-not-allowed"
						: "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
				}
				onRow={(resource) => ({
					tabIndex: disabled ? -1 : 0,
					"aria-label": `${label}资源 ${resource.id || "未命名资源"}`,
					"aria-haspopup": "dialog",
					"aria-disabled": disabled,
					onClick: () => {
						if (!disabled) onView(resource);
					},
					onKeyDown: (event) => {
						if (disabled || event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " "))
							return;
						event.preventDefault();
						onView(resource);
					},
				})}
				scroll={{ x: "max-content" }}
				locale={{
					emptyText: (
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={complete ? "暂无关联资源" : "暂无已成功读取的资源"}
						/>
					),
				}}
				pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => `共 ${total} 个资源` }}
			/>
		</section>
	);
}

/** 选择变化创建独立查询，迟到响应不覆盖新智能体。 */
export function usePresetPackResources(
	agentId: string,
	{ enabled = true, initialData }: { enabled?: boolean; initialData?: PresetPackAgentResources } = {},
) {
	const initial = initialData?.agent_id === agentId ? initialData : undefined;
	const query = useAdminQuery(
		`preset-pack-resources:${agentId}`,
		(signal) => adminApi.presetPacks.agentResources(agentId, signal),
		{ enabled: enabled && !initial },
	);
	return { ...query, data: query.data ?? initial };
}

interface ResourceSelectionProps {
	agent: RemoteAgent;
	onPendingChange: (pending: boolean) => void;
	onImport: (preset: PresetPackPreview) => void;
	actionLabel?: string;
	requireSelection?: boolean;
	actionContainer?: HTMLElement | null;
	feedbackContainer?: HTMLElement | null;
}

function ResourceSelectionSlot({ container, children }: { container?: HTMLElement | null; children: ReactNode }) {
	if (container === undefined) return children;
	return container ? createPortal(children, container) : null;
}

function ResourceEmptyState({ loading, complete }: { loading: boolean; complete?: boolean }) {
	if (loading) return <Spin aria-label="正在读取运行时资源" />;
	return (
		<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={complete ? "暂无运行时资源" : "暂无已成功读取的资源"} />
	);
}

export function PresetPackSessionResources(props: ResourceSelectionProps) {
	const query = usePresetPackResources(props.agent.agent_id);
	return <PresetPackResourceSelection {...props} query={query} />;
}

/** 预设包导入与基础配置关联资源共用分组、多选和只读核验，不重复读取发现结果。 */
export function PresetPackResourceSelection({
	agent,
	onPendingChange,
	onImport,
	query,
	actionLabel = "导入",
	requireSelection = false,
	actionContainer,
	feedbackContainer,
}: ResourceSelectionProps & {
	query: ReturnType<typeof usePresetPackResources>;
}) {
	const agentId = agent.agent_id;
	const client = useMemo(getAdminClient, []);
	const identity = useAdminQuery("preset-packs:identity", (signal) => client.identity(signal));
	const [selectedResourceKeys, setSelectedResourceKeys] = useState(() => new Map<string, string[]>());
	const [viewing, setViewing] = useState<(PresetPackResourceTarget & { revision: number }) | null>(null);
	const [detailOpen, setDetailOpen] = useState(false);
	const detailSequence = useRef(0);
	const [attempt, setAttempt] = useState(0);
	const request = useRef<AbortController | null>(null);
	const groups = groupPresetPackResources(query.data?.sessions ?? []);
	const selectedCount = groups.reduce((total, group) => {
		const selected = new Set(selectedResourceKeys.get(group.type));
		return total + group.rows.filter((resource) => selected.has(resource.key)).length;
	}, 0);
	const importing = useAdminMutation(async () => {
		const resources: PresetPackCreateInput["resources"] = [];
		for (const group of groups) {
			for (const row of group.rows) {
				if (!selectedResourceKeys.get(group.type)?.includes(row.key)) continue;
				if (!row.id) throw new Error("所选资源缺少可复用的 ID，请取消选择后重试");
				resources.push({ type: group.type, resource_id: row.id });
			}
		}
		const controller = new AbortController();
		request.current = controller;
		const prepared = await adminApi.presetPacks.preview(
			{ remote_agent_id: agentId, agent_version: agent.version, resources },
			controller.signal,
		);
		if (!controller.signal.aborted) onImport(prepared);
	});
	useEffect(() => () => request.current?.abort(), []);
	useEffect(() => {
		onPendingChange(importing.pending || detailOpen);
		return () => {
			onPendingChange(false);
		};
	}, [importing.pending, detailOpen, onPendingChange]);
	const selectResource = (type: string, key: string, selected: boolean) => {
		setSelectedResourceKeys((current) => selectPresetPackResource(current, type, key, selected));
	};
	const loading = query.loading || !query.data || importing.pending;
	const loadError = query.error ?? identity.error;
	if (loadError)
		return (
			<Result
				status="error"
				title="运行时资源加载失败"
				subTitle={loadError}
				extra={<Button onClick={() => void Promise.allSettled([query.refresh(), identity.refresh()])}>重试</Button>}
			/>
		);
	return (
		<section aria-label="运行时资源" className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<h2 className="text-base font-medium">运行时资源</h2>
				<span role="status" aria-label="已选运行时资源" className="text-sm">
					已选择 {selectedCount} 个资源
				</span>
			</div>
			{query.data && !query.data.complete ? (
				<Alert
					type="warning"
					showIcon
					title="部分运行时资源未完整读取"
					description="当前仅展示成功读取的资源，可重新读取补齐。"
					action={
						<Button disabled={importing.pending} onClick={() => void query.refresh()}>
							重新读取
						</Button>
					}
				/>
			) : null}
			{!groups.length ? <ResourceEmptyState loading={loading} complete={query.data?.complete} /> : null}
			{groups.map((group) => (
				<ResourceGroupTable
					key={group.type}
					group={group}
					selectedKeys={selectedResourceKeys.get(group.type) ?? []}
					loading={loading}
					disabled={loading || detailOpen}
					complete={Boolean(query.data?.complete)}
					onView={(resource) => {
						setViewing({ type: group.type, resource, revision: ++detailSequence.current });
						setDetailOpen(true);
					}}
					onRemove={(key) => selectResource(group.type, key, false)}
				/>
			))}
			{viewing ? (
				<PresetPackResourceDetailDrawer
					key={`${viewing.type}:${viewing.resource.key}:${viewing.revision}`}
					target={viewing}
					open={detailOpen}
					selected={selectedResourceKeys.get(viewing.type)?.includes(viewing.resource.key) ?? false}
					selectedCount={selectedResourceKeys.get(viewing.type)?.length ?? 0}
					onClose={() => setDetailOpen(false)}
					onAfterClose={() => setViewing((current) => (current?.revision === viewing.revision ? null : current))}
					onSelect={() => {
						selectResource(viewing.type, viewing.resource.key, true);
						setDetailOpen(false);
					}}
				/>
			) : null}
			<ResourceSelectionSlot container={feedbackContainer}>
				{importing.error ? (
					<Alert
						key={attempt}
						type="error"
						showIcon
						closable
						title="运行时资源导入失败"
						description={importing.error}
					/>
				) : null}
			</ResourceSelectionSlot>
			<ResourceSelectionSlot container={actionContainer}>
				<div className="flex justify-end">
					<Button
						type="primary"
						loading={importing.pending}
						disabled={
							loading || detailOpen || identity.data?.role !== "admin" || (requireSelection && selectedCount === 0)
						}
						onClick={() => {
							setAttempt((value) => value + 1);
							void importing.run().catch(() => undefined);
						}}
					>
						{actionLabel}
					</Button>
				</div>
			</ResourceSelectionSlot>
		</section>
	);
}
