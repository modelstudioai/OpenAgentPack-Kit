"use client";

import { EmptyState, ErrorState, StatusIndicator, ThreadPanel } from "@openagentpack/kit-chat-ui";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";

const THREADS: Record<string, ChatMessage[]> = {
	th_subagent_billing: [
		{
			id: "t1",
			role: "user",
			parts: [{ type: "text", text: "查一下这个月的发票状态" }],
			status: "done",
			createdAt: "2026-11-09T02:00:00Z",
			threadId: "th_subagent_billing",
		},
		{
			id: "t2",
			role: "assistant",
			parts: [{ type: "text", text: "已提交，预计 2 个工作日内开出。" }],
			status: "done",
			createdAt: "2026-11-09T02:00:04Z",
			threadId: "th_subagent_billing",
		},
	],
};

/** 状态由连接状态和 Turn 阶段共同决定。 */
export function StatusDemo() {
	return (
		<div
			data-kit-appearance="workspace"
			className="flex flex-1 flex-col gap-3 bg-[var(--kit-bg)] p-4 text-[var(--kit-fg)]"
		>
			<StatusIndicator variant="badge" connected turnRunning={false} error={null} />
			<StatusIndicator variant="badge" connected turnRunning error={null} />
			<StatusIndicator variant="badge" connected={false} turnRunning={false} connection="connecting" />
			<StatusIndicator variant="badge" connected={false} turnRunning connection="reconnecting" />
			<StatusIndicator variant="badge" connected turnRunning phase="requires_action" />
			<StatusIndicator variant="badge" connected turnRunning phase="stopping" />
			<StatusIndicator
				variant="badge"
				connected
				turnRunning={false}
				error={{ code: "provider_error", message: "Provider 502（已脱敏透传）" }}
			/>
		</div>
	);
}

/** 兼容旧的 threads 分组；新接入使用 Chat.multiAgent。 */
export function ThreadDemo() {
	return (
		<div className="flex flex-1 flex-col gap-3 p-4">
			<p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				兼容旧版 ThreadPanel；原生主子 Agent 交互请查看 Chat 的 multiAgent 预览。
			</p>
			<ThreadPanel threads={THREADS} />
		</div>
	);
}

/** 空态与错误态：目录为空、请求失败时的两种占位。 */
export function StatesDemo() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<EmptyState title="还没有上架的 Agent" hint="到管理端完成 publish 与上架后，这里就会出现可对话的角色。" />
			<ErrorState message="拉取目录失败：HTTP 502" onRetry={() => undefined} />
		</div>
	);
}
