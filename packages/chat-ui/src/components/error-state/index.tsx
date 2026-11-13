export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<div
			role="alert"
			className="flex min-w-0 items-start gap-3 rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)] p-4 text-[var(--kit-fg)]"
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				className="mt-0.5 h-5 w-5 shrink-0 text-[var(--kit-danger)]"
			>
				<circle cx="12" cy="12" r="9" />
				<path d="M12 7v6m0 4h.01" />
			</svg>
			<div className="min-w-0 flex-1">
				<strong className="text-[length:var(--kit-text-base)] font-medium text-[var(--kit-danger)]">出错了</strong>
				<p className="mt-1 whitespace-pre-wrap text-[length:var(--kit-text-label)] leading-6 text-[var(--kit-fg-muted)] [overflow-wrap:anywhere]">
					{message}
				</p>
				{onRetry ? (
					<button
						type="button"
						onClick={onRetry}
						className="mt-3 min-h-10 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] px-3 py-2 text-[length:var(--kit-text-label)] font-medium transition-colors hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
					>
						重试
					</button>
				) : null}
			</div>
		</div>
	);
}
