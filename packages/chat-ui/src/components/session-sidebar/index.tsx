import type { SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SessionList } from "../session-list/index.tsx";
import { ErrorState } from "../states/index.ts";

/** 选中高亮与分组自动展开的归属分区：同一会话会同时出现在「智能体」与「最近」两个分区。 */
export type SessionSidebarSection = "groups" | "recent";

/** 打开行的实时状态标记：中性展示词，协议相位到展示词的映射由调用方完成。 */
export type SessionSidebarActiveStatus = "running" | "attention" | "failed" | "completed";

/** 目录里的一份分页数据：状态由调用方持有，取数动作以回调注入。展示层不感知协议词汇。 */
export interface SessionSidebarPage {
	/** 已加载（并按调用方口径清洗过）的会话摘要。 */
	sessions: SessionSummary[];
	/** 是否已成功取过首页：分组头行据此决定是否显示已加载计数。 */
	initialized?: boolean;
	loading?: boolean;
	loadingMore?: boolean;
	hasMore?: boolean;
	/** 本页错误文案；只渲染与重试，不感知来源。 */
	error?: string | null;
	/** 分组展开时请求首页；目录级或「最近」的首次加载由调用方自理。 */
	onLoad?: () => void;
	onRetry?: () => void;
	onLoadMore?: () => void;
}

export interface SessionSidebarGroup extends SessionSidebarPage {
	/** 分组 id（通常是 agent slug）：testid、折叠状态与新建回调都以它为键。 */
	id: string;
	/** 展示名：头行与搜索过滤使用。 */
	name: string;
}

/** 受控的分区独立编辑态：编辑框只点亮指定分区里的那一行。 */
export interface SessionSidebarEditing {
	id: string;
	section: SessionSidebarSection;
}

export interface SessionSidebarProps {
	/** 智能体分组（各组独立分页状态），顺序即展示顺序。 */
	groups: SessionSidebarGroup[];
	/** 「最近」分区的分页数据。 */
	recent: SessionSidebarPage;
	/** 分组清单本身的加载中/错误：分组区还没内容时展示目录级状态。 */
	loading?: boolean;
	error?: string | null;
	onReload?: () => void;
	/** 当前打开的会话 id。 */
	activeId: string | null;
	/** 高亮归属分区；不传按 groups 归属（深链/外部导航的默认视图）。 */
	activeSection?: SessionSidebarSection;
	/** 打开行的实时状态，只作用于归属分区里的那一行。 */
	activeStatus?: SessionSidebarActiveStatus;
	/** 需要自动展开的分组 id（通常来自路由的 agent slug）；只开不关，手动收起后不再弹开。 */
	activeGroupId?: string | null;
	/** 选中会话：回传该行会话摘要（导航所需的 agent_slug 随点击携带）与来源分区，用于高亮归属。 */
	onSelect: (session: SessionSummary, section: SessionSidebarSection) => void;
	/** 分组行「+」新建回调；不传则不渲染该入口。上架核验与路由由调用方自理。 */
	onNewChat?: (groupId: string) => void;
	/** 行尾操作菜单 render prop：每行渲染时调用，返回的元素闭包持有该行会话与来源分区；
	 * 触发按钮、弹层与菜单项全部由业务渲染，删除等破坏性动作由业务自备确认弹窗。 */
	menu?: (session: SessionSummary, section: SessionSidebarSection) => ReactNode;
	/** 受控行内重命名：设为某分区的会话 id 让该行进入编辑态（通常在菜单「重命名」项里设置）。 */
	editing?: SessionSidebarEditing | null;
	/** 编辑提交（Enter 或失焦）后回调：入参为会话 id 与去空白、截断到 120 字符的新标题；
	 * 清空或与展示标题相同视为取消，只退出不改名。改名请求由调用方发出。 */
	onEdited?: (id: string, title: string) => void;
	/** 编辑态退出（提交或 Escape）时回调；受控模式下由调用方在此清空 editing。 */
	onEditEnd?: (id: string) => void;
	/** 目录动作（新建/重命名等）的就地错误提示；配合 onDismissError 渲染可关闭的错误行。 */
	actionError?: string | null;
	onDismissError?: () => void;
	/** 搜索框受控值：非空时进入搜索视图。 */
	searchInput: string;
	/** 搜索框输入回调。 */
	onSearchInput: (value: string) => void;
	/** 后端会话检索结果页：注入后搜索覆盖全部历史会话（含未加载行），按 agent 分组展示；
	 * 未注入时退化为过滤已加载行。分页状态与取数动作仍归调用方。 */
	search?: SessionSidebarPage;
	/** 检索结果分组头的展示名解析；不传用 slug。 */
	agentName?: (slug: string) => string;
	className?: string;
}

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]";
const HOVER_ROW =
	"transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-nav-active)]";

