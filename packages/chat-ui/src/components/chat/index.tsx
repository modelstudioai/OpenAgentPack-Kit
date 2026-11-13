import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { skillInputTokens } from "@openagentpack/kit-sdk/protocol";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { MessageList } from "../message-list/index.tsx";
import { Sender, type SenderRef, type SenderSelection, type SenderSkill, SkillGlyph } from "../sender/index.tsx";
import { Suggestion } from "../suggestion/index.tsx";

/** workspace 变体的水平内缩；开锚点栏时右侧与消息区同留 md:pr-12 刻度位，让审批提示、
 * 输入区与消息列共用同一居中基准（否则 48rem 列中心差 12px，输入框和消息不对齐）。 */
function workspacePad(variant: "default" | "workspace", anchorRail: boolean): string {
	return variant === "workspace" ? `px-4 md:px-6${anchorRail ? " md:pr-12" : ""}` : "";
}

/** 对话组合：MessageList 负责列表与滚动，Sender 负责输入（H5 同包）。 */
export function Chat({
	messages,
	variant = "default",
	turnRunning = false,
	sending = false,
	canSend = true,
	composerDisabled = false,
	approvals,
	onSend,
	onStop,
	onArtifactDownload,
	onArtifactOpen,
	onCopy,
	empty,
	scrollKey,
	sender,
	multiAgent,
	anchorRail = false,
	virtualize = true,
	skills,
}: {
	messages: ChatMessage[];
	/** workspace 将消息、输入与审批对齐到居中阅读列；默认保留原有布局。 */
	variant?: "default" | "workspace";
	turnRunning?: boolean;
	/** 发送请求在途（含新建会话）：乐观气泡出现前列表尾显示「发送中…」指示，回合开始后归「生成中…」。 */
	sending?: boolean;
	canSend?: boolean;
	/** 禁止编辑和发送（如配额耗尽），生成中的停止按钮仍可用。 */
	composerDisabled?: boolean;
	/** 主 Agent 当前待办审批卡；内嵌到消息流末尾，输入区上方只留精简等待提示。 */
	approvals?: ReactNode;
	/** useChat 返回的多 Agent 视图；子 Agent 以消息流内嵌卡呈现，卡片状态来自该快照。 */
	multiAgent?: ChatMultiAgent;
	onSend?: (text: string, skills?: string[]) => void | Promise<void>;
	onStop?: () => void | Promise<void>;
	onArtifactDownload?: (fileId: string) => void;
	/** 产物卡主操作（点名称打开预览）；与 onArtifactDownload 并列，缺一该入口不渲染。 */
	onArtifactOpen?: (fileId: string, contentType?: string) => void;
	/** 由宿主提供复制能力；省略时使用浏览器剪贴板。 */
	onCopy?: (text: string) => void | Promise<void>;
	/** 无消息时的占位内容（开场白/示例问题）；输入框始终可用 */
	empty?: ReactNode;
	/** 切换会话时让消息列表重新跟随到底部，输入框保持挂载。 */
	scrollKey?: string | null;
	/** 替换默认输入框（接入附件、快捷指令等）；提供后输入框状态与回调由调用方控制。 */
	sender?: ReactNode;
	/** 当前 Agent 已绑定技能；透传 Sender（"/" 弹层与标记 pill）与 MessageList（气泡 chip 还原）。 */
	skills?: SenderSkill[];
	/** 在主会话消息区右缘显示回合锚点栏（Qoder 形态）。 */
	anchorRail?: boolean;
	/** 长列表分窗渲染开关，透传 MessageList；false 时长会话也整体渲染。 */
	virtualize?: boolean;
}) {
	const [draft, setDraft] = useState("");
	const [selection, setSelection] = useState<SenderSelection>({ start: 0, end: 0 });
	const senderRef = useRef<SenderRef>(null);
	// 助手尚未返回首帧（没有流式中的助手消息）时在列表尾部显示等待指示。
	const awaitingFirstFrame =
		turnRunning &&
		!messages.some((m) => m.role === "assistant" && (m.status === "streaming" || m.status === "pending"));
	const contentWidth = variant === "workspace" ? "mx-auto w-full min-w-0 max-w-[var(--kit-chat-width)]" : "contents";
	const skillNames = useMemo(() => skills?.map((skill) => skill.name) ?? [], [skills]);
	const skillItems = useMemo(
		() =>
			(skills ?? []).map((skill) => ({
				label: skill.name,
				value: skill.name,
				...(skill.description ? { description: skill.description } : {}),
				icon: <SkillGlyph className="size-4 shrink-0 text-[var(--kit-accent)]" />,
			})),
		[skills],
	);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<section className="flex min-h-0 min-w-0 flex-1 flex-col">
				<MessageList
					messages={messages}
					variant={variant}
					onArtifactDownload={onArtifactDownload}
					onArtifactOpen={onArtifactOpen}
					onCopy={onCopy}
					empty={empty}
					scrollKey={scrollKey}
					pending={(awaitingFirstFrame || sending) && !approvals}
					pendingLabel={sending && !turnRunning ? "发送中…" : undefined}
					approvals={approvals}
					anchorRail={anchorRail}
					virtualize={virtualize}
					multiAgent={multiAgent}
					skills={skillNames}
				/>
				{approvals ? (
					<div className={`shrink-0 ${variant === "workspace" ? workspacePad(variant, anchorRail) : "px-3"}`}>
						<div className={contentWidth}>
							<p className="flex items-center gap-1.5 pb-2 text-[length:var(--kit-text-label)] text-[var(--kit-warning-fg)]">
								{/* 呼吸点与 StatusIndicator badge 的活跃形态一致。 */}
								<span
									aria-hidden="true"
									className="h-1.5 w-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse"
								/>
								等待审批
							</p>
						</div>
					</div>
				) : null}
				<div
					className={`shrink-0 pb-[max(var(--kit-space-3),env(safe-area-inset-bottom))] ${
						variant === "workspace"
							? `pt-2 ${workspacePad(variant, anchorRail)} md:pb-[max(var(--kit-space-6),env(safe-area-inset-bottom))]`
							: "border-t border-[var(--kit-border-subtle)] px-3 pt-3"
					}`}
				>
					<div className={contentWidth}>
						{sender ?? (
							<Suggestion
								block
								items={skillItems}
								value={draft}
								caret={selection.end}
								trigger={skills?.length ? "/" : undefined}
								filter={(item, query) => {
									const inserted = skillInputTokens(draft, skillNames);
									return item.value.toLowerCase().startsWith(query.toLowerCase()) && !inserted.includes(item.value);
								}}
								onSelect={(_, item, context) => {
									if (!context) return;
									const end = draft[context.end] === " " ? context.end + 1 : context.end;
									senderRef.current?.replaceRange(context.start, end, `/${item.value} `);
								}}
							>
								{({ onKeyDown, inputProps }) => (
									<Sender
										ref={senderRef}
										variant={variant}
										value={draft}
										onChange={setDraft}
										onSelectionChange={setSelection}
										loading={turnRunning}
										disabled={composerDisabled}
										submitDisabled={!canSend}
										skills={skills}
										onKeyDown={onKeyDown}
										inputProps={inputProps}
										onSubmit={(text, derived) => {
											void Promise.resolve(onSend?.(text.trim(), derived)).then(
												() => setDraft((current) => (current === text ? "" : current)),
												() => undefined,
											);
										}}
										onCancel={() => void onStop?.()}
									/>
								)}
							</Suggestion>
						)}
					</div>
				</div>
			</section>
		</div>
	);
}
