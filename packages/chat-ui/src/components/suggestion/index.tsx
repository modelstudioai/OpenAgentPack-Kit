import { type AriaAttributes, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface SuggestionItem {
	label: ReactNode;
	value: string;
	description?: ReactNode;
	icon?: ReactNode;
	extra?: ReactNode;
	children?: SuggestionItem[];
	/** Optional extra search terms; value is always searched. */
	keywords?: string[];
	/** Business metadata returned unchanged with selection. */
	data?: unknown;
}

export interface SuggestionSelectContext {
	trigger: string;
	query: string;
	/** Trigger position in the controlled value. */
	start: number;
	/** Caret position at selection time. */
	end: number;
}

export interface SuggestionRenderProps<T> {
	/** 传入 info 打开（info 会传给函数形式的 items），传 false 关闭 */
	onTrigger: (info?: T | false) => void;
	/** 交给输入框；弹层打开时接管方向键、Enter、Tab 与 Esc，并阻止输入框的回车提交 */
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	inputProps: AriaAttributes & { role: "combobox" };
	/** Current trigger query when automatic triggering is enabled. */
	query?: string;
}

export type SuggestionSemantic = "root" | "popup" | "list" | "item";

type TriggerQuery = { start: number; query: string };

export interface SuggestionProps<T = unknown> {
	items?: SuggestionItem[] | ((info?: T) => SuggestionItem[]);
	/** Controlled text value; required for automatic trigger detection. */
	value?: string;
	/** Current caret offset in value; required for automatic trigger detection. */
	caret?: number;
	/** Slash trigger, or a custom detector. Omit to keep manual onTrigger behavior. */
	trigger?: string | ((state: { value: string; caret: number }) => TriggerQuery | null);
	/** Candidate filter for the active query. Defaults to value/keyword prefix matching. */
	filter?: (item: SuggestionItem, query: string) => boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onSelect?: (value: string, item: SuggestionItem, context: SuggestionSelectContext | undefined) => void;
	block?: boolean;
	children: (props: SuggestionRenderProps<T>) => ReactNode;
	className?: string;
	classNames?: Partial<Record<SuggestionSemantic, string>>;
}

function cx(...names: Array<string | false | undefined>): string {
	return names.filter(Boolean).join(" ");
}

/** Find an active trigger before the caret. A trigger must start a word and the query cannot cross whitespace. */
export function activeTriggerQuery(value: string, caret: number, trigger: string): TriggerQuery | null {
	const end = Math.min(caret, value.length);
	for (let index = end - 1; index >= 0; index--) {
		if (value.startsWith(trigger, index)) {
			const bounded = index === 0 || /\s/.test(value[index - 1] ?? "");
			return bounded ? { start: index, query: value.slice(index + trigger.length, end) } : null;
		}
		if (/\s/.test(value[index] ?? "")) return null;
	}
	return null;
}

function resolveTrigger(trigger: SuggestionProps["trigger"], value: string, caret: number): TriggerQuery | null {
	if (typeof trigger === "function") return trigger({ value, caret });
	return trigger ? activeTriggerQuery(value, caret, trigger) : null;
}

function defaultFilter(item: SuggestionItem, query: string): boolean {
	const needle = query.toLocaleLowerCase();
	return [item.value, ...(item.keywords ?? [])].some((value) => value.toLocaleLowerCase().startsWith(needle));
}

function filterItems(
	items: SuggestionItem[],
	query: string | undefined,
	filter: (item: SuggestionItem, query: string) => boolean,
): SuggestionItem[] {
	if (query === undefined) return items;
	return items.flatMap((item) => {
		const children = item.children ? filterItems(item.children, query, filter) : undefined;
		if (!filter(item, query) && !children?.length) return [];
		return [{ ...item, ...(children ? { children } : {}) }];
	});
}

/** 候选可能在同一查询下更新；渲染与键盘处理共用当前仍有效的高亮路径。 */
function buildNavigation(roots: SuggestionItem[], requestedPath: number[]) {
	const columns = [roots];
	const path: number[] = [];
	for (let depth = 0; depth < requestedPath.length; depth++) {
		const column = columns[depth];
		if (!column?.length) break;
		const index = Math.max(0, Math.min(requestedPath[depth] ?? 0, column.length - 1));
		path.push(index);
		const children = column[index]?.children;
		if (!children?.length) break;
		columns.push(children);
	}
	return { columns, path: path.length ? path : [0] };
}

function selectionContext(
	trigger: SuggestionProps["trigger"],
	triggerQuery: TriggerQuery | null,
	caret: number | undefined,
	value: string | undefined,
): SuggestionSelectContext | undefined {
	if (!triggerQuery) return undefined;
	return {
		trigger: typeof trigger === "string" ? trigger : "",
		...triggerQuery,
		end: caret ?? value?.length ?? 0,
	};
}

function useOpenState({
	open,
	onOpenChange,
	automatic,
	triggerKey,
	hasItems,
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	automatic: boolean;
	triggerKey: string | null;
	hasItems: boolean;
}) {
	const [innerOpen, setInnerOpen] = useState(false);
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);

	// 查询变化后解除 Esc 的临时关闭；同一次查询保持关闭。
	useEffect(() => {
		if (dismissedKey !== null && dismissedKey !== triggerKey) setDismissedKey(null);
	}, [dismissedKey, triggerKey]);

	const autoOpen = automatic && triggerKey !== null && hasItems && dismissedKey !== triggerKey;
	const isOpen = open ?? (automatic ? autoOpen : innerOpen);
	const changeOpen = (next: boolean) => {
		if (next === isOpen) return;
		if (open === undefined) {
			if (!automatic) setInnerOpen(next);
			else if (next) setDismissedKey(null);
			else if (triggerKey !== null) setDismissedKey(triggerKey);
		}
		onOpenChange?.(next);
	};
	return { isOpen, changeOpen };
}