/** 分组行首的字符徽标：Agent 没有头像资产，取展示名首字符做轻量身份标记。 */
function GroupAvatar({ name }: { name: string }) {
	return (
		<span
			aria-hidden="true"
			className="grid size-5 shrink-0 place-items-center rounded-[var(--kit-radius-xs)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] text-[10px] font-semibold text-[var(--kit-fg-muted)]"
		>
			{name.slice(0, 1)}
		</span>
	);
}

/** 可折叠分区标题（智能体 / 最近）：整行可点收起展开，内容随 grid-rows 过渡（收起时 inert 隔离键盘）。 */
function SectionToggle({
	label,
	open,
	onToggle,
	children,
}: {
	label: ReactNode;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<>
			{/* 标题带 min-h-8 与分组行等高。上下间距不挂在标题上：上方由前一内容收尾、下方由折叠容器
			 * mt-3 负责——用 margin（相邻可塌缩），分区收起时不会与下一分区叠加出双倍空隙。 */}
			<button
				type="button"
				aria-expanded={open}
				onClick={onToggle}
				className={`flex min-h-8 w-full cursor-pointer items-center rounded-[var(--kit-radius-sm)] px-2 py-1 text-left text-[length:var(--kit-text-caption)] font-medium text-[var(--kit-fg-muted)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-nav-active)] hover:text-[var(--kit-fg)] ${FOCUS_RING}`}
			>
				{label}
			</button>
			<div
				className={`mt-3 grid transition-[grid-template-rows] duration-[var(--kit-duration-base)] ease-[var(--kit-ease-out)] motion-reduce:transition-none ${
					open ? "grid-rows-[repeat(1,minmax(0,1fr))]" : "grid-rows-[0px]"
				}`}
			>
				<div inert={!open || undefined} className="min-h-0 overflow-hidden">
					{children}
				</div>
			</div>
		</>
	);
}

/** 分组与最近共享行级交互；`menu` 与 `editingId` 由目录按分区组合——同一会话会同时出现在两个
 * 分区，编辑态必须各分区独立，否则两处编辑框同时挂载互相抢焦点后双双关闭。 */
interface DirectoryListProps {
	activeId: string | null;
	activeStatus?: SessionSidebarActiveStatus;
	onSelect: (session: SessionSummary) => void;
	menu?: (session: SessionSummary) => ReactNode;
	editingId?: string | null;
	onEdited?: (id: string, title: string) => void;
	onEditEnd?: (id: string) => void;
}

