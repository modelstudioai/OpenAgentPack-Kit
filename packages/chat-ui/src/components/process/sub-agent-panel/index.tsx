import type { ChatAgentThread, ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { ProcessSpinner } from "../step/index.tsx";
import { formatDuration, isThreadRunning, StepRows, ThreadEventStates } from "../sub-agent-card/index.tsx";

/** 分区行首图标：与流内子 Agent 卡同款（执行流）。 */
const FlowIcon = ({ className }: { className: string }) => (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
		<path strokeLinecap="round" strokeLinejoin="round" d="M12 8V4H8" />
		<rect x="4" y="8" width="16" height="12" rx="2" />
		<path strokeLinecap="round" strokeLinejoin="round" d="M2 14h2M20 14h2M15 13v2M9 13v2" />
	</svg>
);

interface SubAgentGroup {
	name: string;
	threads: ChatAgentThread[];
}

/** 按展示名去重分组；组内按创建时间倒序（最新派发在前），缺时间时保持发现顺序。 */
function groupThreadsByName(threads: ChatAgentThread[]): SubAgentGroup[] {
	const groups = new Map<string, ChatAgentThread[]>();
	for (const thread of threads) {
		const list = groups.get(thread.name);
		if (list) list.push(thread);
		else groups.set(thread.name, [thread]);
	}
	return [...groups].map(([name, list]) => ({
		name,
		threads: [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
	}));
}

/** 行尾元信息：运行中给进行中文案，失败给出错，完成给耗时。 */
function taskMeta(thread: ChatAgentThread): string {
	if (isThreadRunning(thread.status)) return "执行中";
	if (thread.status === "failed") return "出错";
	return thread.createdAt && thread.endedAt
		? formatDuration(Date.parse(thread.endedAt) - Date.parse(thread.createdAt))
		: "";
}

const rowTransition =
	"transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none";

/** 弹窗头部状态文案：与卡头 HeadStatus 同词汇——失败给出错、运行中带逐秒计时、完成带耗时。 */
function dialogStatusLabel(thread: ChatAgentThread, elapsed: string | null): string {
	if (thread.status === "failed") return "执行出错";
	if (isThreadRunning(thread.status)) return elapsed ? `正在执行 ${elapsed}` : "正在执行";
	const duration =
		thread.createdAt && thread.endedAt
			? formatDuration(Date.parse(thread.endedAt) - Date.parse(thread.createdAt))
			: null;
	return duration ? `已完成 · ${duration}` : "已完成";
}

/**
 * 右栏「子 Agent」分区：当前会话用到的子 Agent 按展示名去重，展开看每次派发；
 * 点任务行打开执行记录弹窗（读子线程自身事件，不依赖主消息流加载）。无数据不渲染。
 */
export function SubAgentPanel({ multiAgent, className = "" }: { multiAgent?: ChatMultiAgent; className?: string }) {
	// 关闭只翻 open 位、保留 threadId：Radix 退出动画期间内容仍按最后线程渲染。
	const [dialog, setDialog] = useState<{ open: boolean; threadId: string | null }>({ open: false, threadId: null });
	const groups = multiAgent ? groupThreadsByName(multiAgent.threads) : [];
	const active =
		multiAgent && dialog.threadId ? multiAgent.threads.find((item) => item.id === dialog.threadId) : undefined;
	return (
		<>
			{groups.length > 0 ? (
				<details open className={`kit-collapse group/subpanel mt-6 min-w-0 ${className}`}>
					<summary
						className={`-mx-2 flex min-w-0 cursor-pointer list-none select-none items-center gap-2 rounded-[var(--kit-radius-sm)] px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden ${rowTransition}`}
					>
						<span className="text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg-muted)]">子 Agent</span>
						<span className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)] tabular-nums">
							· {groups.length}
						</span>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							className={`ml-auto size-3.5 shrink-0 text-[var(--kit-fg-muted)] group-open/subpanel:rotate-90 ${rowTransition}`}
						>
							<path d="m9 6 6 6-6 6" />
						</svg>
					</summary>
					<ul className="mt-1.5 flex flex-col">
						{groups.map((group) => (
							<li key={group.name}>
								<details className="kit-collapse group/sa">
									<summary
										className={`flex min-w-0 cursor-pointer list-none select-none items-center gap-2 rounded-[var(--kit-radius-sm)] px-2 py-1.5 hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden ${rowTransition}`}
									>
										<FlowIcon className="size-4 shrink-0 text-[var(--kit-fg-muted)]" />
										<span className="min-w-0 truncate text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg)]">
											{group.name}
										</span>
										<span className="ml-auto shrink-0 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] tabular-nums">
											{group.threads.length} 次
										</span>
										<svg
											aria-hidden="true"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="round"
											strokeLinejoin="round"
											className={`size-3.5 shrink-0 text-[var(--kit-fg-muted)] group-open/sa:rotate-90 ${rowTransition}`}
										>
											<path d="m9 6 6 6-6 6" />
										</svg>
									</summary>
									<ul className="ml-4 flex flex-col">
										{group.threads.map((thread) => {
											const failed = thread.status === "failed";
											return (
												<li key={thread.id}>
													<button
														type="button"
														onClick={() => setDialog({ open: true, threadId: thread.id })}
														className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--kit-radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] ${rowTransition}`}
													>
														{isThreadRunning(thread.status) ? (
															<ProcessSpinner className="size-3 shrink-0 text-[var(--kit-accent)]" />
														) : (
															<span
																aria-hidden
																className={`size-1.5 shrink-0 rounded-full ${failed ? "bg-[var(--kit-danger)]" : "bg-[var(--kit-fg-muted)]"}`}
															/>
														)}
														<span className="min-w-0 flex-1 truncate text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
															{thread.task ?? "未记录任务"}
														</span>
														<span className="shrink-0 text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)] tabular-nums">
															{taskMeta(thread)}
														</span>
													</button>
												</li>
											);
										})}
									</ul>
								</details>
							</li>
						))}
					</ul>
				</details>
			) : null}
			{active && multiAgent ? (
				<SubAgentTaskDialog
					thread={active}
					multiAgent={multiAgent}
					open={dialog.open}
					onClose={() => setDialog((state) => ({ ...state, open: false }))}
				/>
			) : null}
		</>
	);
}

/** 任务弹窗：一次派发的执行记录。头部为子 Agent 名与纯文本状态（沿用卡头词汇），
 * 正文单一滚动区：主 Agent 指令 + 时间线（读子线程事件，不依赖主消息流加载）；
 * 指令超长时在 160px 内部滚动，翻页沿用「加载更早消息」。 */
function SubAgentTaskDialog({
	thread,
	multiAgent,
	open,
	onClose,
}: {
	thread: ChatAgentThread;
	multiAgent: ChatMultiAgent;
	open: boolean;
	onClose: () => void;
}) {
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	// 打开即补拉该次派发的事件历史（与卡内嵌时间线同一 guard）。
	useEffect(() => {
		if (!open || !thread.historyAvailable || thread.loaded || thread.loading || thread.error) return;
		void multiAgent.loadThreadEvents(thread.id);
	}, [open, multiAgent, thread]);
	const running = isThreadRunning(thread.status);
	const failed = thread.status === "failed";
	// 运行中逐秒计时（与卡头 HeadStatus 同形态）；关闭即停表。
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!open || !running) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [open, running]);
	const elapsed = running && thread.createdAt ? formatDuration(Math.max(0, now - Date.parse(thread.createdAt))) : null;
	const statusLabel = dialogStatusLabel(thread, elapsed);
	return (
		<div ref={setContainer} className="contents">
			<Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
				{/* 保留调用方的主题作用域（与 ConfirmDialog 同款容器技巧）。 */}
				{container ? (
					<Dialog.Portal container={container}>
						<Dialog.Overlay className="fixed inset-0 z-50 grid place-items-center bg-[var(--kit-overlay)] p-4 data-[state=closed]:[animation:var(--kit-animate-overlay-out)] data-[state=open]:[animation:var(--kit-animate-overlay-in)]">
							<Dialog.Content
								className="flex max-h-[min(72vh,640px)] w-full max-w-[680px] flex-col rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] text-[var(--kit-fg)] shadow-[var(--kit-shadow)] outline-none data-[state=closed]:[animation:var(--kit-animate-dialog-out)] data-[state=open]:[animation:var(--kit-animate-dialog-in)]"
								onOpenAutoFocus={() => {
									const focused = container.ownerDocument.activeElement;
									opener.current = focused instanceof HTMLElement ? focused : null;
								}}
								onCloseAutoFocus={(event) => {
									// 无 Trigger 的受控挂载：关闭后自行还原焦点到打开者。
									event.preventDefault();
									if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
								}}
							>
								<header className="flex shrink-0 items-center gap-2 border-b border-[var(--kit-border-subtle)] px-5 pb-3 pt-4">
									<Dialog.Title className="min-w-0 truncate text-[length:var(--kit-text-heading)] font-semibold">
										{thread.name}
									</Dialog.Title>
									<span
										className={`ml-auto shrink-0 text-[length:var(--kit-text-caption)] tabular-nums ${failed ? "text-[var(--kit-danger)]" : "text-[var(--kit-fg-muted)]"}`}
									>
										{statusLabel}
									</span>
									<Dialog.Close asChild>
										<button
											type="button"
											aria-label="关闭"
											className={`grid size-6 shrink-0 place-items-center rounded-[var(--kit-radius-xs)] text-[var(--kit-fg-muted)] hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] ${rowTransition}`}
										>
											<svg
												aria-hidden="true"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												className="size-3.5"
											>
												<path d="M6 6l12 12M18 6L6 18" />
											</svg>
										</button>
									</Dialog.Close>
								</header>
								<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">
									<Dialog.Description className="max-h-40 overflow-y-auto pb-3 text-[length:var(--kit-text-label)] leading-[var(--kit-leading-body)] whitespace-pre-wrap [overflow-wrap:anywhere]">
										<span className="text-[var(--kit-fg-muted)]">主 Agent 指令：</span>
										{thread.task ?? "未记录任务"}
									</Dialog.Description>
									<StepRows messages={thread.messages} />
									<ThreadEventStates thread={thread} threadId={thread.id} multiAgent={multiAgent} />
								</div>
							</Dialog.Content>
						</Dialog.Overlay>
					</Dialog.Portal>
				) : null}
			</Dialog.Root>
		</div>
	);
}
