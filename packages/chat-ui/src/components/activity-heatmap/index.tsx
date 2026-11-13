const HEAT_LEVELS = [
	"bg-[var(--kit-border)]",
	"bg-[var(--kit-heat)]/30",
	"bg-[var(--kit-heat)]/60",
	"bg-[var(--kit-heat)]",
];

/** 近 30 天活跃热力图（GitHub 式周列）；levels 按 max 三等分。 */
export function ActivityHeatmap({ days }: { days: { day: string; turns: number }[] }) {
	const max = days.reduce((m, d) => Math.max(m, d.turns), 0);
	const levelOf = (turns: number) => (turns <= 0 ? 0 : turns <= max / 3 ? 1 : turns <= (max * 2) / 3 ? 2 : 3);
	return (
		<div className="flex min-w-0 flex-wrap items-start gap-4">
			<div
				role="img"
				aria-label={days.map((day) => `${day.day}：${day.turns} turns`).join("；") || "暂无活跃记录"}
				className="grid grid-flow-col grid-rows-7 gap-1"
			>
				{days.map((d) => (
					<span
						key={d.day}
						aria-hidden="true"
						title={`${d.day}：${d.turns} turns`}
						className={`h-3.5 w-3.5 rounded-[var(--kit-radius-xs)] ${HEAT_LEVELS[max === 0 ? 0 : levelOf(d.turns)]}`}
					/>
				))}
			</div>
			<div className="flex items-center gap-1 text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
				不活跃
				{HEAT_LEVELS.map((cls) => (
					<span key={cls} className={`h-3 w-3 rounded-[var(--kit-radius-xs)] ${cls}`} />
				))}
				活跃
			</div>
		</div>
	);
}