/** 监听用户向下滚动或滑动到目录底部；不在首屏或折叠时自动读完所有页。 */
function useLoadOnScroll(
	rootRef: RefObject<HTMLDivElement | null>,
	endRef: RefObject<HTMLDivElement | null>,
	enabled: boolean,
	loadMore: (() => void) | undefined,
) {
	useEffect(() => {
		const root = rootRef.current;
		if (!enabled || !loadMore || !root) return;
		let top = root.scrollTop;
		let touchY: number | null = null;
		const atBottom = () => {
			const end = endRef.current?.getBoundingClientRect();
			const viewport = root.getBoundingClientRect();
			if (end && end.top <= viewport.bottom && end.bottom >= viewport.top) loadMore();
		};
		const scroll = () => {
			if (root.scrollTop > top) atBottom();
			top = root.scrollTop;
		};
		const wheel = (event: WheelEvent) => {
			if (event.deltaY > 0) atBottom();
		};
		const start = (event: TouchEvent) => {
			touchY = event.touches[0]?.clientY ?? null;
		};
		const end = (event: TouchEvent) => {
			const y = event.changedTouches[0]?.clientY;
			if (touchY !== null && y !== undefined && y < touchY) atBottom();
			touchY = null;
		};
		root.addEventListener("scroll", scroll, { passive: true });
		root.addEventListener("wheel", wheel, { passive: true });
		root.addEventListener("touchstart", start, { passive: true });
		root.addEventListener("touchend", end, { passive: true });
		return () => {
			root.removeEventListener("scroll", scroll);
			root.removeEventListener("wheel", wheel);
			root.removeEventListener("touchstart", start);
			root.removeEventListener("touchend", end);
		};
	}, [rootRef, endRef, enabled, loadMore]);
}

function PageStatus({
	page,
	title,
	empty,
	searching,
}: {
	page: SessionSidebarPage;
	title: string;
	empty: boolean;
	searching: boolean;
}) {
	const className = "px-2 py-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]";
	if (page.loading || page.loadingMore)
		return (
			<p role="status" className={className}>
				{page.loadingMore ? "正在加载更多会话…" : `正在加载${title}…`}
			</p>
		);
	if (!page.error && empty) return <p className={className}>{searching ? "已加载会话中无匹配项" : `暂无${title}`}</p>;
	return null;
}

/** 一份分页数据的展示：列表 + 错误重试 + 状态文案 + 滚动/点击加载更多。 */
function DirectoryPageList({
	page,
	title,
	ariaLabel,
	testId,
	sessions,
	enabled,
	searching,
	scrollRoot,
	list,
}: {
	page: SessionSidebarPage;
	title: string;
	ariaLabel: string;
	testId: string;
	sessions: SessionSummary[];
	enabled: boolean;
	searching: boolean;
	scrollRoot: RefObject<HTMLDivElement | null>;
	list: DirectoryListProps;
}) {
	const endRef = useRef<HTMLDivElement | null>(null);
	useLoadOnScroll(
		scrollRoot,
		endRef,
		enabled && !searching && page.hasMore === true && !page.loading && !page.loadingMore && !page.error,
		page.onLoadMore,
	);
	return (
		<div data-testid={testId}>
			{sessions.length > 0 ? (
				<SessionList variant="workspace" ariaLabel={ariaLabel} sessions={sessions} {...list} />
			) : null}
			{page.error ? <ErrorState message={page.error} onRetry={page.onRetry} /> : null}
			<PageStatus page={page} title={title} empty={sessions.length === 0} searching={searching} />
			<div ref={endRef}>
				{!searching && page.hasMore && !page.error ? (
					<button
						type="button"
						data-testid={`${testId}-load-more`}
						disabled={page.loading || page.loadingMore}
						onClick={() => page.onLoadMore?.()}
						className="flex w-full cursor-pointer items-center justify-center rounded-[var(--kit-radius-sm)] px-2 py-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-nav-active)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-wait disabled:opacity-50"
					>
						加载更多会话
					</button>
				) : null}
			</div>
		</div>
	);
}

