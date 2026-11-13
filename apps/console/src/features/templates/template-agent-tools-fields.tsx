import type { ProjectAgentCreateInput } from "@openagentpack/kit-sdk/protocol";
import { Checkbox, Select } from "antd";
import { formRowClass, formRowLabelClass } from "../../lib/form-row.ts";
import { BUILTIN_TOOLS } from "./template-agent-form-draft.ts";
import styles from "./template-forms.module.less";

type Tools = NonNullable<ProjectAgentCreateInput["tools"]>;
const canonicalToolName = (name: string) =>
	name
		.trim()
		.replace(/[^a-zA-Z0-9]+/g, "")
		.toLowerCase();

export function TemplateAgentToolsFields({ value, onChange }: { value?: Tools; onChange: (tools: Tools) => void }) {
	const tools: Tools = value ?? { builtin: [...BUILTIN_TOOLS] };
	const defaultPermission = tools.default_permission ?? "allow";
	const inheritedLabel = defaultPermission === "ask" ? "每次询问" : "总是允许";
	const names = [...new Set([...BUILTIN_TOOLS, ...tools.builtin])];
	const overrides = new Map(
		Object.entries(tools.permissions ?? {}).map(([name, permission]) => [canonicalToolName(name), permission]),
	);
	const changeEnabled = (name: string, enabled: boolean) => {
		const selected = new Set(tools.builtin);
		if (enabled) selected.add(name);
		else selected.delete(name);
		onChange({ ...tools, builtin: [...selected] });
	};
	const changePermission = (name: string, permission: string) => {
		const permissions = { ...tools.permissions };
		for (const key of Object.keys(permissions))
			if (canonicalToolName(key) === canonicalToolName(name)) delete permissions[key];
		if (permission === "allow" || permission === "ask") permissions[name] = permission;
		const { permissions: _, ...rest } = tools;
		onChange({ ...rest, ...(Object.keys(permissions).length ? { permissions } : {}) });
	};
	return (
		<section aria-label="工具" className={formRowClass}>
			<h4 className={`${formRowLabelClass} ${styles.toolsLabel}`}>工具</h4>
			<div className={styles.toolsBody}>
				<div className={styles.permissionRow}>
					<label htmlFor="agent-default-permission" className={styles.fieldLabel}>
						默认审批策略
					</label>
					<Select
						id="agent-default-permission"
						className={styles.permissionSelect}
						value={defaultPermission}
						onChange={(permission) => {
							if (permission === "allow" || permission === "ask")
								onChange({ ...tools, default_permission: permission });
						}}
						options={[
							{ value: "allow", label: "总是允许" },
							{ value: "ask", label: "每次询问" },
						]}
					/>
				</div>
				<p className={styles.toolsHint}>未单独设置的工具跟随默认审批策略。</p>
				<div className={styles.toolsTableWrap}>
					<table className={styles.toolsTable}>
						<caption className={styles.srOnly}>内置工具权限配置</caption>
						<thead className={styles.toolsTableHead}>
							<tr>
								{["工具名称", "启用", "权限控制"].map((label) => (
									<th key={label} scope="col" className={styles.toolsTableTh}>
										{label}
									</th>
								))}
							</tr>
						</thead>
						<tbody className={styles.toolsTableBody}>
							{names.map((name) => (
								<tr key={name}>
									<th scope="row" className={styles.toolsTableName}>
										{name}
									</th>
									<td className={styles.toolsTableCell}>
										<Checkbox
											aria-label={name}
											checked={tools.builtin.includes(name)}
											onChange={(event) => changeEnabled(name, event.target.checked)}
										/>
									</td>
									<td className={styles.toolsTableCell}>
										<Select
											aria-label={`${name} 权限控制`}
											className={styles.permissionCellSelect}
											value={overrides.get(canonicalToolName(name)) ?? "default"}
											disabled={!tools.builtin.includes(name)}
											onChange={(permission) => changePermission(name, permission)}
											options={[
												{ value: "default", label: `跟随默认（${inheritedLabel}）` },
												{ value: "allow", label: "总是允许" },
												{ value: "ask", label: "每次询问" },
											]}
										/>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}
