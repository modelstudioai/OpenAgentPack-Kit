"use client";

import {
	type AttachmentItem,
	Attachments,
	Sender,
	type SenderRef,
	type SenderSelection,
	type SenderSubmitType,
	SkillGlyph,
	Suggestion,
	type SuggestionItem,
} from "@openagentpack/kit-chat-ui";
import { skillInputTokens } from "@openagentpack/kit-sdk/protocol";
import { useRef, useState } from "react";
import { DEMO_SKILLS } from "./demo-skills.ts";
import { CONTROL_CLASS, TOOLBAR_CLASS } from "./general-demo.tsx";

type UploadedAttachment = AttachmentItem & { file_id?: string };

/** 基本用法：受控草稿 + 提交方式 + 生成中停止；onSubmit 不自动清空，成功且草稿未改写时才重置。 */
export function SenderDemo() {
	const senderRef = useRef<SenderRef>(null);
	const [value, setValue] = useState("帮我总结这份需求");
	const [loading, setLoading] = useState(false);
	const [submitType, setSubmitType] = useState<SenderSubmitType>("enter");
	const [note, setNote] = useState("尚未提交");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					提交方式
					<select
						className={CONTROL_CLASS}
						value={String(submitType)}
						onChange={(event) =>
							setSubmitType(event.target.value === "false" ? false : (event.target.value as SenderSubmitType))
						}
					>
						<option value="enter">Enter</option>
						<option value="shiftEnter">Shift+Enter</option>
						<option value="false">仅按钮</option>
					</select>
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={loading} onChange={(event) => setLoading(event.target.checked)} />
					生成中
				</label>
				<button type="button" className={CONTROL_CLASS} onClick={() => senderRef.current?.insert("总结")}>
					插入文本
				</button>
			</div>
			<div className="flex min-w-0 flex-1 flex-col justify-end gap-3 p-4">
				<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
					{note}
				</p>
				<Sender
					ref={senderRef}
					variant="workspace"
					value={value}
					onChange={setValue}
					loading={loading}
					submitType={submitType}
					onSubmit={(message) => {
						setNote(`onSubmit → ${message}`);
						setValue((current) => (current === message ? "" : current));
					}}
					onCancel={() => {
						setLoading(false);
						setNote("onCancel → 停止生成");
					}}
				/>
			</div>
		</div>
	);
}

/** 工作区布局与插槽：prefix/suffix 在工具栏左右，header 在编辑区上方，footer 在工具栏下方。 */
export function SenderSlotsDemo() {
	const [value, setValue] = useState("帮我总结这份需求");
	const [variant, setVariant] = useState<"workspace" | "default">("workspace");
	const [headerOpen, setHeaderOpen] = useState(true);
	return (
		<div data-kit-appearance={variant} className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					输入布局
					<select
						className={CONTROL_CLASS}
						value={variant}
						onChange={(event) => setVariant(event.target.value as "workspace" | "default")}
					>
						<option value="workspace">工作区</option>
						<option value="default">默认</option>
					</select>
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={headerOpen} onChange={(event) => setHeaderOpen(event.target.checked)} />
					头部面板
				</label>
			</div>
			<div className="flex min-w-0 flex-1 flex-col justify-end gap-3 p-4">
				<Sender
					variant={variant}
					value={value}
					onChange={setValue}
					onSubmit={() => setValue("")}
					prefix={
						<button type="button" className={CONTROL_CLASS} onClick={() => setHeaderOpen(true)}>
							附件
						</button>
					}
					header={
						<Sender.Header title="附件" open={headerOpen} onOpenChange={setHeaderOpen}>
							<p className="px-1 py-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
								header 在边框内、编辑区上方；内容超高时面板独立滚动。附件组合见下一个演示。
							</p>
						</Sender.Header>
					}
					suffix={(origin, { components }) => (
						<>
							<components.ClearButton />
							{origin}
						</>
					)}
					footer={({ components }) => (
						<div className="flex items-center justify-between gap-2 text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">
							<span>输入框由调用方受控；提交后是否清空也由调用方决定</span>
							<components.ClearButton>清空输入</components.ClearButton>
						</div>
					)}
				/>
			</div>
		</div>
	);
}

/** 技能选择：Suggestion 负责 "/" 查询与候选，Sender 负责把选中项落成原子 chip；
 * onSubmit 第二参数为从正文标记派生的技能名。 */
