import type { PresetPackPreview } from "@openagentpack/kit-sdk/protocol";
import type { TableColumnsType } from "antd";
import { Button, Empty, Input, Result, Table } from "antd";
import { useCallback, useState } from "react";
import { type RemoteAgent, useRemoteAgents } from "../catalog/use-remote-agents.ts";
import { PresetPackSessionResources } from "./preset-pack-session-resources.tsx";

const columns: TableColumnsType<RemoteAgent> = [
	{
		title: "名称",
		dataIndex: "name",
		ellipsis: true,
		render: (name: string, agent) => name || agent.agent_id,
	},
	{ title: "ID", dataIndex: "agent_id", ellipsis: true },
	{
		title: "版本",
		dataIndex: "version",
		render: (version: number | undefined) => (version === undefined ? "—" : `v${version}`),
	},
];

/** 使用完整远端列表分页展示，不混入本地模版或未发布草稿。 */
export function PresetPackSelection({
	onImport,
	onPendingChange,
}: {
	onImport: (preset: PresetPackPreview) => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const agents = useRemoteAgents();
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const updatePending = useCallback(
		(pending: boolean) => {
			setImporting(pending);
			onPendingChange(pending);
		},
		[onPendingChange],
	);
	const selectedAgent = agents.data?.find((agent) => agent.agent_id === selectedAgentId);
	const rows = (agents.data ?? []).filter((agent) =>
		`${agent.name}\n${agent.agent_id}`.toLowerCase().includes(search.toLowerCase()),
	);
	return (
		<section aria-label="预设包选择" className="space-y-4">
			<section aria-label="智能体" className="space-y-4">
				<h2 className="text-base font-medium">智能体</h2>
				<Input.Search
					allowClear
					aria-label="搜索智能体"
					placeholder="搜索智能体名称或 ID"
					disabled={importing}
					onSearch={(value) => {
						setSearch(value.trim());
						setPage(1);
					}}
				/>
				{agents.error ? (
					<Result
						status="error"
						title="智能体列表加载失败"
						subTitle={agents.error}
						extra={<Button onClick={() => void agents.refresh()}>重试</Button>}
					/>
				) : (
					<Table<RemoteAgent>
						rowKey="agent_id"
						rowSelection={{
							type: "radio",
							selectedRowKeys: selectedAgentId ? [selectedAgentId] : [],
							onChange: (keys) => setSelectedAgentId(keys[0] === undefined ? null : String(keys[0])),
							getCheckboxProps: (agent) => ({
								"aria-label": `选择智能体 ${agent.name || agent.agent_id}（${agent.agent_id}）`,
								disabled: importing,
							}),
						}}
						columns={columns}
						dataSource={rows}
						loading={agents.loading || !agents.data}
						scroll={{ x: "max-content" }}
						locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无智能体" /> }}
						pagination={{
							current: page,
							onChange: setPage,
							pageSize: 10,
							showSizeChanger: false,
							showTotal: (total) => `共 ${total} 个智能体`,
						}}
					/>
				)}
			</section>
			{selectedAgent ? (
				<PresetPackSessionResources
					key={selectedAgent.agent_id}
					agent={selectedAgent}
					onPendingChange={updatePending}
					onImport={onImport}
				/>
			) : null}
		</section>
	);
}
