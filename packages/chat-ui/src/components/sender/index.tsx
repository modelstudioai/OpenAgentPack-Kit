import {
	SKILL_INPUT_PREFIX,
	type SkillInputMarker,
	skillInputMarkerRanges,
	skillInputTokens,
} from "@openagentpack/kit-sdk/protocol";
import {
	type AriaAttributes,
	type AriaRole,
	type ClipboardEvent,
	createContext,
	forwardRef,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useContext,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

export type SenderSubmitType = "enter" | "shiftEnter" | false;
export type SenderSemantic = "root" | "prefix" | "input" | "suffix" | "footer";

interface SenderState {
	variant: "default" | "workspace";
	value: string;
	disabled: boolean;
	loading: boolean;
	submitDisabled: boolean;
	clear: () => void;
	cancel: () => void;
}

const SenderContext = createContext<SenderState>({
	variant: "default",
	value: "",
	disabled: true,
	loading: false,
	submitDisabled: true,
	clear: () => undefined,
	cancel: () => undefined,
});

function cx(...names: Array<string | false | undefined>): string {
	return names.filter(Boolean).join(" ");
}

const ACTION =
	"inline-flex shrink-0 items-center justify-center text-[length:var(--kit-text-base)] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50";

function SendButton({ children }: { children?: ReactNode }) {
	const { value, disabled, loading, submitDisabled, variant } = useContext(SenderContext);
	return (
		<button
			type="submit"
			disabled={disabled || loading || submitDisabled || !value.trim()}
			className={cx(
				ACTION,
				"bg-[var(--kit-accent)] font-semibold text-[var(--kit-accent-fg)] enabled:hover:opacity-80",
				variant === "workspace" ? "h-10 min-w-10 rounded-full px-2.5" : "rounded-[var(--kit-radius-sm)] px-4 py-2",
			)}
		>
			{children ?? (variant === "workspace" ? <SenderActionIcon action="send" /> : "发送")}
		</button>
	);
}

function LoadingButton({ children }: { children?: ReactNode }) {
	const { cancel, variant } = useContext(SenderContext);
	return (
		<button
			type="button"
			onClick={cancel}
			className={cx(
				ACTION,
				variant === "workspace"
					? "h-10 min-w-10 rounded-full px-2.5 bg-[var(--kit-accent)] text-[var(--kit-accent-fg)] hover:opacity-80"
					: "rounded-[var(--kit-radius-sm)] bg-[var(--kit-danger)] px-4 py-2 font-semibold text-[var(--kit-danger-fg)]",
			)}
		>
			{children ?? (variant === "workspace" ? <SenderActionIcon action="stop" /> : "停止")}
		</button>
	);
}

function SenderActionIcon({ action }: { action: "send" | "stop" }) {
	return (
		<>
			<span className="sr-only">{action === "send" ? "发送" : "停止"}</span>
			<svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
				{action === "send" ? (
					<path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-6 6 6-6 6 6" />
				) : (
					<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
				)}
			</svg>
		</>
	);
}

function ClearButton({ children = "清空" }: { children?: ReactNode }) {
	const { value, disabled, clear } = useContext(SenderContext);
	return (
		<button
			type="button"
			onClick={clear}
			disabled={disabled || !value}
			className={cx(
				ACTION,
				"rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-4 py-2 text-[var(--kit-fg-muted)]",
			)}
		>
			{children}
		</button>
	);
}

export interface SenderComponents {
	SendButton: typeof SendButton;
	LoadingButton: typeof LoadingButton;
	ClearButton: typeof ClearButton;
}

const COMPONENTS: SenderComponents = { SendButton, LoadingButton, ClearButton };

const EMPTY_SKILL_NAMES: string[] = [];

/** 技能条目：名称必填，描述可选。候选弹层由调用方用 Suggestion 组合，Sender 只负责 chip 投影。 */
export interface SenderSkill {
	name: string;
	description?: string;
}

export interface SenderSelection {
	start: number;
	end: number;
}

export interface BackspaceReplacement {
	value: string;
	caret: number;
}

/** 技能标记整体删除（ADR-0016）：光标落在标记内或紧随其后时一次退格删掉整个标记（含尾随
 * 分隔空格）；选区与标记相交时删除范围扩展到完整标记。其余形态返回 null，走原生退格。 */
export function atomicBackspace(
	value: string,
	selectionStart: number,
	selectionEnd: number,
	markers: readonly SkillInputMarker[],
): BackspaceReplacement | null {
	const start = Math.min(selectionStart, selectionEnd);
	const end = Math.max(selectionStart, selectionEnd);
	for (const marker of markers) {
		const wholeEnd = marker.end + (value[marker.end] === " " ? 1 : 0);
		const intersectsSelection = start !== end && start < wholeEnd && end > marker.start;
		const caretInside = start === end && start > marker.start && start <= marker.end;
		if (caretInside || intersectsSelection)
			return { value: value.slice(0, marker.start) + value.slice(wholeEnd), caret: marker.start };
	}
	return null;
}

/** 技能图标：与资源面板同族（24 viewBox、1.5 描边、currentColor）。 */
export function SkillGlyph({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			className={className}
		>
			<path strokeLinecap="round" strokeLinejoin="round" d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
			<path strokeLinecap="round" strokeLinejoin="round" d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
		</svg>
	);
}

/** 技能标记整体退格：命中原子删除时改写草稿（chip 随 rebuild 消失）并恢复光标；返回是否已消费该按键。 */
function atomicBackspaceKeyDown(
	event: KeyboardEvent<HTMLDivElement>,
	value: string,
	markers: readonly SkillInputMarker[],
	commit: (next: string, caret: number) => void,
): boolean {
	const el = event.currentTarget;
	const { start, end } = selectionOffsets(el);
	const atomic = atomicBackspace(value, start, end, markers);
	if (!atomic) return false;
	event.preventDefault();
	commit(atomic.value, atomic.caret);
	return true;
}

/** 提交载荷：正文里的输入标记派生技能名（skillInputTokens，首现顺序去重）；无标记时省略。 */
function derivedSkillPayload(value: string, skillNames: readonly string[]): string[] | undefined {
	const derived = skillInputTokens(value, skillNames);
	return derived.length ? derived : undefined;
}

export interface SenderProps {
	/** workspace 将编辑区与底部工具栏分开；默认保留单行组合布局。 */
	variant?: "default" | "workspace";
	value?: string;
	defaultValue?: string;
	onChange?: (value: string) => void;
	/** 不会自动清空输入；受控用法在回调里重置 value，非受控用 ref.clear()。
	 * 第二参数是从正文标记派生的技能名（skillInputTokens，按首现顺序去重），无标记时省略。 */
	onSubmit?: (message: string, skills?: string[]) => void;
	onCancel?: () => void;
	/** 先于内置提交逻辑执行；调用 event.preventDefault() 可阻止本次回车提交 */
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	/** 粘贴内容包含文件时触发，并阻止把文件名写进输入框 */
	onPasteFile?: (files: File[]) => void;
	loading?: boolean;
	/** 仅禁止发送，输入仍可编辑；用于连接恢复和等待审批时保留草稿。 */
	submitDisabled?: boolean;
	/** 禁止输入与发送；loading 时仍可点击停止。 */
	disabled?: boolean;
	readOnly?: boolean;
	placeholder?: string;
	/** 当前 Agent 已绑定技能；已知 `/name ` 标记渲染成 chip 节点（contenteditable 原子内联块）。
	 * 候选弹层与插入行为由调用方用 Suggestion 组合（ADR-0016）。 */
	skills?: SenderSkill[];
	/** 编辑区选区变化（value 文本 offset）；配合 Suggestion 的 value/caret 自动触发使用。 */
	onSelectionChange?: (selection: SenderSelection) => void;
	submitType?: SenderSubmitType;
	autoSize?: boolean | { minRows?: number; maxRows?: number };
	inputProps?: AriaAttributes & { id?: string; role?: AriaRole };
	prefix?: ReactNode;
	suffix?: ReactNode | false | ((origin: ReactNode, info: { components: SenderComponents }) => ReactNode);
	header?: ReactNode;
	footer?: ReactNode | ((info: { components: SenderComponents }) => ReactNode);
	className?: string;
	classNames?: Partial<Record<SenderSemantic, string>>;
}

export interface SenderRef {
	nativeElement: HTMLFormElement | null;
	inputElement: HTMLDivElement | null;
	focus: () => void;
	blur: () => void;
	clear: () => void;
	insert: (text: string) => void;
	/** 替换 value 中的 [start, end) 并恢复光标；用于 Suggestion 选中后插入技能标记。 */
	replaceRange: (start: number, end: number, text: string) => void;
}

const PLACEHOLDER: Record<string, string> = {
	enter: "输入消息，Enter 发送，Shift+Enter 换行",
	shiftEnter: "输入消息，Shift+Enter 发送，Enter 换行",
	false: "输入消息",
};

function rowRange(autoSize: SenderProps["autoSize"]): [number, number] {
	if (autoSize === false) return [1, 1];
	if (autoSize === true) return [1, Number.POSITIVE_INFINITY];
	return [autoSize?.minRows ?? 1, autoSize?.maxRows ?? 6];
}

/** 布局与输入逻辑分离，切换样式时仍复用同一编辑区与提交合同。 */
function SenderInputLayout({
	variant,
	prefix,
	suffix,
	classNames,
	children,
}: {
	variant: SenderProps["variant"];
	prefix: ReactNode;
	suffix: ReactNode;
	classNames: NonNullable<SenderProps["classNames"]>;
	children: ReactNode;
}) {
	const workspace = variant === "workspace";
	const trailing =
		suffix === false ? null : <div className={cx("flex shrink-0 items-center gap-2", classNames.suffix)}>{suffix}</div>;
	return (
		<>
			<div className={workspace ? "flex min-w-0 px-3 pt-3" : "flex min-w-0 items-end gap-2 p-2"}>
				{prefix && !workspace ? (
					<div className={cx("flex h-10 shrink-0 items-center", classNames.prefix)}>{prefix}</div>
				) : null}
				{children}
				{workspace ? null : trailing}
			</div>
			{workspace ? (
				<div className="flex min-w-0 items-center justify-between gap-3 px-3 pb-3 pt-2">
					<div className={cx("flex min-w-0 flex-1 flex-wrap items-center gap-2", classNames.prefix)}>{prefix}</div>
					{trailing}
				</div>
			) : null}
		</>
	);
}

/** ref 句柄：getter 读实时 DOM；clear/insert/replaceRange 复用受控 update 语义。 */
function senderHandle(
	rootRef: RefObject<HTMLFormElement | null>,
	inputRef: RefObject<HTMLDivElement | null>,
	update: (next: string) => void,
	value: string,
	commit: (next: string, caret: number | null) => void,
): SenderRef {
	return {
		get nativeElement() {
			return rootRef.current;
		},
		get inputElement() {
			return inputRef.current;
		},
		focus: () => inputRef.current?.focus(),
		blur: () => inputRef.current?.blur(),
		clear: () => update(""),
		insert: (text: string) => {
			const el = inputRef.current;
			if (!el) return update(value + text);
			const { start, end } = selectionOffsets(el);
			update(value.slice(0, start) + text + value.slice(end));
		},
		replaceRange: (start, end, text) => {
			commit(value.slice(0, start) + text + value.slice(end), start + text.length);
		},
	};
}

/** 行高自适应（contenteditable 版）：按 min/maxRows 撑 min/max 高度，内容增长自然撑开、超出滚动。 */
function useAutoRows(inputRef: RefObject<HTMLDivElement | null>, minRows: number, maxRows: number) {
	useLayoutEffect(() => {
		const node = inputRef.current;
		if (!node) return;
		const resize = () => {
			if (node.clientWidth === 0) return;
			const style = getComputedStyle(node);
			const line = Number.parseFloat(style.lineHeight);
			if (!Number.isFinite(line) || line <= 0) return;
			const pad = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
			node.style.minHeight = `${minRows * line + pad}px`;
			node.style.maxHeight = Number.isFinite(maxRows) ? `${maxRows * line + pad}px` : "";
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(node);
		return () => observer.disconnect();
	}, [minRows, maxRows, inputRef.current]);
}

const CHIP_CLASS =
	"inline-flex select-none items-center gap-1 rounded-[var(--kit-radius-chip)] bg-[var(--kit-skill-chip-bg)] px-2 py-0.5 align-baseline text-[length:var(--kit-text-label)] font-medium text-[var(--kit-skill-chip-fg)]";

const SVG_NS = "http://www.w3.org/2000/svg";
const GLYPH_PATHS = ["M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z", "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"];

/** 技能 chip 节点：contenteditable=false 的原子内联块（图标 + 名称），与消息气泡 chip 同款视觉。 */
function makeChipNode(name: string): HTMLElement {
	const chip = document.createElement("span");
	chip.dataset.skill = name;
	chip.contentEditable = "false";
	chip.className = CHIP_CLASS;
	const glyph = document.createElementNS(SVG_NS, "svg");
	glyph.setAttribute("aria-hidden", "true");
	glyph.setAttribute("viewBox", "0 0 24 24");
	glyph.setAttribute("fill", "none");
	glyph.setAttribute("stroke", "currentColor");
	glyph.setAttribute("stroke-width", "1.5");
	glyph.setAttribute("class", "size-3.5 shrink-0");
	for (const d of GLYPH_PATHS) {
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("stroke-linecap", "round");
		path.setAttribute("stroke-linejoin", "round");
		path.setAttribute("d", d);
		glyph.append(path);
	}
	const label = document.createElement("span");
	label.textContent = name;
	chip.append(glyph, label);
	return chip;
}

function isSkillChip(node: Node): node is HTMLElement {
	return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset?.skill !== undefined;
}

/** 流内节点在 value 文本里的长度：chip 序列化为 `/name `（协议标记），文本按长度，其余 0。 */
function nodeTextLength(node: Node): number {
	if (isSkillChip(node)) return SKILL_INPUT_PREFIX.length + (node.dataset.skill?.length ?? 0) + 1;
	return node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0;
}

/** 前序遍历编辑区流内容：chip 作为单节点（子树跳过），文本与 br 逐节点，返回 true 时停止。 */
function forEachFlow(root: HTMLElement, visit: (node: Node) => boolean | undefined): void {
	const walk = (node: Node): boolean => {
		for (const child of Array.from(node.childNodes)) {
			if (isSkillChip(child) || child.nodeType === Node.TEXT_NODE || child.nodeName === "BR") {
				if (visit(child) === true) return true;
			} else if (child.nodeType === Node.ELEMENT_NODE && walk(child)) {
				return true;
			}
		}
		return false;
	};
	walk(root);
}

/** 编辑区 DOM → 草稿文本：chip 还原为 `/name ` 标记，br 还原为换行；纯换行内容按空草稿。
 *  导出仅供测试与宿主投影核对，不属于公共组件 API（index.ts 不转发）。 */
export function serializeEditable(root: HTMLElement): string {
	let out = "";
	const walk = (node: Node) => {
		for (const child of Array.from(node.childNodes)) {
			if (isSkillChip(child)) out += `${SKILL_INPUT_PREFIX}${child.dataset.skill} `;
			else if (child.nodeName === "BR") out += "\n";
			else if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? "";
			else walk(child);
		}
	};
	walk(root);
	return /^\n*$/.test(out) ? "" : out;
}

/** 草稿文本 → 编辑区 DOM：已知技能标记渲染成 chip 节点，其余为文本节点；空内容放占位 br。
 *  导出仅供测试与宿主投影核对，不属于公共组件 API（index.ts 不转发）。 */
export function renderValueInto(root: HTMLElement, value: string, names: readonly string[]): void {
	root.textContent = "";
	let cursor = 0;
	for (const marker of skillInputMarkerRanges(value, names)) {
		if (marker.start > cursor) root.append(document.createTextNode(value.slice(cursor, marker.start)));
		root.append(makeChipNode(value.slice(marker.start + SKILL_INPUT_PREFIX.length, marker.end)));
		// 分隔空格归 chip 所有（serializeEditable 记 `/name ` 全长），不落进下一文本节点。
		cursor = marker.end + (value[marker.end] === " " ? 1 : 0);
	}
	if (cursor < value.length) root.append(document.createTextNode(value.slice(cursor)));
}

/** DOM 位置 → value 文本 offset：chip 记其标记长度，落点在 chip 内部按其边界归位。 */
function textOffsetAt(root: HTMLElement, container: Node, offsetInContainer: number): number {
	let total = 0;
	let found: number | null = null;
	forEachFlow(root, (node) => {
		if (node === container) {
			found = total + offsetInContainer;
			return true;
		}
		total += nodeTextLength(node);
		return false;
	});
	if (found !== null) return found;
	if (container === root) {
		let index = 0;
		let acc = 0;
		let boundary: number | null = null;
		forEachFlow(root, (node) => {
			if (index >= offsetInContainer) {
				boundary = acc;
				return true;
			}
			acc += nodeTextLength(node);
			index++;
			return false;
		});
		return boundary ?? acc;
	}
	return total;
}

/** 当前选区在 value 文本中的 [start, end]（未聚焦时 0,0）。 */
function selectionOffsets(root: HTMLElement): { start: number; end: number } {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return { start: 0, end: 0 };
	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer)) return { start: 0, end: 0 };
	const start = textOffsetAt(root, range.startContainer, range.startOffset);
	const end = textOffsetAt(root, range.endContainer, range.endOffset);
	return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** 把光标放到 value 文本 offset 处：落在文本内取精确位置，落在 chip 边界取其前停靠点。
 *  编辑器未聚焦时不动全局选区——外部清空草稿不应抢走他处的光标。 */
function setCaretAtTextOffset(root: HTMLElement, offset: number): void {
	const selection = window.getSelection();
	if (!selection) return;
	const active = document.activeElement;
	if (active !== root && !(active && root.contains(active))) return;
	const range = document.createRange();
	let total = 0;
	let done = false;
	forEachFlow(root, (node) => {
		const len = nodeTextLength(node);
		if (node.nodeType === Node.TEXT_NODE && total + len >= offset) {
			range.setStart(node, offset - total);
			done = true;
			return true;
		}
		if (isSkillChip(node) && total === offset) {
			range.setStart(node, 0);
			done = true;
			return true;
		}
		total += len;
		return false;
	});
	if (!done) range.setStart(root, root.childNodes.length);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

/** Enter 提交判定：submitType=enter 时 Enter 提交、Shift+Enter 换行（shiftEnter 反之）；
 *  contenteditable 的默认回车会产生块级元素，换行统一改为插入 br。 */
function submitKeyDown(event: KeyboardEvent<HTMLDivElement>, submitType: SenderSubmitType): boolean {
	if (event.key !== "Enter" || submitType === false) return false;
	const shouldSubmit = submitType === "enter" ? !event.shiftKey : event.shiftKey;
	event.preventDefault();
	if (!shouldSubmit) document.execCommand("insertLineBreak");
	return true;
}

/** value↔DOM 同步：编辑动作（原子退格、选技能）改 value 后由 effect 重建 DOM 并恢复光标。
 *  DOM 是编辑态的源，value 是其序列化投影；一致时不动 DOM（光标由浏览器管理）。 */
function useEditableProjection(
	inputRef: RefObject<HTMLDivElement | null>,
	value: string,
	skillNames: readonly string[],
	update: (next: string) => void,
	onCaret?: (caret: number) => void,
) {
	const pendingCaret = useRef<number | null>(null);
	const onCaretRef = useRef(onCaret);
	onCaretRef.current = onCaret;
	const commit = (next: string, caret: number | null = null) => {
		pendingCaret.current = caret;
		update(next);
	};
	useLayoutEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		// 空草稿时编辑残骸（br、空文本节点）也要清掉：残骸会把光标顶到占位符后面。
		const stale = serializeEditable(el) !== value || (value === "" && el.firstChild !== null);
		if (!stale) {
			pendingCaret.current = null;
			return;
		}
		renderValueInto(el, value, skillNames);
		const caret = pendingCaret.current ?? (value === "" ? 0 : null);
		pendingCaret.current = null;
		if (caret !== null) {
			setCaretAtTextOffset(el, caret);
			onCaretRef.current?.(caret);
		}
	}, [value, skillNames, inputRef]);
	return commit;
}

