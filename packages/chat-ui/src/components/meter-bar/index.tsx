/**
 * 用量条（用量页大卡与管理端迷你条共用）。
 * `unlimited` 时只渲染轨道；`max <= 0` 时不计算比例，具体额度含义由调用方显示。
 */
export function MeterBar({
	value,
	max,
	unlimited = false,
	className = "",
}: {
	value: number;
	max: number;
	unlimited?: boolean;
	className?: string;
}) {
	const ratio = unlimited || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
	const pct = Math.round(ratio * 100);
	return (
		<div
			role="progressbar"
			aria-valuenow={unlimited ? undefined : value}
			aria-valuemin={0}
			aria-valuemax={unlimited ? undefined : max}
			aria-label={unlimited ? "不限量" : `已用 ${value} / ${max}`}
			className={`h-3 w-full overflow-hidden rounded-full bg-[var(--kit-bg-subtle)] ${className}`}
		>
			{unlimited ? null : (
				<div
					className="h-full rounded-full bg-[var(--kit-accent)] motion-safe:transition-[width]"
					style={{ width: `${pct}%` }}
				/>
			)}
		</div>
	);
}
