import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileCard } from "../file-card/index.tsx";

export interface AttachmentItem {
	uid: string;
	name: string;
	size?: number;
	type?: string;
	status?: "uploading" | "done" | "error";
	percent?: number;
	thumbUrl?: string;
	description?: ReactNode;
}

export interface AttachmentFileCardProps {
	item: AttachmentItem;
	onRemove?: (item: AttachmentItem) => void;
	disabled?: boolean;
	className?: string;
}

export interface AttachmentsPlaceholder {
	icon?: ReactNode;
	title?: ReactNode;
	description?: ReactNode;
}

export type AttachmentsSemantic = "root" | "list" | "item" | "placeholder" | "drop";

export interface AttachmentsProps {
	items?: AttachmentItem[];
	/** 内置文件选择、拖放得到的文件；上传由调用方完成，再把结果写回 items */
	onSelectFiles?: (files: File[]) => void;
	/** 提供时由宿主选择文件（如 Electron 对话框），不再使用内置 input */
	onPick?: () => void;
	onRemove?: (item: AttachmentItem) => void;
	accept?: string;
	multiple?: boolean;
	maxCount?: number;
	disabled?: boolean;
	overflow?: "wrap" | "scrollX" | "scrollY";
	placeholder?: AttachmentsPlaceholder | ((type: "inline" | "drop") => AttachmentsPlaceholder);
	/** 扩大拖放区域；该元素需要 position: relative，拖放提示会覆盖在它上面 */
	getDropContainer?: () => HTMLElement | null | undefined;
	className?: string;
	classNames?: Partial<Record<AttachmentsSemantic, string>>;
}

export interface AttachmentsRef {
	nativeElement: HTMLDivElement | null;
	/** 打开文件选择（有 onPick 时调用 onPick） */
	select: () => void;
}

function cx(...names: Array<string | false | undefined>): string {
	return names.filter(Boolean).join(" ");
}

const DEFAULT_PLACEHOLDER: Record<"inline" | "drop", AttachmentsPlaceholder> = {
	inline: { title: "上传文件", description: "点击选择，或把文件拖放到这里" },
	drop: { title: "松开即可添加文件" },
};

function PlaceholderBody({ placeholder }: { placeholder: AttachmentsPlaceholder }) {
	return (
		<>
			{placeholder.icon ? (
				<span aria-hidden className="text-[22px]">
					{placeholder.icon}
				</span>
			) : null}
			{placeholder.title ? (
				<span className="text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg)]">
					{placeholder.title}
				</span>
			) : null}
			{placeholder.description ? (
				<span className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					{placeholder.description}
				</span>
			) : null}
		</>
	);
}

/** 独立附件卡片；文件状态由调用方传入，上传中或禁用时不提供移除入口。 */
export function AttachmentFileCard({ item, onRemove, disabled = false, className }: AttachmentFileCardProps) {
	const uploading = item.status === "uploading";
	const failed = item.status === "error";
	const removable = onRemove !== undefined && !uploading && !disabled;
	return (
		<div className={cx("relative w-56 max-w-full shrink-0", failed && "[&>div]:border-[var(--kit-danger)]", className)}>
			<FileCard
				name={item.name}
				type={item.type}
				src={item.thumbUrl}
				disabled={disabled}
				className={removable ? "pr-8" : undefined}
				description={
					uploading ? (
						<span className="flex flex-col">
							{item.percent === undefined ? "上传中…" : `上传中 ${Math.round(item.percent)}%`}
							<progress
								aria-label={`${item.name} 上传进度`}
								max={100}
								value={item.percent}
								className="mt-1 h-1 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-[var(--kit-accent)] [&::-webkit-progress-bar]:bg-[var(--kit-border)] [&::-webkit-progress-value]:bg-[var(--kit-accent)]"
							/>
						</span>
					) : failed ? (
						<div className="text-[var(--kit-danger)]">{item.description || "上传失败"}</div>
					) : (
						item.description
					)
				}
			/>
			{removable ? (
				<button
					type="button"
					aria-label={`移除 ${item.name}`}
					onClick={() => onRemove?.(item)}
					className="absolute top-1 right-1 grid size-7 place-items-center rounded-[var(--kit-radius-sm)] text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)] hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
				>
					✕
				</button>
			) : null}
		</div>
	);
}

