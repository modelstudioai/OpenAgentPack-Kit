import type { RemoteAgentVersionDetail } from "@openagentpack/kit-sdk/protocol";
import { Button } from "antd";
import { type ReactNode, useId, useState } from "react";
import {
	configList,
	configObject,
	configText,
	type VersionMcpServer,
	type VersionToolkit,
	versionMcpServers,
	versionToolkits,
} from "./agent-version-configuration.ts";
import styles from "./template-forms.module.less";

/** 启用状态徽标：base + 启用/禁用色（原为 cva，拆为组合类）。 */
function badgeClass(enabled?: boolean) {
	return enabled === undefined || enabled ? styles.badge : `${styles.badge} ${styles.badgeOff}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section aria-label={title} className={styles.configSection}>
			<h4 className={title === "版本" ? styles.sectionTitlePlain : styles.sectionTitleMed}>{title}</h4>
			{children}
		</section>
	);
}

function Text({ children }: { children?: ReactNode }) {
	return <p className={styles.plainText}>{children || "未配置"}</p>;
}

function Value({ label, value }: { label: string; value: unknown }) {
	const text = typeof value === "boolean" ? (value ? "开启" : "关闭") : configText(value);
	if (text === undefined) return null;
	return (
		<div className={styles.fieldStack}>
			<dt className={styles.mutedOnly}>{label}</dt>
			<dd className={styles.wrapAnywhere}>{text}</dd>
		</div>
	);
}

function Model({ value }: { value: unknown }) {
	const model = configObject(value);
	const provider = model.bailian;
	const fields = provider && typeof provider === "object" ? configObject(provider) : model;
	const name = configText(fields.name) ?? configText(fields.id) ?? configText(provider) ?? configText(value);
	if (!name) return <Text>未配置模型</Text>;
	return (
		<div className={styles.modelBox}>
			<p className={styles.nameAny}>{name}</p>
		</div>
	);
}

function enabledLabel(value?: boolean) {
	return value === undefined ? "未提供" : value ? "已启用" : "已禁用";
}

function sourceLabel(value: string) {
	if (value === "official") return "官方";
	if (["custom", "customer", "url", "http"].includes(value)) return "自定义";
	return value;
}

function Toolkit({ value, title = value.title }: { value: VersionToolkit; title?: string }) {
	const [expanded, setExpanded] = useState(true);
	const contentId = useId();
	return (
		<section aria-label={`${title}配置`} className={styles.toolkitCard}>
			<div className={styles.toolkitHeader}>
				<div className={styles.headRow}>
					<h5 className={styles.nameAny}>{title}</h5>
					<span className={badgeClass()}>{value.tools.length} 项配置</span>
				</div>
				<Button
					size="small"
					aria-label={`${expanded ? "收起" : "展开"}${title}工具配置`}
					aria-expanded={expanded}
					aria-controls={contentId}
					onClick={() => setExpanded((current) => !current)}
				>
					{expanded ? "收起" : "展开"}
				</Button>
			</div>
			<dl className={styles.toolkitGrid}>
				<Value label="默认启用状态" value={enabledLabel(value.defaultEnabled)} />
				<Value label="默认审批策略" value={value.defaultPermission} />
			</dl>
			<div id={contentId} hidden={!expanded} className={styles.toolkitBody}>
				{value.tools.length ? (
					<table aria-label={`${title}工具配置`} className={styles.toolkitTable}>
						<thead className={styles.toolkitThead}>
							<tr>
								<th scope="col" className={styles.toolkitTh}>
									工具名称
								</th>
								<th scope="col" className={styles.toolkitTh25}>
									启用状态
								</th>
								<th scope="col" className={styles.toolkitTh25}>
									审批策略
								</th>
							</tr>
						</thead>
						<tbody className={styles.toolkitTbody}>
							{value.tools.map((tool) => (
								<tr key={tool.name} className={styles.toolkitTr}>
									<th scope="row" className={styles.toolkitRowHead}>
										<span className={styles.blockMedium}>{tool.name}</span>
										{tool.description ? <span className={styles.blockMuted}>{tool.description}</span> : null}
									</th>
									<td className={styles.toolkitTd}>
										<span aria-hidden="true" className={styles.toolkitTdLabel}>
											启用状态
										</span>
										<span className={badgeClass(tool.enabled === true)}>{enabledLabel(tool.enabled)}</span>
										{tool.inheritedEnabled ? <span className={styles.toolkitInherit}>跟随默认</span> : null}
									</td>
									<td className={styles.toolkitTdAny}>
										<span aria-hidden="true" className={styles.toolkitTdLabel}>
											审批策略
										</span>
										{tool.permission}
										{tool.inheritedPermission ? <span className={styles.toolkitInherit}>跟随默认</span> : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<div className={styles.toolkitEmpty}>
						<Text>未单独配置工具，按默认设置执行</Text>
					</div>
				)}
			</div>
		</section>
	);
}

function McpServer({ server }: { server: VersionMcpServer }) {
	return (
		<article aria-label={server.name} className={styles.mcpCard}>
			<div className={styles.entryRow}>
				<h5 className={`${styles.shrinkRoot} ${styles.nameAny}`}>{server.name}</h5>
				{server.type ? <span className={badgeClass()}>{sourceLabel(server.type)}</span> : null}
			</div>
			{server.description ? <Text>{server.description}</Text> : null}
			<dl className={`${styles.stack2} ${styles.textXs}`}>
				{server.code !== server.name ? <Value label="服务标识" value={server.code} /> : null}
				<Value label="服务地址" value={server.url} />
				<Value label="连接协议" value={server.protocol} />
			</dl>
			{server.toolkit ? <Toolkit value={server.toolkit} title={server.name} /> : <Text>未提供工具配置</Text>}
		</article>
	);
}

function Skills({ value }: { value: unknown }) {
	const skills = configList(value);
	if (!skills.length) return <Text>未配置技能</Text>;
	return (
		<ul aria-label="技能列表" className={styles.skillList}>
			{skills.map((entry, index) => {
				const skill = configObject(entry);
				const id = configText(skill.skill_id ?? skill.skillId ?? skill.id ?? entry);
				const name =
					[skill.name, skill.skill_name, skill.skillName].map(configText).find((name) => name && name !== id) ??
					id ??
					"技能";
				const version = configText(skill.version);
				const type = configText(skill.type);
				return (
					<li
						key={`${id ?? name}:${version ?? ""}:${index}`}
						title={configText(skill.description)}
						className={styles.skillChip}
					>
						<span className={styles.nameAny}>{name}</span>
						{version ? <span className={styles.mutedOnly}>@{version}</span> : null}
						{type ? <span className={styles.metaText}>{sourceLabel(type)}</span> : null}
					</li>
				);
			})}
		</ul>
	);
}

export function AgentVersionConfigurationView({
	detail,
	versionLabel,
	nameContent,
	versionContent,
	placeholder,
}: {
	detail?: Pick<RemoteAgentVersionDetail, "name" | "description" | "configuration">;
	versionLabel?: string;
	nameContent?: ReactNode;
	versionContent?: ReactNode;
	placeholder?: string;
}) {
	return (
		<div className={styles.shrinkRoot}>
			<Section title="名称">{nameContent ?? <Text>{detail?.name}</Text>}</Section>
			{versionContent || versionLabel ? (
				<Section title="版本">{versionContent ?? <Text>{versionLabel}</Text>}</Section>
			) : null}
			{placeholder || !detail ? (
				["模型", "描述", "系统提示词", "工具", "MCP 服务器", "技能"].map((title) => (
					<Section key={title} title={title}>
						<Text>{placeholder ?? "请选择智能体"}</Text>
					</Section>
				))
			) : (
				<ConfigurationFields detail={detail} />
			)}
		</div>
	);
}

function ConfigurationFields({ detail }: { detail: Pick<RemoteAgentVersionDetail, "description" | "configuration"> }) {
	const config = detail.configuration;
	const tools = versionToolkits(config.tools).filter((toolkit) => toolkit.kind !== "mcp");
	const servers = versionMcpServers(config.mcp_servers, config.tools);
	const multiagent = configObject(config.multiagent);
	const members = configList(multiagent.agents);
	const multiagentEnabled =
		config.multiagent != null &&
		!(multiagent.type === "coordinator" && Array.isArray(multiagent.agents) && members.length === 0);
	return (
		<>
			<Section title="模型">
				<Model value={config.model} />
			</Section>
			<Section title="Multi-Agent 模式">
				{multiagentEnabled ? (
					<div className={styles.stack2}>
						<p>协调 Agent</p>
						<ul aria-label="子 Agent 配置" className={styles.stack2}>
							{members.map((member) => {
								const value = configObject(member);
								const id =
									configText(value.agent_id ?? value.id ?? member) ??
									(value.type === "self" ? "Self" : "无法识别的子 Agent");
								return (
									<li key={id} className={styles.wrapAnywhere}>
										{id}
										{value.version != null ? ` · 版本 ${configText(value.version)}` : ""}
									</li>
								);
							})}
						</ul>
					</div>
				) : (
					<Text>未开启</Text>
				)}
			</Section>
			<Section title="描述">
				<Text>{detail.description}</Text>
			</Section>
			<Section title="系统提示词">
				<div className={styles.instructionsBox}>
					<Text>{config.instructions}</Text>
				</div>
			</Section>
			<Section title="工具">
				{tools.length ? (
					<div className={styles.blockStack}>
						{tools.map((toolkit) => (
							<Toolkit key={toolkit.id} value={toolkit} />
						))}
					</div>
				) : (
					<Text>未配置工具</Text>
				)}
			</Section>
			<Section title="MCP 服务器">
				{servers.length ? (
					<div className={styles.blockStack}>
						{servers.map((server) => (
							<McpServer key={server.id} server={server} />
						))}
					</div>
				) : (
					<Text>未配置 MCP 服务器</Text>
				)}
			</Section>
			<Section title="技能">
				<Skills value={config.skills} />
			</Section>
		</>
	);
}