/** 弹层打开时各按键的动作：返回新的高亮路径、选择/关闭，或 null 表示不处理（交还输入框）。 */
const KEY_HANDLERS: Record<string, (state: { column: SuggestionItem[]; depth: number; path: number[] }) => KeyAction> =
	{
		ArrowDown: ({ column, depth, path }) => [...path.slice(0, depth), ((path[depth] ?? 0) + 1) % column.length],
		ArrowUp: ({ column, depth, path }) => [
			...path.slice(0, depth),
			((path[depth] ?? 0) - 1 + column.length) % column.length,
		],
		ArrowRight: ({ column, depth, path }) =>
			column[path[depth] ?? 0]?.children?.length ? [...path.slice(0, depth + 1), 0] : null,
		ArrowLeft: ({ depth, path }) => (depth > 0 ? path.slice(0, depth) : null),
		Enter: () => "select",
		Tab: () => "select",
		Escape: () => "close",
	};

type KeyAction = number[] | "select" | "close" | null;

function SuggestionOption({
	item,
	id,
	selected,
	onHover,
	onChoose,
	className,
}: {
	item: SuggestionItem;
	id: string;
	selected: boolean;
	onHover: () => void;
	onChoose: () => void;
	className?: string;
}) {
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: 键盘选择由输入框的 onKeyDown 统一处理（焦点始终留在输入框）
		<div
			id={id}
			role="option"
			tabIndex={-1}
			aria-selected={selected}
			// 用 mousemove 而非 mouseenter：弹层在静止指针下重挂载时浏览器会合成
			// mouseenter，不应劫持键盘高亮；真实移动指针才会更新高亮。
			onMouseMove={onHover}
			onClick={onChoose}
			className={cx(
				"flex cursor-pointer items-center gap-2 rounded-[var(--kit-radius-sm)] px-2.5 py-1.5 text-[length:var(--kit-text-label)] text-[var(--kit-fg)]",
				selected && "bg-[var(--kit-bg-subtle)]",
				className,
			)}
		>
			{item.icon ? (
				<span aria-hidden className="shrink-0">
					{item.icon}
				</span>
			) : null}
			<span className={cx("min-w-0", item.description ? "shrink-0 font-medium" : "flex-1 break-words")}>
				{item.label}
			</span>
			{item.description ? (
				<span
					title={typeof item.description === "string" ? item.description : undefined}
					className="min-w-0 flex-1 truncate text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]"
				>
					{item.description}
				</span>
			) : null}
			{item.extra ? (
				<span className="shrink-0 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">{item.extra}</span>
			) : null}
			{item.children?.length ? (
				<span aria-hidden className="shrink-0 text-[var(--kit-fg-muted)]">
					›
				</span>
			) : null}
		</div>
	);
}

function SuggestionPopup({
	id,
	columns,
	path,
	block,
	classNames,
	onHover,
	onChoose,
}: {
	id: string;
	columns: SuggestionItem[][];
	path: number[];
	block: boolean;
	classNames: NonNullable<SuggestionProps["classNames"]>;
	onHover: (depth: number, index: number) => void;
	onChoose: (depth: number, index: number) => void;
}) {
	return (
		<div
			className={cx(
				"absolute bottom-full left-0 z-20 mb-2 flex max-w-full overflow-x-auto rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] shadow-[var(--kit-shadow)]",
				block && "right-0",
				classNames.popup,
			)}
		>
			{columns.map((column, depth) => (
				<div
					key={depth}
					id={`${id}-list-${depth}`}
					role="listbox"
					aria-label={depth === 0 ? "快捷指令" : "下一级指令"}
					// 阻止 mousedown 的默认行为：点击候选时输入框不失焦，键盘可以继续操作
					onMouseDown={(event) => event.preventDefault()}
					className={cx(
						"max-h-64 min-w-48 overflow-y-auto p-1",
						depth > 0 && "border-l border-[var(--kit-border)]",
						block && "flex-1",
						classNames.list,
					)}
				>
					{column.map((item, index) => (
						<SuggestionOption
							key={item.value}
							id={`${id}-option-${depth}-${index}`}
							item={item}
							selected={path[depth] === index}
							onHover={() => onHover(depth, index)}
							onChoose={() => onChoose(depth, index)}
							className={classNames.item}
						/>
					))}
				</div>
			))}
		</div>
	);
}

