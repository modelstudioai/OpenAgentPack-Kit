import type { SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { type ReactNode, useEffect, useRef } from "react";
import { ProcessSpinner } from "../process/step/index.tsx";
import { Tooltip } from "../tooltip/index.tsx";

/** 行内状态标记取值是中性展示词，图例沿用既有语义：运行中是执行过程同款旋转指示环，需要注意是
 * 审批卡同款警示三角，失败是 StepMarker 同款叉，已完成是对勾。着色用 `--kit-warning`/`--kit-danger`
 * 本体色——`-fg` 变体是给深色底上文字的对比色，形状标记读不出「黄」。 */
type StatusMark = "running" | "attention" | "failed" | "completed";

const STATUS_MARKS: Record<StatusMark, { label: string; className?: string; spinner?: boolean; path?: string }> = {
	running: { label: "生成中", spinner: true },
	attention: {
		label: "等待审批",
		className: "text-[var(--kit-warning)]",
		path: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01",
	},
	failed: { label: "执行失败", className: "text-[var(--kit-danger)]", path: "M6 6l12 12M18 6 6 18" },
	completed: { label: "已完成", path: "M20 6 9 17l-5-5" },
};

/** 服务端索引状态（协议词汇）→ 展示标记的映射：协议词汇收敛在此一处，prop 与标记只认中性词。 */
const SESSION_STATUS_MARKS: Record<string, StatusMark> = {
	running: "running",
	requires_action: "attention",
	failed: "failed",
};

/** 行内标记取值次序：打开行实时态 > 该行索引状态（列表重取前的滞留值最弱）。 */
function rowMark(active: boolean, activeStatus: StatusMark | undefined, status: string | undefined) {
	const indexMark = status ? SESSION_STATUS_MARKS[status] : undefined;
	return (
		(active && activeStatus ? STATUS_MARKS[activeStatus] : undefined) ??
		(indexMark ? STATUS_MARKS[indexMark] : undefined)
	);
}

/** 侧栏搜索：按展示标题（title 回退 agent_slug）不区分大小写匹配。 */
export function filterSessions(sessions: SessionSummary[], keyword: string): SessionSummary[] {
	const q = keyword.trim().toLowerCase();
	if (!q) return sessions;
	return sessions.filter((session) => (session.title || session.agent_slug || "").toLowerCase().includes(q));
}

export interface SessionListProps {
	sessions: SessionSummary[];
	activeId: string | null;
	/** 行点击回传该行会话摘要：导航所需的 agent_slug 等字段随点击携带，调用方无需反查列表。 */
	onSelect: (session: SessionSummary) => void;
	/** 行尾「更多操作」菜单：每行渲染时调用 `menu(session)`，返回的元素闭包持有该行会话（⋯ 触发
	 * 按钮、弹层与菜单项全部由业务渲染；删除等破坏性动作由业务自备 AlertDialog 确认）。操作槽的
	 * 悬停显隐与编辑态隐藏由本组件持有；函数身份无需稳定。 */
	menu?: (session: SessionSummary) => ReactNode;
	/** 受控行内重命名：设为会话 id 让该行进入编辑态（通常在菜单「重命名」项 onClick 里设置）。 */
	editingId?: string | null;
	/** 编辑提交（Enter 或失焦）后回调：入参为会话 id 与去空白、截断到 120 字符的新标题；
	 * 清空或与展示标题相同视为取消，只退出不改名。 */
	onEdited?: (id: string, title: string) => void;
	/** 编辑态退出（提交或 Escape）时回调；受控模式下由调用方在此清空 editingId。 */
	onEditEnd?: (id: string) => void;
	/** 当前选中会话的实时状态，优先于该行索引状态展示——回合收敛后索引要等列表重取才更新，实时态
	 * 先行；只作用于打开行，不传时该行按 `session.status` 展示。`completed` 是纯前端提示：索引终态
	 * 只有 idle 没有完成语义，由调用方在回合收敛时设置、点击行或切换会话后清除。 */
	activeStatus?: "running" | "attention" | "failed" | "completed";
	/** workspace 使用舒展行高与按输入方式显隐的操作入口。 */
	variant?: "default" | "workspace";
	/** 无障碍名称：同一页面会有多个会话列表（侧栏分组/最近），用不同标签区分导航语义。 */
	ariaLabel?: string;
	className?: string;
}

function sessionItemClasses(workspace: boolean, active: boolean) {
	const focusClass = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--kit-focus)]";
	// 编辑框焦点提示走描边加深而非 outline 环：文本框聚焦必然命中 :focus-visible，宿主全局焦点环
	// （如体验页 index.html 的 body 级规则）会以 +2px 外扩环压过 kit 的 -2px 内缩环，白底输入框上
	// 视觉膨胀一圈；outline-none 压掉宿主环后用 border 颜色表达焦点。
	const editFocusClass = "outline-none focus-visible:border-[var(--kit-focus)]";
	if (!workspace) {
		return {
			row: `mb-0.5 flex w-full items-center gap-1 rounded-[var(--kit-radius-sm)] px-2.5 py-1.5 text-[length:var(--kit-text-label)] ${
				active ? "bg-[var(--kit-nav-active)] font-medium" : "hover:bg-[var(--kit-surface)]"
			}`,
			select: "min-w-0 flex-1 text-left",
			edit: `min-w-0 flex-1 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] px-2 py-1 text-[length:var(--kit-text-label)] ${editFocusClass}`,
			actions:
				"flex size-7 shrink-0 items-center justify-center rounded opacity-60 transition-opacity duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:opacity-100",
		};
	}
	return {
		row: `group/session mb-1 flex w-full items-stretch rounded-[var(--kit-radius-sm)] text-[length:var(--kit-text-label)] ${
			active ? "bg-[var(--kit-nav-active)] font-medium" : "hover:bg-[var(--kit-nav-active)]/50"
		}`,
		select: `min-h-8 min-w-0 flex-1 cursor-pointer rounded-[var(--kit-radius-sm)] px-3 py-1.5 text-left ${focusClass}`,
		edit: `min-h-8 min-w-0 flex-1 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] px-3 py-1.5 text-[length:var(--kit-text-label)] ${editFocusClass}`,
		// 仅无触摸输入的细指针设备收起操作；触发按钮由业务渲染（压掉 button 的 outline，键盘提示交给
		// 行的 focus-within 显隐），操作槽只管显隐与占位。
		actions: `flex w-9 shrink-0 items-center justify-center rounded-[var(--kit-radius-sm)] text-[var(--kit-fg-muted)] transition-opacity duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none ${
			active
				? ""
				: "[@media(hover:hover)_and_(pointer:fine)_and_(not_(any-pointer:coarse))]:opacity-0 group-hover/session:opacity-100 group-focus-within/session:opacity-100"
		}`,
	};
}

