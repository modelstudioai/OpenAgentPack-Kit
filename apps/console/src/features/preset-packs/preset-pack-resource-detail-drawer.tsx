import type {
	MemoryStoreConfiguration,
	RemoteEnvironmentDetail,
	RemoteFile,
	RemoteVaultDetail,
} from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Descriptions, Drawer, Result, Spin } from "antd";
import { useMemo } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi, getAdminClient } from "../../lib/api.ts";
import { EnvironmentDetailView } from "../templates/environment-detail-view.tsx";
import { TemplateMemoryEntryList } from "../templates/template-memory-entry-list.tsx";
import { TemplateVaultDetailView } from "../templates/template-vault-detail-drawer.tsx";
import {
	loadPresetPackMemoryConfiguration,
	type PresetPackMemoryConfiguration,
} from "./preset-pack-memory-configuration.ts";
import type { PresetPackResourceRow } from "./preset-pack-resource-groups.ts";
import { presetPackResourceSelectionLimit } from "./preset-pack-resource-selection.ts";

const resourceLabels: Record<string, string> = {
	environment: "环境",
	file: "文件",
	memory_store: "记忆库",
	vault: "密钥库",
};
type Configuration =
	| { type: "environment"; detail: RemoteEnvironmentDetail }
	| { type: "file"; detail: RemoteFile }
	| { type: "memory_store"; detail: PresetPackMemoryConfiguration }
	| { type: "vault"; detail: RemoteVaultDetail };

export interface PresetPackResourceTarget {
	type: string;
	resource: PresetPackResourceRow;
}

function useResourceConfiguration(target: PresetPackResourceTarget, enabled: boolean) {
	const client = useMemo(getAdminClient, []);
	const { type, resource } = target;
	return useAdminQuery<Configuration>(
		`preset-pack-configuration:${type}:${resource.key}`,
		async (signal) => {
			const id = resource.id;
			if (!id) throw new Error("资源缺少可用的 ID，请重新读取资源列表");
			switch (type) {
				case "environment":
					return { type, detail: await client.remoteEnvironment(id, signal) };
				case "memory_store":
					return {
						type,
						detail: await loadPresetPackMemoryConfiguration(
							id,
							signal,
							client.remoteMemoryStoreConfiguration,
							adminApi.remoteMemoryStores,
						),
					};
				case "vault":
					return { type, detail: await client.remoteVault(id, signal) };
				case "file": {
					const detail = (await adminApi.remoteFiles(signal)).find((file) => file.file_id === id);
					if (!detail) throw new Error("文件不存在或不可访问，请重新读取资源列表");
					if (!detail.available) throw new Error("文件暂不可用，请稍后重试");
					return { type, detail };
				}
				default:
					throw new Error("此类型暂不支持关联");
			}
		},
		{ enabled },
	);
}

function ResourceBindings({ resource }: { resource: PresetPackResourceRow }) {
	return (
		<Descriptions
			column={1}
			size="small"
			items={[
				{ key: "id", label: "资源 ID", children: resource.id || "—" },
				{ key: "mount", label: "挂载路径", children: resource.mountPaths.join("、") || "—" },
				{
					key: "access",
					label: "权限",
					children: resource.accesses.map((access) => (access === "read_only" ? "只读" : "读写")).join("、") || "—",
				},
				{
					key: "source",
					label: "来源",
					children: resource.sources.map((source) => (source === "runtime" ? "运行时挂载" : "会话配置")).join("、"),
				},
			]}
		/>
	);
}

function MemoryConfiguration({ detail }: { detail: MemoryStoreConfiguration }) {
	return (
		<div className="space-y-4">
			<Descriptions
				column={1}
				size="small"
				items={[
					{ key: "name", label: "名称", children: detail.name },
					{ key: "description", label: "描述", children: detail.description || "未配置" },
				]}
			/>
			<section aria-label="记忆条目" className="space-y-4">
				<h3 className="text-sm font-medium">记忆条目（{detail.entries.length}）</h3>
				<TemplateMemoryEntryList value={detail.entries.map((entry) => ({ ...entry, id: entry.key }))} />
			</section>
			{detail.copy_restricted_fields?.length ? (
				<Alert type="info" showIcon title="部分配置已隐藏" description={detail.copy_restricted_fields.join("、")} />
			) : null}
		</div>
	);
}

