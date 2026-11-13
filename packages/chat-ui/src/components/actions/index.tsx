import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";

export type ActionsVariant = "borderless" | "outlined" | "filled";

export interface ActionsClickInfo {
	key: string;
	item: ActionsItem;
	domEvent: MouseEvent<HTMLButtonElement>;
}

export interface ActionsItem {
	key: string;
	label: ReactNode;
	icon?: ReactNode;
	disabled?: boolean;
	danger?: boolean;
	onItemClick?: (info: ActionsClickInfo) => void;
	subItems?: ActionsItem[];
}

export interface ActionsProps {
	items?: ActionsItem[];
	onClick?: (info: ActionsClickInfo) => void;
	children?: ReactNode;
	variant?: ActionsVariant;
	className?: string;
	"aria-label"?: string;
}

function cx(...values: Array<string | false | undefined>): string {
	return values.filter(Boolean).join(" ");
}

function actionClass(variant: ActionsVariant): string {
	return cx(
		"inline-flex items-center justify-center gap-1.5 rounded-[var(--kit-radius-sm)] border px-2 py-1.5 text-[length:var(--kit-text-caption)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50",
		variant === "outlined" ? "border-[var(--kit-border)]" : "border-transparent",
		variant === "filled" ? "bg-[var(--kit-bg-subtle)]" : "bg-transparent",
		"enabled:hover:bg-[var(--kit-bg-subtle)]",
	);
}

function ActionDisclosure({
	children,
	label,
	className,
}: {
	children: ReactNode;
	label: ReactNode;
	className: string;
}) {
	const ref = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		const closeOutside = (event: PointerEvent) => {
			const element = ref.current;
			if (element && event.target instanceof Node && !element.contains(event.target)) element.open = false;
		};
		document.addEventListener("pointerdown", closeOutside);
		return () => document.removeEventListener("pointerdown", closeOutside);
	}, []);
	return (
		<details
			ref={ref}
			data-kit-actions
			className="relative"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.stopPropagation();
				event.currentTarget.open = false;
				event.currentTarget.querySelector("summary")?.focus();
			}}
		>
			<summary className={cx(className, "cursor-pointer list-none hover:bg-[var(--kit-bg-subtle)]")}>
				{label}
				<span aria-hidden>⌄</span>
			</summary>
			<div className="absolute top-full left-0 z-10 mt-1 flex min-w-36 flex-col items-stretch gap-1 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-1 shadow-[var(--kit-shadow)]">
				{children}
			</div>
		</details>
	);
}

function ActionItems({ items, onClick, variant = "borderless" }: Pick<ActionsProps, "items" | "onClick" | "variant">) {
	return items?.map((item) => {
		const content = (
			<>
				{item.icon ? <span aria-hidden>{item.icon}</span> : null}
				{item.label}
			</>
		);
		const className = cx(actionClass(variant), item.danger ? "text-[var(--kit-danger)]" : "text-[var(--kit-fg-muted)]");
		if (item.subItems?.length && !item.disabled) {
			return (
				<ActionDisclosure key={item.key} label={content} className={className}>
					<ActionItems items={item.subItems} onClick={onClick} variant={variant} />
				</ActionDisclosure>
			);
		}
		return (
			<button
				key={item.key}
				type="button"
				disabled={item.disabled}
				className={className}
				onClick={(domEvent) => {
					const info = { key: item.key, item, domEvent };
					item.onItemClick?.(info);
					onClick?.(info);
					let disclosure = domEvent.currentTarget.closest<HTMLDetailsElement>("details[data-kit-actions]");
					let summary: HTMLElement | null = null;
					while (disclosure) {
						disclosure.open = false;
						summary = disclosure.querySelector("summary");
						disclosure = disclosure.parentElement?.closest<HTMLDetailsElement>("details[data-kit-actions]") ?? null;
					}
					summary?.focus();
				}}
			>
				{content}
			</button>
		);
	});
}