export function SenderSkillsDemo() {
	const [value, setValue] = useState("");
	const [selection, setSelection] = useState<SenderSelection>({ start: 0, end: 0 });
	const [note, setNote] = useState("键入 / 选择技能；chip 退格一次整体删除");
	const senderRef = useRef<SenderRef>(null);
	const skillNames = DEMO_SKILLS.map((skill) => skill.name);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="flex min-w-0 flex-1 flex-col justify-end gap-3 p-4">
				<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
					{note}
				</p>
				<Suggestion
					block
					items={DEMO_SKILLS.map((skill) => ({
						label: skill.name,
						value: skill.name,
						...(skill.description ? { description: skill.description } : {}),
						icon: <SkillGlyph className="size-4 shrink-0 text-[var(--kit-accent)]" />,
					}))}
					value={value}
					caret={selection.end}
					trigger="/"
					filter={(item, query) => {
						const inserted = skillInputTokens(value, skillNames);
						return item.value.toLowerCase().startsWith(query.toLowerCase()) && !inserted.includes(item.value);
					}}
					onSelect={(_, item, context) => {
						if (!context) return;
						const end = value[context.end] === " " ? context.end + 1 : context.end;
						senderRef.current?.replaceRange(context.start, end, `/${item.value} `);
					}}
				>
					{({ onKeyDown, inputProps }) => (
						<Sender
							ref={senderRef}
							variant="workspace"
							value={value}
							onChange={setValue}
							onSelectionChange={setSelection}
							skills={DEMO_SKILLS}
							placeholder="输入 / 唤起技能弹层，或直接输入消息"
							onKeyDown={onKeyDown}
							inputProps={inputProps}
							onSubmit={(message, skills) => {
								setNote(`onSubmit → ${message}${skills?.length ? `；技能：${skills.join("、")}` : "；无技能"}`);
								setValue("");
							}}
						/>
					)}
				</Suggestion>
				<p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					此预览不执行技能，仅演示 chip 编辑与提交载荷。
				</p>
			</div>
		</div>
	);
}

/** 组合附件与上传：prefix 打开文件选择，粘贴/拖放同一入口；未就绪附件经 submitDisabled 阻塞发送。 */
export function SenderAttachmentsDemo({ uploadFile }: { uploadFile: (file: File) => Promise<{ file_id: string }> }) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const nextId = useRef(0);
	const [items, setItems] = useState<UploadedAttachment[]>([]);
	const [value, setValue] = useState("");
	const [headerOpen, setHeaderOpen] = useState(true);
	const [note, setNote] = useState("尚未提交");
	const hasUnreadyFiles = items.some((item) => item.status !== "done");
	const pickFiles = () => {
		setHeaderOpen(true);
		fileInputRef.current?.click();
	};
	const addFiles = (files: File[]) => {
		if (files.length === 0) return;
		setHeaderOpen(true);
		const pending = files.map((file) => ({
			uid: `sender-${++nextId.current}`,
			name: file.name,
			size: file.size,
			type: file.type,
			status: "uploading" as const,
		}));
		setItems((current) => [...current, ...pending]);
		files.forEach(async (file, index) => {
			const uid = pending[index].uid;
			try {
				const { file_id } = await uploadFile(file);
				setItems((current) => current.map((item) => (item.uid === uid ? { ...item, file_id, status: "done" } : item)));
			} catch {
				setItems((current) =>
					current.map((item) =>
						item.uid === uid ? { ...item, status: "error", description: "上传失败，请移除后重新选择" } : item,
					),
				);
			}
		});
	};
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			{/* 常驻选择器不随 Sender.Header 收起卸载，第一次点击即可打开。 */}
			<input
				ref={fileInputRef}
				type="file"
				hidden
				multiple
				onChange={(event) => {
					addFiles(Array.from(event.target.files ?? []));
					event.target.value = "";
				}}
			/>
			<div className="flex min-w-0 flex-1 flex-col justify-end gap-3 p-4">
				<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
					{hasUnreadyFiles ? "附件上传中或上传失败，请等待完成或移除失败项后发送。" : note}
				</p>
				<Sender
					variant="workspace"
					value={value}
					onChange={setValue}
					onPasteFile={addFiles}
					onSubmit={(message, skills) => {
						const fileIds = items.flatMap((item) => (item.file_id ? [item.file_id] : []));
						setNote(
							`onSubmit → ${message}（${fileIds.length} 个附件）${skills?.length ? `；技能：${skills.join("、")}` : ""}`,
						);
						setValue("");
						setItems([]);
					}}
					submitDisabled={hasUnreadyFiles}
					prefix={
						<button type="button" className={CONTROL_CLASS} onClick={pickFiles}>
							附件
						</button>
					}
					header={
						<Sender.Header title={`附件（${items.length}）`} open={headerOpen} onOpenChange={setHeaderOpen}>
							<Attachments
								items={items}
								onPick={pickFiles}
								onSelectFiles={addFiles}
								onRemove={(item) => setItems((current) => current.filter((file) => file.uid !== item.uid))}
								overflow="scrollX"
							/>
						</Sender.Header>
					}
				/>
				<p className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					此预览使用模拟上传（800ms），文件不会发送到服务器；移除仅取消本次附件。
				</p>
			</div>
		</div>
	);
}

