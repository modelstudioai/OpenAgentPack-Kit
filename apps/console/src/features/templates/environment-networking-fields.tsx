import { Input, Select } from "antd";
import { useId } from "react";
import type { EnvironmentCreateDraft } from "./template-environment-form-draft.ts";
import styles from "./template-resources.module.less";

const accessFields = [
	{ key: "allow_mcp_servers", label: "MCP 服务访问" },
	{ key: "allow_package_managers", label: "包管理器访问" },
] as const;

const modeOptions = [
	{ value: "", label: "使用默认策略" },
	{ value: "unrestricted", label: "不限制访问" },
	{ value: "limited", label: "限制访问" },
];
const accessOptions = [
	{ value: "", label: "使用默认设置" },
	{ value: "true", label: "允许" },
	{ value: "false", label: "不允许" },
];

export function EnvironmentNetworkingFields({
	value,
	onChange,
}: {
	value: EnvironmentCreateDraft;
	onChange: (next: EnvironmentCreateDraft) => void;
}) {
	const id = useId();
	const networking = value.networking;
	return (
		<section aria-label="网络策略" className={styles.netRoot}>
			<h3 className={styles.netHeading}>网络策略</h3>
			<div className={styles.fieldStack}>
				<label htmlFor={`${id}-mode`}>访问模式</label>
				<Select
					id={`${id}-mode`}
					aria-label="网络访问模式"
					className={styles.fullControl}
					value={networking?.type ?? ""}
					onChange={(type) => {
						if (!type) onChange({ ...value, networking: undefined, networkingHosts: undefined });
						else if (type === "unrestricted" || type === "limited")
							onChange({ ...value, networking: { ...networking, type } });
					}}
					options={modeOptions}
				/>
			</div>
			{networking?.type === "limited" ? (
				<div className={styles.limitedPanel}>
					<div className={styles.accessGrid}>
						{accessFields.map(({ key, label }) => (
							<div key={key} className={styles.fieldStack}>
								<label htmlFor={`${id}-${key}`}>{label}</label>
								<Select
									id={`${id}-${key}`}
									aria-label={label}
									className={styles.fullControl}
									value={networking[key] === undefined ? "" : String(networking[key])}
									onChange={(next) => {
										const updated = { ...networking };
										if (!next) delete updated[key];
										else updated[key] = next === "true";
										onChange({ ...value, networking: updated });
									}}
									options={accessOptions}
								/>
							</div>
						))}
					</div>
					<div className={styles.fieldStack}>
						<label htmlFor={`${id}-hosts`}>允许访问的主机</label>
						<Input.TextArea
							id={`${id}-hosts`}
							aria-label="允许访问的主机"
							aria-describedby={`${id}-hosts-hint`}
							rows={4}
							value={value.networkingHosts ?? networking.allowed_hosts?.join("\n") ?? ""}
							onChange={(event) => onChange({ ...value, networkingHosts: event.target.value })}
						/>
						<p id={`${id}-hosts-hint`} className={styles.hostsHint}>
							每行一个，或用逗号分隔。
						</p>
					</div>
				</div>
			) : null}
		</section>
	);
}
