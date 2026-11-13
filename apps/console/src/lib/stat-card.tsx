import type { ReactNode } from "react";

import styles from "./stat-card.module.less";

/** 单个统计项：小标签 + 大号数字（缺失显示 missingText，不按 0 计算）+ 可选单位与说明。 */
export function StatCell({
	label,
	value,
	unit,
	hint,
	missingText = "待获取",
}: {
	label: string;
	value: number | null;
	unit?: string;
	hint?: string;
	/** 缺失占位文案；已采集但 Provider 未返回的指标可用「未返回」与「待获取」区分。 */
	missingText?: string;
}) {
	return (
		<div className={styles.cellRoot}>
			<dt className={styles.cellLabel}>{label}</dt>
			{value === null ? (
				<dd className={styles.cellMissing}>{missingText}</dd>
			) : (
				<dd className={styles.cellValue}>
					{value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
					{unit ? <span className={styles.cellUnit}>{unit}</span> : null}
				</dd>
			)}
			{hint ? <dd className={styles.cellHint}>{hint}</dd> : null}
		</div>
	);
}

/** 浅色统计卡；tone 在两种浅色 token 间交替形成蓝/灰节奏（对齐参考稿）。 */
export function StatCard({
	tone,
	className,
	children,
}: {
	tone: "tint" | "subtle";
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={`${styles.card} ${tone === "tint" ? styles.cardTint : styles.cardSubtle} ${className ?? ""}`}>
			{children}
		</div>
	);
}