/** 后端检索结果：覆盖全部历史会话，按 agent 分组可折叠；行只读，游标加载更多与滚动触底并行。 */
function SearchResults({
	search,
	activeId,
	activeStatus,
	agentName,
	onSelect,
	scrollRoot,
}: {
	search: SessionSidebarPage;
	activeId: string | null;
	activeStatus?: SessionSidebarActiveStatus;
	agentName: (slug: string) => string;
	onSelect: (session: SessionSummary) => void;
	scrollRoot: RefObject<HTMLDivElement | null>;
}) {
	const endRef = useRef<HTMLDivElement | null>(null);
	useLoadOnScroll(
		scrollRoot,
		endRef,
		search.hasMore === true && !search.loading && !search.loadingMore && !search.error,
		search.onLoadMore,
	);
	const groups = useMemo(() => {
		const byAgent = new Map<string, SessionSummary[]>();
		for (const session of search.sessions) {
			const rows = byAgent.get(session.agent_slug) ?? [];
			rows.push(session);
			byAgent.set(session.agent_slug, rows);
		}
		return [...byAgent.entries()];
	}, [search.sessions]);
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	return (
		<div data-testid="session-search-results">
			<p className="px-2 pb-1 text-[length:var(--kit-text-caption)] font-medium text-[var(--kit-fg-muted)]">全部会话</p>
			{groups.map(([slug, sessions]) => (
				<SectionToggle
					key={slug}
					open={!collapsed.has(slug)}
					onToggle={() =>
						setCollapsed((previous) => {
							const next = new Set(previous);
							if (next.has(slug)) next.delete(slug);
							else next.add(slug);
							return next;
						})
					}
					label={
						<span className="flex min-w-0 items-center gap-2" data-testid={`search-agent-${slug}`}>
							<GroupAvatar name={agentName(slug)} />
							<span className="min-w-0 flex-1 truncate text-[length:var(--kit-text-label)] font-medium">
								{agentName(slug)}
							</span>
							<span className="shrink-0 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] tabular-nums">
								{sessions.length}
							</span>
						</span>
					}
				>
					<SessionList
						variant="workspace"
						ariaLabel={`搜索结果：${agentName(slug)}`}
						sessions={sessions}
						activeId={activeId}
						activeStatus={activeStatus}
						onSelect={onSelect}
					/>
				</SectionToggle>
			))}
			{search.error ? <ErrorState message={search.error} onRetry={search.onRetry} /> : null}
			{search.loading || search.loadingMore ? (
				<p role="status" className="px-2 py-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
					{search.loadingMore ? "正在加载更多会话…" : "正在加载会话…"}
				</p>
			) : null}
			{!search.error && !search.loading && groups.length === 0 ? (
				<p className="px-2 py-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">没有匹配的会话</p>
			) : null}
			<div ref={endRef}>
				{search.hasMore && !search.error ? (
					<button
						type="button"
						data-testid="session-search-results-load-more"
						disabled={search.loading || search.loadingMore}
						onClick={() => search.onLoadMore?.()}
						className="flex w-full cursor-pointer items-center justify-center rounded-[var(--kit-radius-sm)] px-2 py-2 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-nav-active)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-wait disabled:opacity-50"
					>
						加载更多会话
					</button>
				) : null}
			</div>
		</div>
	);
}