/** 提交守卫：禁用/加载/显式禁发/空草稿都不发。 */
function canSubmit(state: {
	disabled: boolean;
	readOnly: boolean;
	loading: boolean;
	submitDisabled: boolean;
	value: string;
}): boolean {
	return !state.disabled && !state.readOnly && !state.loading && !state.submitDisabled && state.value.trim().length > 0;
}

const InternalSender = forwardRef<SenderRef, SenderProps>(function Sender(
	{
		variant = "default",
		value: controlledValue,
		defaultValue = "",
		onChange,
		onSubmit,
		onCancel,
		onKeyDown,
		onPasteFile,
		loading = false,
		submitDisabled = false,
		disabled = false,
		readOnly = false,
		placeholder,
		skills,
		onSelectionChange,
		submitType = "enter",
		autoSize,
		inputProps,
		prefix,
		suffix,
		header,
		footer,
		className,
		classNames = {},
	},
	ref,
) {
	const [innerValue, setInnerValue] = useState(defaultValue);
	const value = controlledValue ?? innerValue;
	const rootRef = useRef<HTMLFormElement>(null);
	const inputRef = useRef<HTMLDivElement>(null);
	const skillNames = useMemo(() => skills?.map((skill) => skill.name) ?? EMPTY_SKILL_NAMES, [skills]);
	const markers = skillInputMarkerRanges(value, skillNames);

	const update = (next: string) => {
		if (controlledValue === undefined) setInnerValue(next);
		onChange?.(next);
	};
	const selectionRef = useRef(onSelectionChange);
	selectionRef.current = onSelectionChange;
	const commit = useEditableProjection(inputRef, value, skillNames, update, (caret) =>
		selectionRef.current?.({ start: caret, end: caret }),
	);
	const reportSelection = () => {
		const el = inputRef.current;
		if (!el) return;
		selectionRef.current?.(selectionOffsets(el));
	};
	const submit = () => {
		if (!canSubmit({ disabled, readOnly, loading, submitDisabled, value })) return;
		onSubmit?.(value, derivedSkillPayload(value, skillNames));
	};

	useImperativeHandle(ref, () => senderHandle(rootRef, inputRef, update, value, commit));

	const handleEditKeys = (event: KeyboardEvent<HTMLDivElement>): boolean => {
		// 技能 chip 是原子整体：退格落在标记内或紧随其后时整体删除，不做逐字符拆解（ADR-0016）。
		return event.key === "Backspace" && editable && atomicBackspaceKeyDown(event, value, markers, commit);
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		onKeyDown?.(event);
		// 输入法合成中的回车用于确认候选词；Safari 在合成结束后补发 keyCode 229 的 keydown
		const composing = event.nativeEvent.isComposing || event.keyCode === 229;
		if (composing || event.defaultPrevented) return;
		if (handleEditKeys(event)) return;
		if (submitKeyDown(event, submitType)) submit();
	};
	const handleInput = () => {
		const el = inputRef.current;
		if (!el) return;
		const next = serializeEditable(el);
		update(next);
		reportSelection();
	};
	const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
		if (!editable) return;
		const files = Array.from(event.clipboardData.files);
		if (files.length > 0 && onPasteFile) {
			event.preventDefault();
			onPasteFile(files);
			return;
		}
		// 只收纯文本：阻止富文本 HTML 进入，保持草稿为纯文本 + chip 节点。
		const text = event.clipboardData.getData("text/plain");
		if (text) {
			event.preventDefault();
			document.execCommand("insertText", false, text);
		}
	};

	const editable = !disabled && !readOnly;
	const [minRows, maxRows] = rowRange(autoSize);
	useAutoRows(inputRef, minRows, maxRows);
	const origin = loading ? <LoadingButton /> : <SendButton />;
	const suffixNode = typeof suffix === "function" ? suffix(origin, { components: COMPONENTS }) : (suffix ?? origin);
	const footerNode = typeof footer === "function" ? footer({ components: COMPONENTS }) : footer;
	const state: SenderState = {
		variant,
		value,
		disabled: !editable,
		loading,
		submitDisabled,
		clear: () => update(""),
		cancel: () => onCancel?.(),
	};

	return (
		<SenderContext.Provider value={state}>
			<form
				ref={rootRef}
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
				className={cx(
					"relative flex min-w-0 flex-col border border-[var(--kit-border)] shadow-[var(--kit-shadow)] transition-[border-color,box-shadow] focus-within:border-[var(--kit-focus)] focus-within:ring-2 focus-within:ring-[var(--kit-focus)]/15",
					variant === "workspace" ? "rounded-[var(--kit-radius-composer)]" : "rounded-[var(--kit-radius)]",
					disabled ? "bg-[var(--kit-bg-subtle)]" : "bg-[var(--kit-surface)]",
					className,
					classNames.root,
				)}
			>
				{header}
				<SenderInputLayout variant={variant} prefix={prefix} suffix={suffixNode} classNames={classNames}>
					<div className="relative min-w-0 flex-1">
						{/* 内容由同步 effect 管理（DOM 是编辑态的源），React 不渲染子节点避免 diff 冲突。 */}
						{/* biome-ignore lint/a11y/useSemanticElements: 富文本编辑区（chip 节点）没有对应原生元素，textbox 是 contenteditable 的标准语义 */}
						{/* biome-ignore lint/a11y/useFocusableInteractive: contenteditable 元素原生可聚焦 */}
						<div
							ref={inputRef}
							contentEditable={editable}
							suppressContentEditableWarning
							role="textbox"
							aria-multiline="true"
							aria-label="消息输入"
							aria-disabled={editable ? undefined : "true"}
							data-placeholder={placeholder ?? PLACEHOLDER[String(submitType)]}
							data-empty={value ? undefined : "true"}
							onInput={handleInput}
							onKeyDown={handleKeyDown}
							onKeyUp={reportSelection}
							onSelect={reportSelection}
							onMouseUp={reportSelection}
							onFocus={reportSelection}
							onPaste={handlePaste}
							spellCheck={false}
							{...inputProps}
							className={cx(
								"w-full overflow-y-auto whitespace-pre-wrap break-words p-2 text-[length:var(--kit-text-heading)] leading-[var(--kit-leading-body)] text-[var(--kit-fg)] caret-[var(--kit-fg)] outline-none disabled:cursor-not-allowed md:text-[length:var(--kit-text-body)]",
								"data-[empty=true]:before:pointer-events-none data-[empty=true]:before:content-[attr(data-placeholder)] data-[empty=true]:before:text-[var(--kit-fg-muted)]",
								classNames.input,
							)}
						/>
					</div>
				</SenderInputLayout>
				{footerNode ? (
					<div className={cx("border-t border-[var(--kit-border)] px-3 py-2", classNames.footer)}>{footerNode}</div>
				) : null}
			</form>
		</SenderContext.Provider>
	);
});

export interface SenderHeaderProps {
	title?: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	closable?: boolean;
	children?: ReactNode;
	className?: string;
}

/** 输入框上方的展开面板（附件、引用等），渲染在 Sender 的边框之内。 */
export function SenderHeader({
	title,
	open = false,
	onOpenChange,
	closable = true,
	children,
	className,
}: SenderHeaderProps) {
	if (!open) return null;
	return (
		<div className={cx("min-w-0 border-b border-[var(--kit-border-subtle)]", className)}>
			{title || closable ? (
				<div className="flex items-center justify-between gap-2 px-3 pt-2.5 text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg)]">
					<span>{title}</span>
					{closable ? (
						<button
							type="button"
							aria-label="收起"
							onClick={() => onOpenChange?.(false)}
							className="rounded px-1 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] hover:text-[var(--kit-fg)]"
						>
							✕
						</button>
					) : null}
				</div>
			) : null}
			<div className="max-h-[min(var(--kit-composer-pane-max-height),calc(var(--kit-viewport-height,100dvh)/5))] overflow-y-auto overscroll-contain p-3">
				{children}
			</div>
		</div>
	);
}

export const Sender = Object.assign(InternalSender, { Header: SenderHeader });
