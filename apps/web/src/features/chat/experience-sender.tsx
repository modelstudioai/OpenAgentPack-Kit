import {
	type AttachmentItem,
	Attachments,
	Menu,
	MenuContent,
	MenuItem,
	MenuTrigger,
	Sender,
	type SenderRef,
	type SenderSelection,
	type SenderSkill,
	SkillGlyph,
	Suggestion,
} from "@openagentpack/kit-chat-ui";
import { useIsMobile } from "@openagentpack/kit-sdk/hooks";
import { skillInputTokens } from "@openagentpack/kit-sdk/protocol";
import { useMemo, useRef, useState } from "react";

/** 附件菜单项图标：与 prefix 回形针同族（24 viewBox、1.5 描边、currentColor）。 */
const ImageIcon = () => (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<circle cx="9" cy="10" r="1.5" />
		<path strokeLinecap="round" strokeLinejoin="round" d="m5.5 16.5 3.6-3.6a1.5 1.5 0 0 1 2.1 0l4.8 4.8" />
	</svg>
);

const VideoIcon = () => (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
		<rect x="2.5" y="6" width="13" height="12" rx="2" />
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			d="m15.5 10.7 4.2-2.5a.6.6 0 0 1 .9.5v6.6a.6.6 0 0 1-.9.5l-4.2-2.5"
		/>
	</svg>
);

const FileIcon = () => (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
		<path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
		<path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
	</svg>
);

function AttachmentPanel({
	items,
	disabled,
	onPickFile,
	onDrop,
	onRemove,
}: {
	items: AttachmentItem[];
	disabled: boolean;
	onPickFile: (accept?: string) => void;
	onDrop: (files: File[]) => void;
	onRemove: (fileId: string) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			{items.length > 0 ? (
				<>
					<Attachments
						disabled={disabled}
						items={items}
						onPick={onPickFile}
						onSelectFiles={onDrop}
						onRemove={(item) => onRemove(item.uid)}
						overflow="scrollX"
					/>
					<p className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">发送时会一并提交附件</p>
				</>
			) : null}
		</div>
	);
}

export function ExperienceSender({
	items,
	skills,
	turnRunning,
	canSend,
	disabled,
	processing,
	onPickFile,
	onDrop,
	onRemove,
	onSend,
	onStop,
}: {
	items: AttachmentItem[];
	/** 当前 Agent 已绑定技能；"/" 触发选择器，选中的标记随正文派生 skills 载荷上送。 */
	skills?: SenderSkill[];
	turnRunning: boolean;
	canSend: boolean;
	disabled: boolean;
	/** 暂存附件尚在 provider 安全扫描中：允许继续输入，仅禁发。 */
	processing: boolean;
	onPickFile: (accept?: string) => void;
	onDrop: (files: File[]) => void;
	onRemove: (fileId: string) => void;
	onSend: (text: string, skills?: string[]) => Promise<boolean>;
	onStop: () => void;
}) {
	const isMobile = useIsMobile();
	const [value, setValue] = useState("");
	const [selection, setSelection] = useState<SenderSelection>({ start: 0, end: 0 });
	const [submitting, setSubmitting] = useState(false);
	const senderRef = useRef<SenderRef>(null);
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
		<Suggestion
			block
			items={skillItems}
			value={value}
			caret={selection.end}
			trigger="/"
			filter={(item, query) => {
				const inserted = skillInputTokens(value, skillNames);
				return item.value.toLowerCase().startsWith(query.toLowerCase()) && !inserted.includes(item.value);
			}}
			onSelect={(_, item, context) => {
				if (!context) return;
				// 查询后若紧跟分隔空格则一并消费，避免替换后出现双空格。
				const end = value[context.end] === " " ? context.end + 1 : context.end;
				senderRef.current?.replaceRange(context.start, end, `/${item.value} `);
			}}
		>
			{({ onKeyDown, inputProps }) => (
				<Sender
					ref={senderRef}
					variant="workspace"
					autoSize={{ minRows: 2, maxRows: 6 }}
					value={value}
					skills={skills}
					placeholder={isMobile ? "输入消息…" : undefined}
					onChange={setValue}
					onSelectionChange={setSelection}
					onKeyDown={onKeyDown}
					inputProps={inputProps}
					onPasteFile={onDrop}
					onSubmit={(text, derived) => {
						setSubmitting(true);
						void onSend(text.trim(), derived)
							.then((sent) => {
								if (sent) setValue((current) => (current === text ? "" : current));
							})
							.finally(() => setSubmitting(false));
					}}
					onCancel={onStop}
					loading={turnRunning}
					submitDisabled={!canSend || submitting || processing}
					disabled={disabled}
					// 提交请求在途时发送按钮换成加载环：还不是可停止的回合，不能用 loading 的停止形态。
					suffix={(origin) =>
						submitting ? (
							<span className="relative grid size-10 place-items-center rounded-full bg-[var(--kit-accent)] text-[var(--kit-accent-fg)] opacity-80">
								<span className="sr-only">发送中</span>
								<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5 motion-safe:animate-spin">
									<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" className="opacity-25" />
									<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
								</svg>
							</span>
						) : (
							origin
						)
					}
					prefix={
						<Menu>
							<MenuTrigger asChild>
								<button
									type="button"
									aria-label="添加附件"
									disabled={disabled || items.some((item) => item.status === "uploading")}
									className="inline-flex min-h-10 items-center gap-2 rounded-[var(--kit-radius-sm)] px-3 py-2 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)] transition-colors enabled:hover:bg-[var(--kit-bg-subtle)] enabled:hover:text-[var(--kit-fg)] disabled:cursor-not-allowed disabled:opacity-50"
								>
									<svg
										aria-hidden="true"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										className="size-4"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8m-5 11 8-8"
										/>
									</svg>
									附件
								</button>
							</MenuTrigger>
							<MenuContent>
								<MenuItem onSelect={() => onPickFile("image/*")}>
									<ImageIcon />
									上传图片
								</MenuItem>
								<MenuItem onSelect={() => onPickFile("video/*")}>
									<VideoIcon />
									上传视频
								</MenuItem>
								<MenuItem onSelect={() => onPickFile()}>
									<FileIcon />
									上传文件
								</MenuItem>
							</MenuContent>
						</Menu>
					}
					header={
						<Sender.Header open={items.length > 0} title="附件" closable={false}>
							<AttachmentPanel
								items={items}
								disabled={disabled}
								onPickFile={onPickFile}
								onDrop={onDrop}
								onRemove={onRemove}
							/>
						</Sender.Header>
					}
				/>
			)}
		</Suggestion>
	);
}
