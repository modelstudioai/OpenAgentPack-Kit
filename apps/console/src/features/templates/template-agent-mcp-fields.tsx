import { Button, Checkbox, Input } from "antd";
import { type AgentMcpDraft, createMcpDraft, mcpDraftErrors } from "./template-agent-mcp-draft.ts";
import styles from "./template-forms.module.less";

type Props = { value: AgentMcpDraft[]; onChange: (value: AgentMcpDraft[]) => void; disabled: boolean };

/** MCP 只编辑页面草稿，下一步才生成本地 SDK 声明；标题由外层折叠卡提供。 */
export function TemplateAgentMcpFields({ value, onChange, disabled }: Props) {
	const errors = mcpDraftErrors(value);
	return (
		<div className={styles.mcpRoot}>
			<div className={styles.mcpHeader}>
				<p className={styles.mcpIntro}>填写官方 MCP 的服务标识，最多添加 50 个。默认设置适用于未单独配置的工具。</p>
				<Button
					size="small"
					disabled={disabled || value.length >= 50}
					onClick={() => onChange([...value, createMcpDraft()])}
				>
					添加 MCP
				</Button>
			</div>
			{value.length ? (
				<fieldset aria-label="MCP 配置列表" className={styles.mcpList}>
					{value.map((server) => (
						<McpFields
							key={server.id}
							server={server}
							errors={errors}
							disabled={disabled}
							onChange={(next) => onChange(value.map((item) => (item.id === server.id ? next : item)))}
							onRemove={() => onChange(value.filter((item) => item.id !== server.id))}
						/>
					))}
				</fieldset>
			) : (
				<p className={styles.metaText}>暂未添加 MCP</p>
			)}
		</div>
	);
}

function McpFields({
	server,
	onChange,
	onRemove,
	disabled,
	errors,
}: {
	server: AgentMcpDraft;
	onChange: (value: AgentMcpDraft) => void;
	onRemove: () => void;
	disabled: boolean;
	errors: Map<string, string>;
}) {
	const nameId = `mcp-name-${server.id}`;
	const serviceError = server.name.trim() ? errors.get(server.id) : undefined;
	return (
		<fieldset aria-label="MCP 配置" disabled={disabled} className={styles.serverCard}>
			<div className={styles.removeRow}>
				<Button size="small" aria-label={`移除 MCP ${server.name || "配置"}`} onClick={onRemove}>
					移除
				</Button>
			</div>
			<div className={styles.fieldBlock}>
				<label htmlFor={nameId}>
					服务标识
					<span aria-hidden="true" className={styles.requiredStar}>
						*
					</span>
				</label>
				<Input
					id={nameId}
					required
					maxLength={200}
					placeholder="输入官方 MCP 服务标识"
					value={server.name}
					status={serviceError ? "error" : undefined}
					aria-describedby={serviceError ? `${nameId}-error` : undefined}
					onChange={(event) => onChange({ ...server, name: event.target.value })}
				/>
				{serviceError ? (
					<p id={`${nameId}-error`} role="alert" className={styles.errorText}>
						{serviceError}
					</p>
				) : null}
			</div>
			<Checkbox
				checked={server.defaultEnabled}
				onChange={(event) => onChange({ ...server, defaultEnabled: event.target.checked })}
			>
				默认启用工具
			</Checkbox>
			<div className={styles.toolsSection}>
				<div className={styles.mcpHeader}>
					<span>单工具配置（可选）</span>
					<Button
						size="small"
						disabled={server.tools.length >= 200}
						onClick={() =>
							onChange({ ...server, tools: [...server.tools, { id: crypto.randomUUID(), name: "", enabled: true }] })
						}
					>
						添加工具配置
					</Button>
				</div>
				{server.tools.length ? (
					server.tools.map((tool) => (
						<div key={tool.id} className={styles.toolRow}>
							<div className={styles.toolRowMain}>
								<div className={`${styles.fieldBlock} ${styles.fieldBlockFlex}`}>
									<label htmlFor={`mcp-tool-${tool.id}`}>
										工具名称
										<span aria-hidden="true" className={styles.requiredStar}>
											*
										</span>
									</label>
									<Input
										id={`mcp-tool-${tool.id}`}
										required
										maxLength={200}
										value={tool.name}
										status={errors.has(tool.id) ? "error" : undefined}
										aria-describedby={errors.has(tool.id) ? `mcp-tool-${tool.id}-error` : undefined}
										onChange={(event) =>
											onChange({
												...server,
												tools: server.tools.map((item) =>
													item.id === tool.id ? { ...item, name: event.target.value } : item,
												),
											})
										}
									/>
								</div>
								<Checkbox
									className={styles.toolCheckbox}
									checked={tool.enabled}
									onChange={(event) =>
										onChange({
											...server,
											tools: server.tools.map((item) =>
												item.id === tool.id ? { ...item, enabled: event.target.checked } : item,
											),
										})
									}
								>
									启用
								</Checkbox>
								<Button
									size="small"
									className={styles.removeButton}
									aria-label={`移除工具配置 ${tool.name || "未命名"}`}
									onClick={() => onChange({ ...server, tools: server.tools.filter((item) => item.id !== tool.id) })}
								>
									移除
								</Button>
							</div>
							{errors.has(tool.id) ? (
								<p id={`mcp-tool-${tool.id}-error`} role="alert" className={styles.errorText}>
									{errors.get(tool.id)}
								</p>
							) : null}
						</div>
					))
				) : (
					<p className={styles.metaText}>未配置时，所有工具使用默认启用设置。</p>
				)}
			</div>
		</fieldset>
	);
}
