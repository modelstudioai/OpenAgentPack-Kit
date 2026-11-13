import type { AuditLogView } from "@openagentpack/kit-sdk/protocol";
import type { TableColumnsType } from "antd";
import { Button, Empty, Result, Table } from "antd";
import { useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi } from "../../lib/api.ts";

const actionLabels: Record<string, string> = {
	"templates.create": "新建智能体",
	"templates.update": "编辑智能体",
	"templates.delete": "删除智能体",
	"templates.listing": "上架智能体",
	"catalog.create": "新建智能体",
	"catalog.update": "编辑智能体",
	"catalog.delete": "删除智能体",
	"catalog.list": "上架智能体",
	"catalog.unlist": "下架智能体",
	"branding.update": "更新品牌配置",
};

function detailOf(row: AuditLogView): { name?: string; version?: number } {
	try {
		const detail: unknown = JSON.parse(row.detail ?? "null");
		if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
		return {
			name: "name" in detail && typeof detail.name === "string" ? detail.name : undefined,
			version: "version" in detail && typeof detail.version === "number" ? detail.version : undefined,
		};
	} catch {
		return {};
	}
}

const columns: TableColumnsType<AuditLogView> = [
	{
		title: "操作时间",
		dataIndex: "at",
		width: 190,
		render: (at: string) => <time dateTime={at}>{new Date(at).toLocaleString("zh-CN", { hour12: false })}</time>,
	},
	{ title: "操作", dataIndex: "action", width: 160, render: (action: string) => actionLabels[action] ?? action },
	{
		title: "操作对象",
		key: "target",
		width: 280,
		render: (_, row) => {
			const detail = detailOf(row);
			return (
				<div className="break-words">
					{detail.name ? <p>{detail.name}</p> : null}
					<p className="text-xs text-neutral-500">{row.target ?? "全局配置"}</p>
					{detail.version !== undefined ? <p className="text-xs text-neutral-500">配置版本 v{detail.version}</p> : null}
				</div>
			);
		},
	},
];

export function OperationsPage() {
	const [page, setPage] = useState(1);
	const pageSize = 20;
	const logs = useAdminQuery(`audit:${page}`, (signal) =>
		adminApi.audit.list({ limit: pageSize, offset: (page - 1) * pageSize }, signal),
	);
	return (
		<section aria-label="操作日志" className="space-y-4">
			<p className="text-sm text-neutral-500">
				仅记录当前管理员对智能体的新建、编辑、删除、上架、下架及员工端品牌配置的修改。
			</p>
			{logs.error ? (
				<Result
					status="error"
					title="操作日志加载失败"
					subTitle={logs.error}
					extra={
						<Button aria-label="重试" onClick={() => void logs.refresh()}>
							重试
						</Button>
					}
				/>
			) : (
				<Table<AuditLogView>
					rowKey="id"
					columns={columns}
					dataSource={logs.data?.data ?? []}
					loading={logs.loading || !logs.data}
					scroll={{ x: 630 }}
					locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无操作记录" /> }}
					pagination={{
						current: page,
						pageSize,
						total: logs.data?.total ?? 0,
						showSizeChanger: false,
						hideOnSinglePage: true,
						showTotal: (total) => `共 ${total} 条操作记录`,
						onChange: setPage,
					}}
				/>
			)}
		</section>
	);
}