const INITIAL_FILES: AttachmentItem[] = [
	{ uid: "report", name: "需求说明.pdf", type: "application/pdf", size: 24800, status: "done" },
	{ uid: "data", name: "客户数据.csv", type: "text/csv", size: 9300, status: "done", description: "已扫描" },
	{ uid: "upload", name: "会议录音.wav", type: "audio/wav", size: 1024000, status: "uploading", percent: 64 },
	{ uid: "error", name: "损坏文件.zip", type: "application/zip", status: "error" },
];

/** 基本用法：点击或拖放得到原生 File[]，上传由调用方完成后写回 items；清空观察空态占位。 */
export function AttachmentsDemo() {
	const [items, setItems] = useState<AttachmentItem[]>([]);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<button type="button" className={CONTROL_CLASS} onClick={() => setItems([])}>
					清空
				</button>
				<span role="status" className="text-[var(--kit-fg-muted)]">
					已暂存 {items.length} 个文件
				</span>
			</div>
			<div className="min-w-0 flex-1 p-4">
				<Attachments
					items={items}
					maxCount={8}
					accept=".pdf,.csv,.txt,image/*"
					onSelectFiles={(files) =>
						setItems((current) => [
							...current,
							...files.map((file, index) => ({
								uid: `local-${Date.now()}-${index}`,
								name: file.name,
								size: file.size,
								type: file.type,
								status: "done" as const,
							})),
						])
					}
					onRemove={(item) => setItems((current) => current.filter((file) => file.uid !== item.uid))}
				/>
			</div>
		</div>
	);
}

/** 上传状态投影：业务把上传中/扫描中/失败三类来源统一成 AttachmentItem；上传中无移除入口。 */
const STATUS_FILES: AttachmentItem[] = [
	{ uid: "recording", name: "会议录音.wav", type: "audio/wav", size: 1024000, status: "uploading", percent: 64 },
	{
		uid: "spec",
		name: "需求说明.pdf",
		type: "application/pdf",
		size: 24800,
		status: "done",
		description: "安全扫描中…",
	},
	{
		uid: "rejected",
		name: "脚本.exe",
		type: "application/x-msdownload",
		status: "error",
		description: "文件类型不被允许",
	},
	{
		uid: "timeout",
		name: "客户数据.csv",
		type: "text/csv",
		size: 9300,
		status: "error",
		description: "扫描超时，请移除后重试",
	},
];

export function AttachmentsStatusDemo() {
	const [items, setItems] = useState(STATUS_FILES);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="min-w-0 flex-1 p-4">
				<Attachments
					items={items}
					onRemove={(item) => setItems((current) => current.filter((file) => file.uid !== item.uid))}
				/>
			</div>
			<p className="border-t border-[var(--kit-border)] p-3 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				上传中显示进度且无移除入口；失败卡经 description 展示原因，由调用方写回。
			</p>
		</div>
	);
}

const OVERFLOW_FILES: AttachmentItem[] = [
	{ uid: "o1", name: "需求说明.pdf", type: "application/pdf", size: 24800, status: "done" },
	{ uid: "o2", name: "客户数据.csv", type: "text/csv", size: 9300, status: "done" },
	{ uid: "o3", name: "周报.docx", type: "application/msword", size: 15200, status: "done" },
	{ uid: "o4", name: "架构图.png", type: "image/png", size: 480000, status: "done" },
	{ uid: "o5", name: "会议纪要.txt", type: "text/plain", size: 3200, status: "done" },
	{ uid: "o6", name: "归档.zip", type: "application/zip", size: 2048000, status: "done" },
	{ uid: "o7", name: "数据表.xlsx", type: "application/vnd.ms-excel", size: 36800, status: "done" },
	{ uid: "o8", name: "演示视频.mp4", type: "video/mp4", size: 8192000, status: "done" },
];