/** 附件列表与选择入口。组件只负责选择、拖放与展示；上传、挂载由调用方经 hooks 完成。 */
const AttachmentsBase = forwardRef<AttachmentsRef, AttachmentsProps>(function Attachments(
	{
		items = [],
		onSelectFiles,
		onPick,
		onRemove,
		accept,
		multiple = true,
		maxCount,
		disabled = false,
		overflow = "wrap",
		placeholder,
		getDropContainer,
		className,
		classNames = {},
	},
	ref,
) {
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [dropTarget, setDropTarget] = useState<HTMLElement | null>(null);
	const resolvePlaceholder = (type: "inline" | "drop") =>
		(typeof placeholder === "function" ? placeholder(type) : type === "inline" ? placeholder : undefined) ??
		DEFAULT_PLACEHOLDER[type];

	const remaining = maxCount === undefined ? Number.POSITIVE_INFINITY : Math.max(0, maxCount - items.length);
	const accepting = !disabled && remaining > 0 && Boolean(onPick || onSelectFiles);
	const select = () => {
		if (!accepting) return;
		if (onPick) onPick();
		else inputRef.current?.click();
	};
	const receive = (files: File[]) => {
		if (!accepting) return;
		const picked = files.slice(0, multiple ? remaining : Math.min(1, remaining));
		if (picked.length > 0) onSelectFiles?.(picked);
	};
	// 拖放监听挂在原生事件上，回调可能在任意一次渲染之后触发，因此经 ref 读最新值
	const receiveRef = useRef(receive);
	receiveRef.current = receive;

	useImperativeHandle(ref, () => ({
		get nativeElement() {
			return rootRef.current;
		},
		select,
	}));

	useEffect(() => {
		const container = getDropContainer?.() ?? rootRef.current;
		if (!container || !accepting || !onSelectFiles) return;
		let depth = 0;
		const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
		const enter = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			depth += 1;
			setDropTarget(container);
		};
		const over = (event: DragEvent) => {
			if (hasFiles(event)) event.preventDefault();
		};
		const leave = () => {
			depth = Math.max(0, depth - 1);
			if (depth === 0) setDropTarget(null);
		};
		const drop = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			depth = 0;
			setDropTarget(null);
			receiveRef.current(Array.from(event.dataTransfer?.files ?? []));
		};
		container.addEventListener("dragenter", enter);
		container.addEventListener("dragover", over);
		container.addEventListener("dragleave", leave);
		container.addEventListener("drop", drop);
		return () => {
			container.removeEventListener("dragenter", enter);
			container.removeEventListener("dragover", over);
			container.removeEventListener("dragleave", leave);
			container.removeEventListener("drop", drop);
		};
	}, [getDropContainer, accepting, onSelectFiles]);

	const dropOverlay = dropTarget ? (
		<div
			className={cx(
				"pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-[inherit] border-2 border-dashed border-[var(--kit-accent)] bg-[var(--kit-surface)]/90",
				classNames.drop,
			)}
		>
			<PlaceholderBody placeholder={resolvePlaceholder("drop")} />
		</div>
	) : null;

	return (
		<div ref={rootRef} className={cx("relative min-w-0", className, classNames.root)}>
			{onPick ? null : (
				<input
					ref={inputRef}
					type="file"
					hidden
					tabIndex={-1}
					accept={accept}
					multiple={multiple}
					onChange={(event) => {
						const files = Array.from(event.target.files ?? []);
						event.target.value = "";
						receive(files);
					}}
				/>
			)}
			{items.length === 0 ? (
				<button
					type="button"
					onClick={select}
					disabled={!accepting}
					className={cx(
						"flex w-full flex-col items-center gap-1 rounded-[var(--kit-radius-sm)] border border-dashed border-[var(--kit-border)] bg-[var(--kit-bg-subtle)] px-4 py-5 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] enabled:hover:border-[var(--kit-accent)] disabled:cursor-not-allowed disabled:opacity-50",
						classNames.placeholder,
					)}
				>
					<PlaceholderBody placeholder={resolvePlaceholder("inline")} />
				</button>
			) : (
				<div
					className={cx(
						"flex min-w-0 gap-2",
						overflow === "scrollX" ? "overflow-x-auto overscroll-x-contain p-1" : "flex-wrap",
						overflow === "scrollY" && "max-h-40 overflow-y-auto",
						classNames.list,
					)}
				>
					{items.map((item) => (
						<AttachmentFileCard
							key={item.uid}
							item={item}
							onRemove={onRemove}
							disabled={disabled}
							className={classNames.item}
						/>
					))}
					{accepting ? (
						<button
							type="button"
							aria-label="添加文件"
							onClick={select}
							className="grid w-14 shrink-0 place-items-center rounded-[var(--kit-radius-sm)] border border-dashed border-[var(--kit-border)] text-[length:var(--kit-text-title)] text-[var(--kit-fg-muted)] hover:border-[var(--kit-accent)] hover:text-[var(--kit-accent)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
						>
							＋
						</button>
					) : null}
				</div>
			)}
			{dropOverlay && dropTarget !== rootRef.current
				? createPortal(dropOverlay, dropTarget as HTMLElement)
				: dropOverlay}
		</div>
	);
});

export const Attachments = Object.assign(AttachmentsBase, { FileCard: AttachmentFileCard });
