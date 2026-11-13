import type { RemoteEnvironmentDetail } from "@openagentpack/kit-sdk/protocol";
import type { ReactNode } from "react";

import styles from "./template-resources.module.less";

const tagToneClass = {
	neutral: styles.tagNeutral,
	ready: styles.tagReady,
	building: styles.tagBuilding,
} as const;

/** 原为 cva 定义；变体拆为 module 组合类，调用形态保持 tagClass(tone) 不变。 */
function tagClass(tone: keyof typeof tagToneClass = "neutral") {
	return `${styles.tag} ${tagToneClass[tone]}`;
}

const packageManagers = ["apt", "npm", "pip", "go", "cargo", "gem"] as const;
const timeUnits = [
	[31_536_000, "year"],
	[2_592_000, "month"],
	[86_400, "day"],
	[3_600, "hour"],
	[60, "minute"],
] as const;

function updatedAtLabel(value?: string) {
	if (!value) return undefined;
	const timestamp = new Date(value).getTime();
	if (!Number.isFinite(timestamp)) return undefined;
	const seconds = (timestamp - Date.now()) / 1_000;
	const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
	for (const [size, unit] of timeUnits) {
		if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
	}
	return "刚刚";
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section aria-label={title} className={styles.envSection}>
			<h3 className={styles.sectionLabel}>{title}</h3>
			{children}
		</section>
	);
}

function DetailRows({ rows }: { rows: { key: string; label: string; value: string }[] }) {
	return (
		<dl className={styles.rowsList}>
			{rows.map((row) => (
				<div key={row.key} className={styles.rowGrid}>
					<dt className={styles.rowLabel}>{row.label}</dt>
					<dd className={styles.rowValue}>{row.value}</dd>
				</div>
			))}
		</dl>
	);
}

function Networking({ detail }: { detail: RemoteEnvironmentDetail }) {
	const networking = detail.configuration.networking;
	const mode = detail.copy_restricted_fields?.includes("configuration.networking")
		? "当前配置无法完整展示"
		: networking?.type === "unrestricted"
			? "不限制访问"
			: networking?.type === "limited"
				? "限制访问"
				: "使用默认策略";
	const access = (value?: boolean) => (value === undefined ? "使用默认设置" : value ? "允许" : "不允许");
	const rows = [{ key: "type", label: "访问模式", value: mode }];
	if (networking?.type === "limited")
		rows.push(
			{ key: "mcp", label: "MCP 服务访问", value: access(networking.allow_mcp_servers) },
			{ key: "packages", label: "包管理器访问", value: access(networking.allow_package_managers) },
			{ key: "hosts", label: "允许访问的主机", value: networking.allowed_hosts?.join("\n") || "未配置" },
		);
	return (
		<DetailSection title="网络策略">
			<DetailRows rows={rows} />
		</DetailSection>
	);
}

/** 与创建页使用同一环境合同，展示概览、网络策略、预装包和元数据。 */
export function EnvironmentDetailView({ detail }: { detail: RemoteEnvironmentDetail }) {
	const type = detail.configuration.type;
	const hostingLabel = type === "cloud" ? "云端" : type === "self_hosted" ? "本地" : undefined;
	const updatedAt = updatedAtLabel(detail.updated_at);
	const packages = packageManagers.flatMap((manager) =>
		[
			...new Set(
				(detail.configuration.packages?.[manager] ?? []).flatMap((value) => value.split(/\s+/)).filter(Boolean),
			),
		].map((value) => ({ key: `${manager}:${value}`, label: manager, value })),
	);
	const metadata = Object.entries(detail.metadata ?? {}).map(([key, value]) => ({
		key,
		label: key,
		value: value === "[redacted]" ? "已隐藏" : value,
	}));
	return (
		<div className={styles.envDetailRoot}>
			<div className={styles.detailHead}>
				<div className={styles.headRow}>
					<h3 className={styles.envDetailName}>{detail.name}</h3>
					{hostingLabel ? <span className={tagClass()}>{hostingLabel}</span> : null}
					{detail.package_status ? (
						<span className={tagClass(detail.package_status)}>
							{detail.package_status === "ready" ? "活跃" : "准备中"}
						</span>
					) : null}
				</div>
				<p className={styles.detailMeta}>
					{detail.environment_id}
					{updatedAt ? <span title={detail.updated_at}> · 最后更新于 {updatedAt}</span> : null}
				</p>
				{detail.description ? <p className={styles.detailDesc}>{detail.description}</p> : null}
			</div>
			<Networking detail={detail} />
			{type === "cloud" ? (
				<DetailSection title="预装包">
					{packages.length ? <DetailRows rows={packages} /> : <p className={styles.detailMeta}>未配置预装包</p>}
				</DetailSection>
			) : null}
			<DetailSection title="元数据">
				{metadata.length ? <DetailRows rows={metadata} /> : <p className={styles.detailMeta}>无元数据</p>}
			</DetailSection>
		</div>
	);
}
