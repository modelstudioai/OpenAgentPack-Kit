import { isIconImageSource } from "@openagentpack/kit-chat-ui";
import type { AgentSummary } from "@openagentpack/kit-sdk/protocol";
import { useMemo } from "react";
import type { NavigateFn } from "../../lib/use-route.ts";
import type { SessionDirectory } from "../../lib/use-session-directory.ts";

function AgentIcon({ agent, className }: { agent: AgentSummary | undefined; className: string }) {
	return (
		<span className={`grid shrink-0 place-items-center bg-[var(--kit-bg-subtle)] ${className}`} aria-hidden>
			{isIconImageSource(agent?.icon) ? (
				<img src={agent?.icon} alt="" className="h-3/5 w-3/5 object-contain" />
			) : (
				(agent?.icon ?? "🤖")
			)}
		</span>
	);
}

/** 新建聊天页的「最近使用」chips：按会话智能体目录的活动序取前 5 个 slug，回目录补全名称与
 * 图标（已下架的不展示）；无会话时整块不渲染。卡片网格交给外层复用的广场内容。 */
export function NewChatRecent({
	navigate,
	directory,
	agents,
}: {
	navigate: NavigateFn;
	directory: SessionDirectory;
	agents: AgentSummary[];
}) {
	const recent = useMemo(() => {
		const rows: AgentSummary[] = [];
		for (const group of directory.groups) {
			const agent = agents.find((item) => item.slug === group.slug);
			if (!agent) continue;
			rows.push(agent);
			if (rows.length === 5) break;
		}
		return rows;
	}, [directory.groups, agents]);

	if (recent.length === 0) return null;
	return (
		<section className="mt-8 min-w-0" aria-label="最近使用">
			<h2 className="mb-4 text-[length:var(--kit-text-heading)] font-semibold">最近使用</h2>
			<div className="flex min-w-0 flex-wrap gap-3">
				{recent.map((agent) => (
					<button
						key={agent.slug}
						type="button"
						data-testid={`new-recent-${agent.slug}`}
						onClick={() => navigate({ view: "chat", agent: agent.slug, session: null })}
						className={`flex min-w-0 cursor-pointer items-center gap-2.5 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] py-2 pr-4 pl-2 text-left transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]`}
					>
						<AgentIcon
							agent={agent}
							className="size-9 rounded-[var(--kit-radius-sm)] text-[length:var(--kit-text-base)]"
						/>
						<span className="min-w-0">
							<span className="block truncate text-[length:var(--kit-text-label)] font-medium">
								{agent.display_name}
							</span>
						</span>
					</button>
				))}
			</div>
		</section>
	);
}