/** 智能体分组：头行折叠展开，身内会话列表随组高度过渡（grid-rows 0px→1fr，收起时 inert 隔离键盘）。 */
function AgentGroup({
	group,
	filter,
	searching,
	scrollRoot,
	open,
	onToggle,
	onNewChat,
	list,
}: {
	group: SessionSidebarGroup;
	filter: (sessions: SessionSummary[]) => SessionSummary[];
	searching: boolean;
	scrollRoot: RefObject<HTMLDivElement | null>;
	open: boolean;
	onToggle: () => void;
	onNewChat?: (groupId: string) => void;
	list: DirectoryListProps;
}) {
	useEffect(() => {
		if (open) group.onLoad?.();
	}, [open, group.onLoad]);
	return (
		<div>
			{/* hover 高亮画在整行容器上：悬停新建的「+」也在同一块底色里，不在高亮外留缝。 */}
			<div className={`group/head flex min-w-0 items-center rounded-[var(--kit-radius-sm)] ${HOVER_ROW}`}>
				<button
					type="button"
					data-testid={`sidebar-group-${group.id}`}
					aria-expanded={open}
					onClick={onToggle}
					className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[var(--kit-radius-sm)] px-2 py-1.5 text-left ${FOCUS_RING}`}
				>
					<GroupAvatar name={group.name} />
					<span className="min-w-0 flex-1 truncate text-[length:var(--kit-text-label)] font-medium">{group.name}</span>
					{group.initialized ? (
						<span
							title={`已加载 ${group.sessions.length} 条会话`}
							className="shrink-0 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)] tabular-nums"
						>
							{group.sessions.length}
							{group.hasMore ? "+" : ""}
						</span>
					) : null}
				</button>
				{onNewChat ? (
					<button
						type="button"
						data-testid={`sidebar-group-new-${group.id}`}
						aria-label={`在${group.name}中新建会话`}
						title={`在${group.name}中新建会话`}
						onClick={() => onNewChat(group.id)}
						className={`mr-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[var(--kit-radius-xs)] text-[var(--kit-fg-muted)] transition-[opacity,color] duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:text-[var(--kit-fg)] ${FOCUS_RING} [@media(hover:hover)_and_(pointer:fine)_and_(not_(any-pointer:coarse))]:opacity-0 group-hover/head:opacity-100 group-focus-within/head:opacity-100`}
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							className="size-3.5"
						>
							<path d="M12 5v14M5 12h14" strokeLinecap="round" />
						</svg>
					</button>
				) : null}
			</div>
			<div
				className={`mt-1 grid transition-[grid-template-rows] duration-[var(--kit-duration-base)] ease-[var(--kit-ease-out)] motion-reduce:transition-none ${
					open ? "grid-rows-[repeat(1,minmax(0,1fr))]" : "grid-rows-[0px]"
				}`}
			>
				<div inert={!open || undefined} className="ml-5 min-h-0 overflow-hidden">
					<DirectoryPageList
						page={group}
						title="会话"
						ariaLabel={`会话列表：${group.name}`}
						testId={`group-sessions-${group.id}`}
						sessions={filter(group.sessions)}
						enabled={open}
						searching={searching}
						scrollRoot={scrollRoot}
						list={list}
					/>
				</div>
			</div>
		</div>
	);
}

/** 目录空/无匹配占位：加载中、首用引导与搜索无结果三种文案。 */
function DirectoryEmptyState({
	loading,
	sessionsEmpty,
	noMatch,
}: {
	loading: boolean;
	sessionsEmpty: boolean;
	noMatch: boolean;
}) {
	if (sessionsEmpty)
		return loading ? (
			<p role="status" className="px-2 py-4 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				正在加载会话…
			</p>
		) : (
			<div className="px-2 py-4 text-[length:var(--kit-text-caption)] leading-relaxed text-[var(--kit-fg-muted)]">
				<p>还没有会话记录</p>
				<p className="mt-1">发送第一条消息后，会话会显示在这里。</p>
			</div>
		);
	if (noMatch)
		return <p className="px-2 py-4 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">无匹配会话</p>;
	return null;
}

/** 智能体分组区：分区标题与组头都可折叠展开；activeGroupId 命中的组自动展开（只开不关：
 * 手动收起后不因状态变化再弹开——分区标题同理，只手动控制）。 */
function GroupsSection({
	groups,
	activeGroupId,
	filter,
	searching,
	scrollRoot,
	onNewChat,
	list,
}: {
	groups: SessionSidebarGroup[];
	activeGroupId: string | null;
	filter: (sessions: SessionSummary[]) => SessionSummary[];
	searching: boolean;
	scrollRoot: RefObject<HTMLDivElement | null>;
	onNewChat?: (groupId: string) => void;
	list: DirectoryListProps;
}) {
	const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
	const [open, setOpen] = useState(true);
	useEffect(() => {
		if (!activeGroupId) return;
		setOpenGroups((prev) => (prev.has(activeGroupId) ? prev : new Set(prev).add(activeGroupId)));
	}, [activeGroupId]);
	return (
		<SectionToggle label="智能体" open={open} onToggle={() => setOpen((value) => !value)}>
			{groups.map((group) => (
				<AgentGroup
					key={group.id}
					group={group}
					filter={filter}
					searching={searching}
					scrollRoot={scrollRoot}
					open={open && openGroups.has(group.id)}
					onToggle={() =>
						setOpenGroups((prev) => {
							const next = new Set(prev);
							if (next.has(group.id)) next.delete(group.id);
							else next.add(group.id);
							return next;
						})
					}
					onNewChat={onNewChat}
					list={list}
				/>
			))}
		</SectionToggle>
	);
}

/** 目录正文（未命中检索视图时）：目录级错误、空态占位与「智能体分组 + 最近」两分区；
 * 未注入后端检索页时，输入按标题、agent slug 与分组名不区分大小写过滤已加载行。 */
function DirectoryBody({
	groups,
	recent,
	loading,
	error,
	onReload,
	activeGroupId,
	keyword,
	filtering,
	scrollRoot,
	onNewChat,
	list,
	recentList,
	recentOpen,
	onRecentToggle,
}: {
	groups: SessionSidebarGroup[];
	recent: SessionSidebarPage;
	loading: boolean;
	error?: string | null;
	onReload?: () => void;
	activeGroupId: string | null;
	keyword: string;
	filtering: boolean;
	scrollRoot: RefObject<HTMLDivElement | null>;
	onNewChat?: (groupId: string) => void;
	list: DirectoryListProps;
	recentList: DirectoryListProps;
	recentOpen: boolean;
	onRecentToggle: () => void;
}) {
	const filter = useCallback(
		(rows: SessionSummary[]) => {
			const q = keyword.trim().toLowerCase();
			if (!q) return rows;
			return rows.filter(
				(session) => (session.title ?? "").toLowerCase().includes(q) || session.agent_slug.toLowerCase().includes(q),
			);
		},
		[keyword],
	);
	const filteredRecent = useMemo(() => filter(recent.sessions), [filter, recent.sessions]);
	const visibleGroups = useMemo(() => {
		const q = keyword.trim().toLowerCase();
		if (!q) return groups;
		return groups.filter(
			(group) =>
				group.id.toLowerCase().includes(q) || group.name.toLowerCase().includes(q) || filter(group.sessions).length > 0,
		);
	}, [groups, keyword, filter]);
	const isEmpty = groups.length === 0;
	const noMatch = visibleGroups.length === 0;
	return (
		<>
			{error ? <ErrorState message={error} onRetry={onReload} /> : null}
			{isEmpty || noMatch ? (
				error && isEmpty ? null : (
					<DirectoryEmptyState loading={loading} sessionsEmpty={isEmpty} noMatch={noMatch} />
				)
			) : (
				<GroupsSection
					groups={visibleGroups}
					activeGroupId={activeGroupId}
					filter={filter}
					searching={filtering}
					scrollRoot={scrollRoot}
					onNewChat={onNewChat}
					list={list}
				/>
			)}
			<SectionToggle label="最近" open={recentOpen} onToggle={onRecentToggle}>
				<DirectoryPageList
					page={recent}
					title="最近会话"
					ariaLabel="最近会话"
					testId="recent-sessions"
					sessions={filteredRecent}
					enabled={recentOpen}
					searching={filtering}
					scrollRoot={scrollRoot}
					list={recentList}
				/>
			</SectionToggle>
		</>
	);
}

/** 会话目录区：搜索（注入 search 检索页时覆盖全部历史会话，否则过滤已加载行）+ 智能体分组
 * （展开懒加载、逐组分页）+ 最近 + 目录动作错误行。
 * 只渲染目录本身——侧栏 rail（品牌、新建、导航、账号）由调用方组装，根节点不是 aside。
 * 分页状态归调用方持有，取数经回调注入；选中/新建/行内菜单把业务动作收口到调用方。 */
export function SessionSidebar({
	groups,
	recent,
	loading = false,
	error,
	onReload,
	activeId,
	activeSection,
	activeStatus,
	activeGroupId,
	onSelect,
	onNewChat,
	menu,
	editing,
	onEdited,
	onEditEnd,
	actionError,
	onDismissError,
	searchInput,
	onSearchInput,
	search,
	agentName,
	className,
}: SessionSidebarProps) {
	const scrollRoot = useRef<HTMLDivElement | null>(null);
	const [recentOpen, setRecentOpen] = useState(true);
	const keyword = searchInput;
	const searching = keyword.trim().length > 0;
	const filtering = searching && !search;
	// 「智能体」分组与「最近」是同一批会话的两个视图，选中高亮与分组自动展开只跟随点击来源分区，
	// 不跨区串台；深链/刷新等外部导航默认落在分组视图。
	const selection = activeSection ?? "groups";
	const scopedMenu = useCallback(
		(section: SessionSidebarSection) => (menu ? (session: SessionSummary) => menu(session, section) : undefined),
		[menu],
	);
	const list: DirectoryListProps = {
		activeId: selection === "groups" ? activeId : null,
		activeStatus,
		onSelect: (session) => onSelect(session, "groups"),
		menu: scopedMenu("groups"),
		editingId: editing?.section === "groups" ? editing.id : null,
		onEdited,
		onEditEnd,
	};
	const recentList: DirectoryListProps = {
		activeId: selection === "recent" ? activeId : null,
		activeStatus,
		onSelect: (session) => onSelect(session, "recent"),
		menu: scopedMenu("recent"),
		editingId: editing?.section === "recent" ? editing.id : null,
		onEdited,
		onEditEnd,
	};

	return (
		<div className={`flex min-h-0 flex-1 flex-col ${className ?? ""}`}>
			{/* pb-3 是「搜索 → 智能体」的 12px 分区间距：分区间距统一由前一内容的收尾负责。 */}
			<div className="shrink-0 px-3 pt-1.5 pb-3">
				<div className="flex items-center gap-2 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] px-2.5 py-1.5 transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none focus-within:border-[var(--kit-border)]">
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						className="size-3.5 shrink-0 text-[var(--kit-fg-muted)]"
					>
						<circle cx="10.5" cy="10.5" r="6.5" />
						<path strokeLinecap="round" d="m16 16 4 4" />
					</svg>
					<input
						type="search"
						data-testid="sidebar-search"
						value={keyword}
						onChange={(event) => onSearchInput(event.target.value)}
						placeholder="搜索会话"
						aria-label="搜索会话"
						className="min-w-0 flex-1 border-none bg-transparent text-[length:var(--kit-text-label)] outline-none placeholder:text-[var(--kit-fg-muted)]"
					/>
				</div>
			</div>
			<div ref={scrollRoot} data-testid="session-directory-scroll" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
				{searching && search ? (
					<SearchResults
						search={search}
						activeId={activeId}
						activeStatus={activeStatus}
						agentName={agentName ?? ((slug: string) => slug)}
						onSelect={(session) => onSelect(session, "groups")}
						scrollRoot={scrollRoot}
					/>
				) : (
					<DirectoryBody
						groups={groups}
						recent={recent}
						loading={loading}
						error={error}
						onReload={onReload}
						activeGroupId={activeGroupId ?? null}
						keyword={keyword}
						filtering={filtering}
						scrollRoot={scrollRoot}
						onNewChat={onNewChat}
						list={list}
						recentList={recentList}
						recentOpen={recentOpen}
						onRecentToggle={() => setRecentOpen((value) => !value)}
					/>
				)}
			</div>
			{actionError ? (
				<div
					role="alert"
					className="flex shrink-0 items-start gap-2 border-t border-[var(--kit-border-subtle)] px-3 py-2 text-[length:var(--kit-text-caption)] leading-relaxed [overflow-wrap:anywhere]"
				>
					<p className="min-w-0 flex-1 text-[var(--kit-danger)]">{actionError}</p>
					<button
						type="button"
						aria-label="关闭错误提示"
						onClick={onDismissError}
						className={`grid size-5 shrink-0 place-items-center rounded-[var(--kit-radius-xs)] text-[var(--kit-fg-muted)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-nav-active)] hover:text-[var(--kit-fg)] ${FOCUS_RING}`}
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							className="size-3"
						>
							<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
						</svg>
					</button>
				</div>
			) : null}
		</div>
	);
}