function ConfigurationView({ configuration, onRetry }: { configuration: Configuration; onRetry: () => void }) {
	switch (configuration.type) {
		case "environment":
			return <EnvironmentDetailView detail={configuration.detail} />;
		case "vault":
			return <TemplateVaultDetailView detail={configuration.detail} />;
		case "memory_store":
			return configuration.detail.kind === "complete" ? (
				<MemoryConfiguration detail={configuration.detail.configuration} />
			) : (
				<div className="space-y-4">
					<Descriptions
						column={1}
						size="small"
						items={[{ key: "name", label: "名称", children: configuration.detail.store.name }]}
					/>
					<Alert
						type="warning"
						showIcon
						title="记忆条目未完整读取"
						description="已确认原库可用，可继续关联原库。记忆条目不会复制到当前配置。"
						action={<Button onClick={onRetry}>重新读取条目</Button>}
					/>
				</div>
			);
		case "file":
			return (
				<Descriptions
					column={1}
					size="small"
					items={[
						{ key: "filename", label: "文件名称", children: configuration.detail.filename },
						{
							key: "size",
							label: "文件大小",
							children:
								configuration.detail.size === undefined ? "—" : `${configuration.detail.size.toLocaleString()} 字节`,
						},
						{ key: "status", label: "状态", children: configuration.detail.status || "可用" },
					]}
				/>
			);
	}
}

function ResourceSelectionNotice({
	limit,
	selected,
	selectedCount,
	full,
	label,
}: {
	limit: number | undefined;
	selected: boolean;
	selectedCount: number;
	full: boolean;
	label: string;
}) {
	if (limit === 1 && !selected && selectedCount > 0)
		return <Alert type="info" showIcon title="环境仅可单选，确认选择将替换已选环境" />;
	if (!full) return null;
	return <Alert type="warning" showIcon title={`最多选择 ${limit} 个${label}，请先取消其他选择`} />;
}

/** 打开才读取配置；记忆条目不可读时核验原库供引用复用，其他失败不能确认选择。 */
export function PresetPackResourceDetailDrawer({
	target,
	open,
	selected,
	selectedCount,
	onClose,
	onAfterClose,
	onSelect,
}: {
	target: PresetPackResourceTarget;
	open: boolean;
	selected: boolean;
	selectedCount: number;
	onClose: () => void;
	onAfterClose: () => void;
	onSelect: () => void;
}) {
	const supported = Object.hasOwn(resourceLabels, target.type);
	const label = resourceLabels[target.type] || target.type;
	const readable = supported && Boolean(target.resource.id);
	const query = useResourceConfiguration(target, open && readable);
	const ready = readable && !query.loading && !query.error && Boolean(query.data);
	const limit = presetPackResourceSelectionLimit(target.type);
	const full = !selected && limit !== undefined && limit > 1 && selectedCount >= limit;
	return (
		<Drawer
			title={`${label}配置`}
			size="large"
			open={open}
			onClose={onClose}
			destroyOnHidden
			afterOpenChange={(visible) => {
				if (!visible) onAfterClose();
			}}
			footer={
				<div className="flex justify-end gap-2">
					<Button onClick={onClose}>取消</Button>
					<Button type="primary" disabled={!ready || selected || full} onClick={onSelect}>
						{selected ? "已选择" : "确认选择"}
					</Button>
				</div>
			}
		>
			<div className="space-y-4">
				<ResourceSelectionNotice
					limit={limit}
					selected={selected}
					selectedCount={selectedCount}
					full={full}
					label={label}
				/>
				<ResourceBindings resource={target.resource} />
				{!readable ? (
					<Alert type="warning" showIcon title={supported ? "资源缺少可用的 ID，无法选择" : "此类型暂不支持关联"} />
				) : query.error ? (
					<Result
						status="error"
						title="配置加载失败"
						subTitle={query.error}
						extra={<Button onClick={() => void query.refresh()}>重试</Button>}
					/>
				) : query.data ? (
					<ConfigurationView configuration={query.data} onRetry={() => void query.refresh()} />
				) : (
					<Spin aria-label="正在读取资源配置" />
				)}
			</div>
		</Drawer>
	);
}