function ActionsBase({
	items = [],
	onClick,
	children,
	variant = "borderless",
	className,
	"aria-label": ariaLabel = "操作列表",
}: ActionsProps) {
	return (
		<fieldset
			aria-label={ariaLabel}
			className={cx("m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0", className)}
		>
			<ActionItems items={items} onClick={onClick} variant={variant} />
			{children}
		</fieldset>
	);
}

export interface ActionsCopyProps {
	text: string;
	/** 成功后 resolve，失败时抛错；省略时使用浏览器剪贴板。 */
	onCopy?: (text: string) => void | Promise<void>;
	disabled?: boolean;
	label?: string;
	/** 只显示图标（aria-label 仍读 label）；点击后的复制状态文字照常出现。 */
	iconOnly?: boolean;
	variant?: ActionsVariant;
	className?: string;
}

function copyButtonLabel(state: "pending" | "success" | "error" | null, iconOnly: boolean, label: string) {
	if (state === "pending") return "复制中…";
	if (state === "success") return "已复制";
	if (state === "error") return "复制失败";
	return iconOnly ? null : label;
}

/** 复制成功与失败由真实异步结果决定，不把拒绝的剪贴板权限展示成成功。 */
export function ActionsCopy({
	text,
	onCopy,
	disabled = false,
	label = "复制",
	iconOnly = false,
	variant = "borderless",
	className,
}: ActionsCopyProps) {
	const [result, setResult] = useState<{ text: string; state: "pending" | "success" | "error" } | null>(null);
	const pending = useRef(false);
	const currentText = useRef(text);
	currentText.current = text;
	const state = result?.text === text ? result.state : null;
	const copy = async () => {
		if (pending.current || disabled || !text) return;
		pending.current = true;
		setResult({ text, state: "pending" });
		try {
			if (onCopy) await onCopy(text);
			else await navigator.clipboard.writeText(text);
			if (currentText.current === text) setResult({ text, state: "success" });
		} catch {
			if (currentText.current === text) setResult({ text, state: "error" });
		} finally {
			pending.current = false;
		}
	};
	const status = state === "success" ? "已复制" : state === "error" ? "复制失败，请重试" : "";
	return (
		<span className="inline-flex items-center">
			<button
				type="button"
				aria-label={label}
				aria-busy={state === "pending" || undefined}
				disabled={disabled || !text || state === "pending"}
				onClick={() => void copy()}
				className={cx(
					actionClass(variant),
					state === "error" ? "text-[var(--kit-danger)]" : "text-[var(--kit-fg-muted)]",
					className,
				)}
			>
				<span aria-hidden>⧉</span>
				{copyButtonLabel(state, iconOnly, label)}
			</button>
			<span role="status" className="sr-only">
				{status}
			</span>
		</span>
	);
}

export type ActionsFeedbackValue = "default" | "like" | "dislike";

export interface ActionsFeedbackProps {
	value: ActionsFeedbackValue;
	onChange: (value: ActionsFeedbackValue) => void;
	disabled?: boolean;
	variant?: ActionsVariant;
	className?: string;
}

/** 受控反馈：重复点击取消，赞与踩互斥；保存反馈由调用方负责。 */
export function ActionsFeedback({
	value,
	onChange,
	disabled = false,
	variant = "borderless",
	className,
}: ActionsFeedbackProps) {
	return (
		<fieldset
			aria-label="回答反馈"
			className={cx("m-0 inline-flex min-w-0 items-center gap-1 border-0 p-0", className)}
		>
			{(["like", "dislike"] as const).map((kind) => (
				<button
					key={kind}
					type="button"
					aria-label={kind === "like" ? "点赞" : "点踩"}
					aria-pressed={value === kind}
					disabled={disabled}
					onClick={() => onChange(value === kind ? "default" : kind)}
					className={cx(
						actionClass(variant),
						value === kind ? "text-[var(--kit-accent)]" : "text-[var(--kit-fg-muted)]",
					)}
				>
					<span aria-hidden>{kind === "like" ? "👍" : "👎"}</span>
				</button>
			))}
		</fieldset>
	);
}

export const Actions = Object.assign(ActionsBase, { Copy: ActionsCopy, Feedback: ActionsFeedback });