/** 溢出与禁用：wrap 换行 / scrollX 横向滚动（体验页同款）/ scrollY 纵向滚动；disabled 冻结选择、拖放与移除。 */
export function AttachmentsOverflowDemo() {
	const [items, setItems] = useState(OVERFLOW_FILES);
	const [overflow, setOverflow] = useState<"wrap" | "scrollX" | "scrollY">("scrollX");
	const [disabled, setDisabled] = useState(false);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					溢出
					<select
						className={CONTROL_CLASS}
						value={overflow}
						onChange={(event) => setOverflow(event.target.value as typeof overflow)}
					>
						<option value="wrap">wrap</option>
						<option value="scrollX">scrollX</option>
						<option value="scrollY">scrollY</option>
					</select>
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />
					禁用
				</label>
				<button type="button" className={CONTROL_CLASS} onClick={() => setItems(OVERFLOW_FILES)} disabled={disabled}>
					重置
				</button>
			</div>
			<div className="min-w-0 flex-1 p-4">
				<Attachments
					items={items}
					overflow={overflow}
					disabled={disabled}
					onRemove={(item) => setItems((current) => current.filter((file) => file.uid !== item.uid))}
				/>
			</div>
		</div>
	);
}

/** 单文件卡片可以独立展示，不包含文件选择器或拖放区域。 */
export function AttachmentFileCardDemo() {
	const [items, setItems] = useState<AttachmentItem[]>(INITIAL_FILES);
	const [disabled, setDisabled] = useState(false);
	const [removable, setRemovable] = useState(true);
	const [note, setNote] = useState("点击卡片右上角移除附件");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />
					禁用
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={removable} onChange={(event) => setRemovable(event.target.checked)} />
					显示移除按钮
				</label>
				<button
					type="button"
					className={CONTROL_CLASS}
					onClick={() => {
						setItems(INITIAL_FILES);
						setNote("点击卡片右上角移除附件");
					}}
				>
					重置
				</button>
			</div>
			<div className="flex flex-wrap gap-2 p-4">
				{items.map((item) => (
					<Attachments.FileCard
						key={item.uid}
						item={item}
						disabled={disabled}
						onRemove={
							removable
								? (removed) => {
										setItems((current) => current.filter((file) => file.uid !== removed.uid));
										setNote(`已移除：${removed.name}`);
									}
								: undefined
						}
					/>
				))}
			</div>
			<p role="status" className="px-4 text-sm text-[var(--kit-fg-muted)]">
				{note}
			</p>
		</div>
	);
}

const SUGGESTIONS: SuggestionItem[] = [
	{
		label: "写作",
		value: "writing",
		extra: "3",
		children: [
			{ label: "写一封产品发布邮件", value: "写一封产品发布邮件" },
			{ label: "把这段话改得更专业", value: "把这段话改得更专业" },
			{ label: "生成一份周报提纲", value: "生成一份周报提纲" },
		],
	},
	{ label: "总结当前会话", value: "总结当前会话" },
	{ label: "列出下一步行动项", value: "列出下一步行动项" },
];

/** 输入 / 打开 Suggestion；方向键移动，Enter 选择只填入，第二次 Enter 才提交。 */
export function SuggestionDemo() {
	const [value, setValue] = useState("");
	const [note, setNote] = useState("输入 / 打开快捷指令");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col justify-end gap-4 bg-[var(--kit-bg)] p-4 text-[var(--kit-fg)]"
		>
			<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
				{note}
			</p>
			<Suggestion
				items={SUGGESTIONS}
				block
				onSelect={(selected) => {
					setValue(selected);
					setNote(`onSelect → ${selected}`);
				}}
			>
				{({ onTrigger, onKeyDown, inputProps }) => (
					<Sender
						variant="workspace"
						value={value}
						onChange={(next) => {
							setValue(next);
							onTrigger(next === "/" ? undefined : false);
						}}
						onKeyDown={onKeyDown}
						inputProps={inputProps}
						onSubmit={(message) => {
							setNote(`onSubmit → ${message}`);
							setValue("");
						}}
						placeholder="输入 / 唤出快捷指令"
					/>
				)}
			</Suggestion>
		</div>
	);
}
