import { AgentHeader, StatusIndicator } from "@openagentpack/kit-chat-ui";
import { AgentSummarySchema } from "@openagentpack/kit-sdk/protocol";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const agents = [
	AgentSummarySchema.parse({
		slug: "writer-long",
		display_name: `跨团队长文档整理与业务流程协作助手${"LongUnbrokenAgentName".repeat(6)}`,
		icon: "✍️",
		capabilities: {},
	}),
	AgentSummarySchema.parse({
		slug: "reviewer-long",
		display_name: `多语言方案与代码评审助手${"LongUnbrokenReviewerName".repeat(6)}`,
		icon: "🔎",
		capabilities: {},
	}),
];
const error = {
	code: "stream_unavailable",
	message: `无法建立会话流：UPSTREAM_CONNECTION_LOST_${"abcdef0123456789".repeat(16)}`,
};

/** 通过公开 props 覆盖长内容边界；不加载 App、Provider 或服务端配置。 */
function AgentHeaderFixture() {
	const [slug, setSlug] = useState("writer-long");
	return (
		<AgentHeader
			compact
			agent={agents.find((agent) => agent.slug === slug) ?? null}
			agents={agents}
			onPickAgent={setSlug}
			leading={
				<button
					type="button"
					aria-label="打开导航菜单"
					className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--kit-radius-sm)] text-[var(--kit-fg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						className="h-4 w-4"
					>
						<path d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
			}
			actions={
				<StatusIndicator
					variant="badge"
					connected={false}
					turnRunning={false}
					connection="disconnected"
					error={error}
				/>
			}
		/>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<AgentHeaderFixture />);