/** 快捷指令：包住输入框，按调用方的触发规则弹出候选，支持级联子项与键盘选择。 */
export function Suggestion<T = unknown>({
	items = [],
	value,
	caret,
	trigger,
	filter = defaultFilter,
	open,
	onOpenChange,
	onSelect,
	block = false,
	children,
	className,
	classNames = {},
}: SuggestionProps<T>) {
	const id = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const [info, setInfo] = useState<T>();
	// path[d] 是第 d 列的高亮项；列数随高亮项是否有子项展开
	const [requestedPath, setPath] = useState<number[]>([0]);
	const triggerQuery = resolveTrigger(trigger, value ?? "", caret ?? value?.length ?? 0);
	const triggerKey = triggerQuery ? `${triggerQuery.start}:${triggerQuery.query}` : null;
	// 自动触发没有经过 onTrigger；查询变化或结束时同样重置高亮，避免过滤后沿用旧索引。
	const previousTriggerKey = useRef(triggerKey);
	useEffect(() => {
		if (previousTriggerKey.current === triggerKey) return;
		previousTriggerKey.current = triggerKey;
		setPath([0]);
	}, [triggerKey]);
	const query = triggerQuery?.query;
	const roots = filterItems(typeof items === "function" ? items(info) : items, query, filter);
	const { isOpen, changeOpen } = useOpenState({
		open,
		onOpenChange,
		automatic: trigger !== undefined,
		triggerKey,
		hasItems: roots.length > 0,
	});
	const { columns, path } = buildNavigation(roots, requestedPath);
	const focusDepth = Math.min(path.length, columns.length) - 1;
	const popupOpen = isOpen && roots.length > 0;
	const activeId = `${id}-option-${focusDepth}-${path[focusDepth] ?? 0}`;

	const changeOpenRef = useRef(changeOpen);
	changeOpenRef.current = changeOpen;

	const onTrigger = (next?: T | false) => {
		if (next === false) {
			changeOpen(false);
			return;
		}
		setInfo(next);
		setPath([0]);
		changeOpen(true);
	};

	const choose = (depth: number, index: number) => {
		const item = columns[depth]?.[index];
		if (!item) return;
		if (item.children?.length) {
			setPath([...path.slice(0, depth), index, 0]);
			return;
		}
		onSelect?.(item.value, item, selectionContext(trigger, triggerQuery, caret, value));
		changeOpen(false);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (!isOpen || roots.length === 0 || event.nativeEvent.isComposing || event.keyCode === 229) return;
		const handler = KEY_HANDLERS[event.key];
		if (!handler) return;
		const next = handler({ column: columns[focusDepth] ?? [], depth: focusDepth, path });
		if (next === null) return;
		event.preventDefault();
		if (next === "select") choose(focusDepth, path[focusDepth] ?? 0);
		else if (next === "close") changeOpen(false);
		else setPath(next);
	};

	useEffect(() => {
		if (!isOpen) return;
		const closeOutside = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) changeOpenRef.current(false);
		};
		document.addEventListener("pointerdown", closeOutside);
		return () => document.removeEventListener("pointerdown", closeOutside);
	}, [isOpen]);

	useEffect(() => {
		if (!popupOpen) return;
		const option = document.getElementById(activeId);
		const list = option?.parentElement;
		if (!option || !list) return;
		const optionRect = option.getBoundingClientRect();
		const listRect = list.getBoundingClientRect();
		if (optionRect.top < listRect.top) list.scrollTop += optionRect.top - listRect.top;
		else if (optionRect.bottom > listRect.bottom) list.scrollTop += optionRect.bottom - listRect.bottom;
	}, [popupOpen, activeId]);

	return (
		<div ref={rootRef} className={cx("relative", block ? "w-full" : "inline-block", className, classNames.root)}>
			{children({
				onTrigger,
				onKeyDown,
				query,
				inputProps: {
					role: "combobox",
					"aria-autocomplete": "list",
					"aria-haspopup": "listbox",
					"aria-expanded": popupOpen,
					"aria-controls": popupOpen ? `${id}-list-${focusDepth}` : undefined,
					"aria-activedescendant": popupOpen ? activeId : undefined,
				},
			})}
			{popupOpen ? (
				<SuggestionPopup
					id={id}
					columns={columns}
					path={path}
					block={block}
					classNames={classNames}
					onHover={(depth, index) => setPath([...path.slice(0, depth), index])}
					onChoose={choose}
				/>
			) : null}
		</div>
	);
}
