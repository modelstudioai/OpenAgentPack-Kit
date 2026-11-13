import {
	ConfirmDialog,
	Layout,
	Menu,
	MenuContent,
	MenuItem,
	MenuTrigger,
	Sender,
	SessionSidebar,
} from "@openagentpack/kit-chat-ui";
import type { SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const sessions: SessionSummary[] = [
	{ session_id: "session-one", agent_slug: "fixture", title: "第一段会话", created_at: "2026-10-29T00:00:00Z" },
	{ session_id: "session-two", agent_slug: "fixture", title: "第二段会话", created_at: "2026-10-29T00:01:00Z" },
];
const buttonClass =
	"min-h-10 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-3 py-2 text-[length:var(--kit-text-label)] focus-visible:outline-2 focus-visible:outline-[var(--kit-focus)]";

/** 夹具行尾菜单：每行经 render prop 闭包拿到会话，归档项申请确认。 */
function FixtureRowMenu({ onArchive }: { onArchive: () => void }) {
	return (
		<Menu>
			<MenuTrigger asChild>
				<button
					type="button"
					aria-label="更多操作"
					title="更多操作"
					className="grid size-full cursor-pointer place-items-center rounded-[var(--kit-radius-sm)] outline-none"
				>
					<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
						<circle cx="5" cy="12" r="1.5" />
						<circle cx="12" cy="12" r="1.5" />
						<circle cx="19" cy="12" r="1.5" />
					</svg>
				</button>
			</MenuTrigger>
			<MenuContent align="end">
				<MenuItem onSelect={onArchive}>归档</MenuItem>
			</MenuContent>
		</Menu>
	);
}

/** 草稿属于 Layout 子树，用可观察输入值保护跨断点时正文不被重新挂载。 */
function DraftEditor() {
	const [draft, setDraft] = useState("");
	const [actions, setActions] = useState(0);
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
			<div className="min-h-0 flex-1 overflow-y-auto">
				<h1 className="text-[length:var(--kit-text-heading)] font-semibold">独立工作区</h1>
				<button type="button" className={buttonClass} onClick={() => setActions((value) => value + 1)}>
					执行本地动作
				</button>
				<p data-testid="body-actions">本地动作：{actions}</p>
			</div>
			<Sender variant="workspace" value={draft} onChange={setDraft} submitDisabled />
		</div>
	);
}

/** 仅以公开组件与本地状态组合导航和受控确认流程，不创建 Provider 或请求服务端。 */
function LayoutFixture() {
	const [activeId, setActiveId] = useState<string | null>("session-one");
	const [view, setView] = useState("会话");
	const [pending, setPending] = useState<string | null>(null);
	const [confirmed, setConfirmed] = useState(0);
	const [cancelled, setCancelled] = useState(0);
	// 行尾菜单由夹具经 render prop 自渲染：每行闭包拿到 session，归档项申请确认。
	return (
		<Layout
			mobileTitle="独立工作区"
			sidebar={({ closeSidebar, closeButton }) => (
				<aside className="flex min-h-0 w-full shrink-0 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)] md:w-64">
					<div className="flex min-h-16 shrink-0 items-center justify-between gap-3 p-4">
						<span className="truncate text-[length:var(--kit-text-base)] font-semibold">布局回归品牌</span>
						{closeButton}
					</div>
					<SessionSidebar
						groups={[{ id: "fixture", name: "夹具智能体", sessions, initialized: true }]}
						recent={{ sessions, initialized: true }}
						activeId={activeId}
						activeSection="recent"
						onSelect={(id) => {
							setActiveId(id);
							closeSidebar();
						}}
						menu={(session) => <FixtureRowMenu onArchive={() => setPending(session.session_id)} />}
					/>
					<nav aria-label="夹具导航" className="flex shrink-0 flex-col gap-2 p-3">
						{["会话", "用量"].map((item) => (
							<button
								key={item}
								type="button"
								aria-current={view === item ? "page" : undefined}
								className={buttonClass}
								onClick={() => {
									setView(item);
									closeSidebar();
								}}
							>
								{item}
							</button>
						))}
					</nav>
					<p className="p-4">本地回归用户</p>
				</aside>
			)}
			dialogs={
				pending ? (
					<ConfirmDialog
						title="确认归档"
						body={`归档 ${sessions.find((session) => session.session_id === pending)?.title}`}
						onCancel={() => {
							setCancelled((value) => value + 1);
							setPending(null);
						}}
						onConfirm={() => {
							setConfirmed((value) => value + 1);
							setPending(null);
						}}
					/>
				) : null
			}
		>
			<output data-testid="layout-state" className="p-4 text-[length:var(--kit-text-caption)]">
				{JSON.stringify({ activeId, view, pending, confirmed, cancelled })}
			</output>
			<DraftEditor />
		</Layout>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<LayoutFixture />);
