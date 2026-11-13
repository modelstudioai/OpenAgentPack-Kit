import type { PublicationReport } from "@openagentpack/kit-sdk/protocol";
import { Table } from "antd";

const statuses = { succeeded: "已成功", failed: "未执行成功", skipped: "已跳过", unknown: "结果待核对" };
const types = {
	agent: "智能体",
	environment: "环境",
	skill: "Skill",
	file: "文件",
	memory_store: "记忆库",
	vault: "密钥库",
};

/** 展示执行事实；允许的恢复动作由批次接口决定。 */
export function TemplatePublicationReport({ report }: { report: PublicationReport }) {
	return (
		<section aria-label="资源发布结果" className="space-y-2 animate-(--kit-animate-in)">
			<p>
				{report.outcome === "succeeded" ? "资源执行已完成。" : "资源执行未全部完成，请核对以下结果。"}
				完整发布状态以成功回执为准。
			</p>
			<Table
				size="small"
				pagination={false}
				rowKey={(resource) => `${resource.type}:${resource.id}`}
				dataSource={report.resources}
				scroll={{ x: true }}
				columns={[
					{ title: "资源", render: (_, resource) => `${types[resource.type]} · ${resource.id}` },
					{ title: "结果", render: (_, resource) => statuses[resource.status] },
					{
						title: "已知远端身份",
						render: (_, resource) =>
							resource.remote_id ? `${resource.remote_id}${resource.version ? ` · v${resource.version}` : ""}` : "—",
					},
					{
						title: "错误",
						render: (_, resource) =>
							resource.error_details ? `${resource.error_details.code}（${resource.error_details.phase}）` : "—",
					},
				]}
			/>
		</section>
	);
}
