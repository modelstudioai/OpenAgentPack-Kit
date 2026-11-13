export function EmptyState({
	title,
	hint,
	loading = false,
}: {
	title: string;
	hint?: string;
	/** 在同一状态布局内展示加载进度，并向辅助技术播报状态。 */
	loading?: boolean;
}) {
	return (
		<div
			role={loading ? "status" : undefined}
			aria-busy={loading || undefined}
			className="grid min-w-0 flex-1 place-items-center px-4 py-8 text-center text-[var(--kit-fg-muted)]"
		>
			<div className="mx-auto flex w-full min-w-0 max-w-lg flex-col items-center gap-3 [overflow-wrap:anywhere]">
				{loading ? (
					<span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-[var(--kit-bg-subtle)]">
						<span className="h-2 w-2 rounded-full bg-[var(--kit-fg-muted)] motion-safe:animate-pulse" />
					</span>
				) : null}
				<div className="text-[length:var(--kit-text-title)] font-medium leading-snug text-[var(--kit-fg)]">{title}</div>
				{hint ? <div className="max-w-md text-[length:var(--kit-text-label)] leading-6">{hint}</div> : null}
			</div>
		</div>
	);
}
