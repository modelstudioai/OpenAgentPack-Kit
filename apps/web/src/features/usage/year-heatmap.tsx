import { ErrorState } from "@openagentpack/kit-chat-ui";
import type { ReactNode } from "react";
import { formatUsageDayStart } from "../../lib/beijing-time.ts";
import { formatExactTokenCount, formatTokenCount } from "../../lib/format-token-count.ts";

const numberText = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

/** 日键标注聚合区间的北京时间分界；不将日聚合数据重新分桶。 */
export function activityRange(days: { day: string }[]): string {
	const first = days.at(0);
	const last = days.at(-1);
	if (!first || !last) return "";
	return `统计 ${first.day} ~ ${last.day}（每日 08:00 起）`;
}

/** 卡片外壳与用量页其他卡同一套 token；标题行右侧放月份/统计范围等次要信息。 */
export function CardShell({
	title,
	hint,
	aside,
	children,
}: {
	title: string;
	/** 标题右侧的补充说明（如统计范围）。 */
	hint?: string;
	/** 卡片头部最右的附加内容（如图例）。 */
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="min-w-0 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-5 [overflow-wrap:anywhere] md:p-6">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<div className="flex min-w-0 flex-wrap items-baseline gap-2">
					<h3 className="text-[length:var(--kit-text-base)] font-semibold">{title}</h3>
					{hint ? (
						<span className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">{hint}</span>
					) : null}
				</div>
				{aside}
			</div>
			{children}
		</section>
	);
}

export function LoadingBody({ label }: { label: string }) {
	return (
		<p role="status" className="mt-5 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)]">
			{label}
		</p>
	);
}

export function HeatmapError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className="mt-4">
			<ErrorState message={message} onRetry={onRetry} />
		</div>
	);
}

/** 与 chat-ui ActivityHeatmap 同一套四级色阶：满档蓝走 --kit-heat，零档用 --kit-border。 */
const HEAT_LEVELS = [
	"bg-[var(--kit-border)]",
	"bg-[var(--kit-heat)]/30",
	"bg-[var(--kit-heat)]/60",
	"bg-[var(--kit-heat)]",
];

/** 年维度热力：近 53 周按周列排布（周一为首行），月份标注在月首列上方；色阶沿用 HEAT_LEVELS，hover 显示「日期 · 用量」。 */
export function YearHeatmap({
	days,
	testId = "usage-activity",
}: {
	days: { day: string; amount: number; unit: string }[];
	testId?: string;
}) {
	const max = days.reduce((m, d) => Math.max(m, d.amount), 0);
	const levelOf = (amount: number) => (amount <= 0 ? 0 : amount <= max / 3 ? 1 : amount <= (max * 2) / 3 ? 2 : 3);
	// 首格对齐周一行：前置空占位数 = 序列首日的 UTC 周几（周一 = 0）。
	const first = days.at(0);
	const offset = first ? (new Date(`${first.day}T00:00:00.000Z`).getUTCDay() + 6) % 7 : 0;
	const columns: { label: string | null; cells: ({ day: string; amount: number; unit: string } | null)[] }[] = [];
	for (let start = 0; start < days.length + offset; start += 7) {
		const cells = Array.from({ length: 7 }, (_, row): { day: string; amount: number; unit: string } | null => {
			const index = start + row - offset;
			return index >= 0 && index < days.length ? (days[index] ?? null) : null;
		});
		const first = cells.find((cell) => cell !== null);
		const month = first ? Number(first.day.slice(5, 7)) : null;
		const previousMonth = columns
			.at(-1)
			?.cells.find((cell) => cell !== null)
			?.day.slice(5, 7);
		const label = month !== null && Number(previousMonth ?? month) !== month ? `${month}月` : null;
		columns.push({ label, cells });
	}
	return (
		<div
			role="img"
			aria-label={`近 12 个月每日用量热力图（${days[0]?.day ?? ""} ~ ${days.at(-1)?.day ?? ""}，每日 08:00 起）`}
			data-testid={testId}
			className="mt-5 min-w-0"
		>
			<div className="flex flex-col gap-1">
				<div className="flex gap-[3px]" aria-hidden="true">
					{columns.map((column, index) => (
						<div key={index} className="relative h-4 min-w-0 flex-1">
							{column.label ? (
								<span className="absolute top-0 left-0 text-[10px] leading-4 whitespace-nowrap text-[var(--kit-fg-muted)]">
									{column.label}
								</span>
							) : null}
						</div>
					))}
				</div>
				<div className="flex gap-[3px]">
					{columns.map((column, index) => (
						<div key={index} className="flex min-w-0 flex-1 flex-col gap-[3px]">
							{column.cells.map((cell, row) =>
								cell ? (
									<div
										key={cell.day}
										data-day={cell.day}
										title={cell.unit === "Token" ? `${formatExactTokenCount(cell.amount)} Token` : undefined}
										className="group relative"
									>
										<span
											aria-hidden="true"
											className={`block aspect-square w-full rounded-[2px] ${HEAT_LEVELS[levelOf(cell.amount)]}`}
										/>
										<div
											role="tooltip"
											className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded-[var(--kit-radius-sm)] bg-[var(--kit-fg)] px-2 py-1 text-[length:var(--kit-text-meta)] whitespace-nowrap text-[var(--kit-bg)] shadow-[var(--kit-shadow)] group-hover:block"
										>
											{formatUsageDayStart(cell.day)} 起 ·{" "}
											{cell.unit === "Token" ? formatTokenCount(cell.amount) : numberText(cell.amount)} {cell.unit}
										</div>
									</div>
								) : (
									<span key={`empty-${row}`} aria-hidden="true" className="aspect-square w-full" />
								),
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

/** 不活跃/活跃图例，置于卡片头部右侧。 */
export function HeatLegend() {
	return (
		<span className="flex items-center gap-1 text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
			不活跃
			{HEAT_LEVELS.map((cls) => (
				<span key={cls} aria-hidden="true" className={`h-3 w-3 rounded-[var(--kit-radius-xs)] ${cls}`} />
			))}
			活跃
		</span>
	);
}