/** 行内重命名输入框：只在编辑态挂载，Enter 或失焦提交、Escape 取消；
 * 卸载引发的失焦不再重复触发，提交校验（去空白、截断 120）由行统一处理后走 onEdited。 */
function RenameInput({
	title,
	className,
	onFinish,
}: {
	title: string;
	className: string;
	onFinish: (next: string | null) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const finishedRef = useRef(false);
	// 输入框只在编辑态挂载，挂载即聚焦；onFocus 里顺带全选方便整段替换。
	useEffect(() => {
		inputRef.current?.focus();
	}, []);
	const finish = (next: string | null) => {
		if (finishedRef.current) return;
		finishedRef.current = true;
		onFinish(next);
	};
	return (
		<input
			ref={inputRef}
			type="text"
			defaultValue={title}
			onBlur={() => finish(inputRef.current?.value ?? null)}
			onFocus={(event) => event.currentTarget.select()}
			onKeyDown={(event) => {
				if (event.key === "Enter") finish(inputRef.current?.value ?? null);
				if (event.key === "Escape") {
					event.preventDefault();
					finish(null);
				}
			}}
			aria-label="重命名会话"
			className={className}
		/>
	);
}

function SessionItem({
	session,
	active,
	activeStatus,
	onSelect,
	menu,
	editing,
	onEdited,
	onEditEnd,
	variant,
}: Pick<SessionListProps, "onSelect" | "menu" | "onEdited" | "onEditEnd" | "variant" | "activeStatus"> & {
	session: SessionSummary;
	active: boolean;
	editing: boolean;
}) {
	const workspace = variant === "workspace";
	const title = session.title || session.agent_slug;
	const classes = sessionItemClasses(workspace, active);
	const mark = rowMark(active, activeStatus, session.status);
	/** 提交与 Escape 都算退出；next 为 null 表示取消。 */
	const finishEditing = (next: string | null) => {
		if (next !== null) {
			const trimmed = next.trim().slice(0, 120);
			if (trimmed && trimmed !== title) onEdited?.(session.session_id, trimmed);
		}
		onEditEnd?.(session.session_id);
	};
	return (
		<div className={classes.row}>
			{/* 行容器与操作按钮并列，避免嵌套 button 导致真实点击时操作不可达。 */}
			{editing ? (
				<RenameInput title={title} className={classes.edit} onFinish={finishEditing} />
			) : (
				<button
					type="button"
					onClick={() => onSelect(session)}
					aria-current={active ? "true" : undefined}
					className={classes.select}
				>
					{/* 截断收敛到内层 span，Tooltip 的溢出检测才有正确的 scrollWidth/clientWidth。 */}
					<Tooltip className="block truncate" content={title} overflowOnly>
						{title}
					</Tooltip>
				</button>
			)}
			{mark ? (
				<span role="img" aria-label={mark.label} title={mark.label} className="mr-1.5 flex shrink-0 self-center">
					{mark.spinner ? (
						<ProcessSpinner className="size-3.5 text-[var(--kit-accent)]" />
					) : (
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							aria-hidden="true"
							className={`size-3.5 ${mark.className ?? ""}`}
						>
							<path d={mark.path} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					)}
				</span>
			) : session.status === "archived" ? (
				<span className="shrink-0 self-center pr-1 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					已归档
				</span>
			) : null}
			{/* 菜单元素由业务经 menu(session) 构造；编辑态整组卸载，避免与行内输入争夺注意力。 */}
			{!editing && menu ? <div className={classes.actions}>{menu(session)}</div> : null}
		</div>
	);
}

/** 会话列表只负责展示与操作槽；行尾菜单经 menu(session) 由调用方构造，容器、新建入口及操作确认由调用方提供。 */
export function SessionList({
	sessions,
	activeId,
	activeStatus,
	onSelect,
	menu,
	editingId,
	onEdited,
	onEditEnd,
	variant = "default",
	ariaLabel,
	className,
}: SessionListProps) {
	return (
		<nav className={`min-h-0 flex-1 overflow-y-auto px-2 pb-3 ${className ?? ""}`} aria-label={ariaLabel ?? "会话列表"}>
			{sessions.length === 0 ? (
				<p className="p-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">暂无会话</p>
			) : null}
			{sessions.map((session) => (
				<SessionItem
					key={session.session_id}
					session={session}
					active={session.session_id === activeId}
					editing={session.session_id === editingId}
					activeStatus={activeStatus}
					onSelect={onSelect}
					menu={menu}
					onEdited={onEdited}
					onEditEnd={onEditEnd}
					variant={variant}
				/>
			))}
		</nav>
	);
}
