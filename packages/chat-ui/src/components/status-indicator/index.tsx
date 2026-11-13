import type { ConnectionState } from "@openagentpack/kit-sdk/chat";

type StatusKey =
	| "idle"
	| "running"
	| "requires_action"
	| "stopping"
	| "failed"
	| "interrupted"
	| "connecting"
	| "reconnecting"
	| "error";

const STATUS_LABELS: Record<StatusKey, string> = {
	idle: "空闲",
	running: "生成中…",
	requires_action: "等待审批",
	stopping: "正在停止…",
	failed: "执行失败",
	interrupted: "已中断",
	connecting: "连接中…",
	reconnecting: "重连中…",
	error: "连接异常",
};

/** 状态推导：phase 优先，其次连接态覆盖，错误兜底（重连中的错误仍显示重连）。 */
function resolveStatusKey(
	phase: "idle" | "running" | "requires_action" | "stopping" | "failed" | "interrupted" | undefined,
	turnRunning: boolean,
	connected: boolean,
	connection: ConnectionState | undefined,
	error: { code: string; message: string } | null | undefined,
): StatusKey {
	let status: StatusKey = phase ?? (turnRunning ? (connected ? "running" : "reconnecting") : "idle");
	if (connection === "connecting" || connection === "reconnecting") status = connection;
	if (error && connection !== "reconnecting") status = "error";
	return status;
}

export function StatusIndicator({
	connected,
	turnRunning,
	phase,
	connection,
	error,
	variant = "default",
}: {
	connected: boolean;
	turnRunning: boolean;
	phase?: "idle" | "running" | "requires_action" | "stopping" | "failed" | "interrupted";
	connection?: ConnectionState;
	error?: { code: string; message: string } | null;
	/** badge 在保留状态文本的同时提供紧凑徽标，适用于空间受限的页头。 */
	variant?: "default" | "badge";
}) {
	const status = resolveStatusKey(phase, turnRunning, connected, connection, error);
	const label = status === "error" ? `连接异常：${error?.message ?? ""}` : STATUS_LABELS[status];
	const active = status === "running" || status === "connecting" || status === "reconnecting";
	const tones: Record<StatusKey, string> = {
		idle: "text-[var(--kit-fg-muted)]",
		running: "text-[var(--kit-accent)]",
		requires_action: "text-[var(--kit-warning-fg)]",
		stopping: "text-[var(--kit-fg-muted)]",
		failed: "text-[var(--kit-danger)]",
		interrupted: "text-[var(--kit-danger)]",
		connecting: "text-[var(--kit-accent)]",
		reconnecting: "text-[var(--kit-accent)]",
		error: "text-[var(--kit-danger)]",
	};
	if (variant === "default") {
		return (
			<span
				role="status"
				className={`inline-flex min-w-0 items-center gap-1.5 text-[length:var(--kit-text-caption)] ${tones[status]}`}
			>
				{/* 纯文本形态也带状态点：活跃态呼吸、异常静态红点；空闲不加，避免常驻圆点。 */}
				{status === "idle" ? null : (
					<span
						aria-hidden="true"
						className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${active ? "motion-safe:animate-pulse" : ""}`}
					/>
				)}
				{label}
			</span>
		);
	}
	return (
		<span
			role="status"
			title={label}
			className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)] px-2 py-1 text-[length:var(--kit-text-caption)] ${tones[status]}`}
		>
			<span
				aria-hidden="true"
				className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${active ? "motion-safe:animate-pulse" : ""}`}
			/>
			<span className="min-w-0 truncate">{label}</span>
		</span>
	);
}
