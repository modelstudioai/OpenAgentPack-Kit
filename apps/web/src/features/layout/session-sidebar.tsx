import {
	Menu,
	MenuContent,
	MenuItem,
	MenuTrigger,
	SessionSidebar as SessionDirectory,
	type SessionSidebarGroup,
	type SessionSidebarPage,
} from "@openagentpack/kit-chat-ui";
import type { AgentSummary, SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { useSessionSearch } from "@openagentpack/kit-sdk/sessions/hooks";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Branding } from "../../lib/branding.ts";
import type { NavigateFn, ViewId } from "../../lib/use-route.ts";
import type {
	SessionDirectory as SessionDirectoryData,
	SessionDirectorySection,
} from "../../lib/use-session-directory.ts";
import { MemberAccount, type MemberAccountProps } from "../auth/member-auth-gate.tsx";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]";
const HOVER_ROW =
	"transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-nav-active)]";
/** SessionList 操作槽内的触发按钮：槽已带悬停显隐与占位，按钮只补满槽位；
 * outline-none 压掉 button 的 UA outline——聚焦后常驻的描边比焦点提示更抢眼，
 * 键盘提示交给行的 focus-within 显隐。 */
const ROW_TRIGGER_CLASS =
	"grid size-full cursor-pointer place-items-center rounded-[var(--kit-radius-sm)] outline-none";
const ELLIPSIS_ICON = (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
		<circle cx="5" cy="12" r="1.5" />
		<circle cx="12" cy="12" r="1.5" />
		<circle cx="19" cy="12" r="1.5" />
	</svg>
);

function brandLogoSrc(value: string): string {
	try {
		return new URL(value, window.location.href).toString();
	} catch {
		return value;
	}
}

/** 品牌 Logo：配置为 Web 路径或在线 URL 时直接加载，加载失败回退为首字母标记。 */
function BrandLogo({ logoUrl, productName }: { logoUrl?: string; productName: string }) {
	const [failed, setFailed] = useState(false);
	if (logoUrl && !failed) {
		return (
			<img
				data-testid="brand-logo"
				src={brandLogoSrc(logoUrl)}
				alt=""
				aria-hidden="true"
				className="size-8 shrink-0 rounded-[var(--kit-radius-sm)] object-contain"
				onError={() => setFailed(true)}
			/>
		);
	}
	const mark = productName.trim().charAt(0).toUpperCase() || "K";
	return (
		<div
			data-testid="brand-logo-fallback"
			aria-hidden="true"
			className="grid size-8 shrink-0 place-items-center rounded-[var(--kit-radius-sm)] bg-[var(--kit-fg)] text-[length:var(--kit-text-label)] font-semibold text-[var(--kit-bg)]"
		>
			{mark}
		</div>
	);
}

/** 行尾「更多操作」菜单：重命名进 kit 的分区受控编辑，归档/删除走目录确认弹窗。 */
function SessionRowMenu({ onClick }: { onClick: (action: "rename" | "archive" | "delete") => void }) {
	return (
		<Menu>
			<MenuTrigger asChild>
				<button type="button" aria-label="更多操作" title="更多操作" className={ROW_TRIGGER_CLASS}>
					{ELLIPSIS_ICON}
				</button>
			</MenuTrigger>
			<MenuContent align="end">
				<MenuItem onSelect={() => onClick("rename")}>重命名</MenuItem>
				<MenuItem onSelect={() => onClick("archive")}>归档</MenuItem>
				<MenuItem className="text-[var(--kit-danger)]" onSelect={() => onClick("delete")}>
					删除
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}

/** 侧栏打开行的实时状态：中性展示词（kit prop 同形），协议相位在 app 层映射后传入。 */
export type SidebarActiveStatus = "running" | "attention" | "failed" | "completed";

export type SessionSidebarProps = MemberAccountProps & {
	branding: Branding;
	view: ViewId;
	agents: AgentSummary[];
	directory: SessionDirectoryData;
	agentSlug: string | null;
	sessionId: string | null;
	activeStatus?: SidebarActiveStatus;
	/** 会话流报错的会话 id：其索引状态不可信，进目录前把该行状态清洗为空（archived 小字保留）。 */
	staleStatusId?: string | null;
	navigate: NavigateFn;
	closeSidebar: () => void;
	closeButton: ReactNode;
};

/** 目录数据与动作的业务粘合：分组换算成 kit 形状（含异常状态清洗），新建核验上架、选中记录
 * 点击来源后跳路由、重命名请求后刷新目录、归档/删除走目录确认弹窗，失败就地提示。 */
function useDirectoryProps({
	view,
	directory,
	agents,
	agentSlug,
	sessionId,
	staleStatusId,
	go,
}: {
	view: ViewId;
	directory: SessionDirectoryData;
	agents: AgentSummary[];
	agentSlug: string | null;
	sessionId: string | null;
	staleStatusId?: string | null;
	go: (target: Parameters<NavigateFn>[0]) => void;
}) {
	const [actionError, setActionError] = useState<string | null>(null);
	// 编辑态按列表来源（分组/最近）收窄后交给 kit 做分区隔离：同一会话同时渲染在两个分区，
	// 全局 editingId 会让两处编辑框同时挂载，挂载聚焦互相抢焦点后双双关闭。
	const [editing, setEditing] = useState<{ id: string; section: SessionDirectorySection } | null>(null);
	// 页面、智能体或会话切换后，迟到的上架检查不能把用户带回旧目标。
	const checkScope = useMemo(() => ({ view, agentSlug, sessionId, generation: 0 }), [view, agentSlug, sessionId]);
	useEffect(
		() => () => {
			checkScope.generation += 1;
		},
		[checkScope],
	);
	const onNewChat = useCallback(
		async (slug: string) => {
			const generation = ++checkScope.generation;
			setActionError(null);
			try {
				const listed = await directory.checkAgent(slug);
				if (generation !== checkScope.generation) return;
				if (!listed) {
					setActionError("该智能体已下架，暂时无法新建会话。");
					return;
				}
				if (!agents.some((agent) => agent.slug === slug)) {
					setActionError("智能体信息已更新，请刷新页面后重试。");
					return;
				}
				go({ view: "chat", agent: slug, session: null });
			} catch {
				if (generation === checkScope.generation) setActionError("无法确认智能体上架状态，请稍后重试。");
			}
		},
		[agents, directory.checkAgent, go, checkScope],
	);
	const onEdited = useCallback(
		(id: string, title: string) => {
			setActionError(null);
			directory
				.rename(id, title)
				.catch((error: unknown) =>
					setActionError(`重命名会话失败：${error instanceof Error ? error.message : String(error)}`),
				);
		},
		[directory.rename],
	);
	const dismissError = useCallback(() => setActionError(null), []);
	const requestSessionAction = useCallback(
		(id: string, action: "archive" | "delete") => directory.actions.request(id, action),
		[directory.actions],
	);
	const agentName = useCallback(
		(slug: string) => agents.find((agent) => agent.slug === slug)?.display_name ?? slug,
		[agents],
	);
	// 会话流硬错误的会话（staleStatusId）索引状态不可信（如远端已不存在但索引滞留 running）：目录是
	// 纯展示组件，数据进目录前清洗为无标记状态；archived 的「已归档」小字属目录事实，保留。
	const distrust = useCallback(
		(rows: SessionSummary[]) =>
			staleStatusId == null
				? rows
				: rows.map((session) =>
						session.session_id === staleStatusId
							? { ...session, status: session.status === "archived" ? session.status : undefined }
							: session,
					),
		[staleStatusId],
	);
	const groups = useMemo<SessionSidebarGroup[]>(
		() =>
			directory.groups.map((group) => ({
				id: group.slug,
				name: agentName(group.slug),
				sessions: distrust(group.sessions),
				initialized: group.initialized,
				loading: group.loading,
				loadingMore: group.loadingMore,
				hasMore: group.hasMore,
				error: group.error,
				onLoad: group.load,
				onRetry: group.retry,
				onLoadMore: group.loadMore,
			})),
		[directory.groups, agentName, distrust],
	);
	const recent = useMemo<SessionSidebarPage>(
		() => ({
			sessions: distrust(directory.recent.sessions),
			initialized: directory.recent.initialized,
			loading: directory.recent.loading,
			loadingMore: directory.recent.loadingMore,
			hasMore: directory.recent.hasMore,
			error: directory.recent.error,
			onRetry: directory.recent.retry,
			onLoadMore: directory.recent.loadMore,
		}),
		[directory.recent, distrust],
	);
	const onSelect = useCallback(
		(session: SessionSummary, section: SessionDirectorySection) => {
			checkScope.generation += 1;
			directory.selectFrom(session.session_id, section);
			go({ view: "chat", agent: session.agent_slug, session: session.session_id });
		},
		[checkScope, directory, go],
	);
	const onEditEnd = useCallback((id: string) => setEditing((current) => (current?.id === id ? null : current)), []);
	// render prop：每行渲染时构造菜单元素，session 与来源分区都在这一处闭包里；
	// 「重命名」只点亮来源分区的编辑框，归档/删除走目录确认弹窗。
	const menu = useCallback(
		(session: SessionSummary, section: SessionDirectorySection) => (
			<SessionRowMenu
				onClick={(action) => {
					if (action === "rename") setEditing({ id: session.session_id, section });
					else requestSessionAction(session.session_id, action);
				}}
			/>
		),
		[requestSessionAction],
	);
	// 「智能体」分组与「最近」是同一批会话的两个视图，选中高亮与分组自动展开只跟随点击来源分区，
	// 不跨区串台；深链/刷新等外部导航默认落在分组视图，此时按路由的 agent 自动展开所在组。
	const activeSection = directory.selectedFrom?.sessionId === sessionId ? directory.selectedFrom.section : "groups";
	const activeGroupId = sessionId && activeSection === "groups" ? agentSlug : null;
	return {
		groups,
		recent,
		activeSection,
		activeGroupId,
		agentName,
		distrust,
		menu,
		editing,
		onSelect,
		onEdited,
		onEditEnd,
		onNewChat,
		actionError,
		dismissError,
	};
}

/** 全局侧栏外壳：品牌 → 新聊天 → 广场 → 会话目录（kit 组件，搜索/分组/最近/错误行）→ 页脚
 * （账号与用量）。rail 框架与导航归 app；目录展示、分页与行内编辑由 kit 承担，业务动作在此收口。 */
export function SessionSidebar({
	branding,
	view,
	agents,
	directory,
	agentSlug,
	sessionId,
	activeStatus,
	staleStatusId,
	navigate,
	closeSidebar,
	closeButton,
	member,
	onLogout,
}: SessionSidebarProps) {
	const productName = branding.productName.trim() || "OpenAgentPack Kit";
	const plazaActive = view === "plaza" || view === "new";
	const go = useCallback(
		(target: Parameters<NavigateFn>[0]) => {
			navigate(target);
			closeSidebar();
		},
		[navigate, closeSidebar],
	);
	const {
		groups,
		recent,
		activeSection,
		activeGroupId,
		agentName,
		distrust,
		menu,
		editing,
		onSelect,
		onEdited,
		onEditEnd,
		onNewChat,
		actionError,
		dismissError,
	} = useDirectoryProps({ view, directory, agents, agentSlug, sessionId, staleStatusId, go });
	// 后端检索状态在 app 层持有（kit 元素不 fetch）：防抖、游标分页与取消都归 useSessionSearch，
	// 注入前把防抖 pending 折叠进 loading，期间不展示上一轮结果；行状态沿用目录口径清洗。
	const [keyword, setKeyword] = useState("");
	const search = useSessionSearch(keyword);
	const searching = keyword.trim().length > 0;
	const searchPage = useMemo<SessionSidebarPage | undefined>(() => {
		if (!searching) return undefined;
		const pending = search.pending;
		return {
			sessions: distrust(pending ? [] : search.sessions),
			loading: pending || search.loading,
			loadingMore: pending ? false : search.loadingMore,
			hasMore: pending ? false : search.hasMore,
			error: search.error,
			onRetry: search.retry,
			onLoadMore: search.loadMore,
		};
	}, [searching, search, distrust]);
	useEffect(
		() => directory.watchStatuses(sessionId, activeStatus !== undefined),
		[directory.watchStatuses, sessionId, activeStatus],
	);
	return (
		<aside
			data-testid="experience-sidebar"
			className="flex min-h-0 w-full shrink-0 flex-col border-r border-[var(--kit-border-subtle)] bg-[var(--kit-bg-subtle)] md:w-72"
		>
			<div className="flex min-h-14 shrink-0 items-center gap-3 px-5 py-3">
				<BrandLogo key={branding.logoUrl ?? "fallback"} logoUrl={branding.logoUrl} productName={productName} />
				<span
					data-testid="brand-name"
					title={productName}
					className="min-w-0 flex-1 truncate text-[length:var(--kit-text-base)] leading-tight font-semibold"
				>
					{productName}
				</span>
				{closeButton}
			</div>
			<div className="shrink-0 px-3 pb-1">
				<button
					type="button"
					data-testid="sidebar-new-chat"
					onClick={() => go({ view: "new" })}
					className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--kit-radius)] bg-[var(--kit-accent)] px-3 py-2 text-left text-[length:var(--kit-text-label)] font-medium text-[var(--kit-accent-fg)] transition-[opacity,transform] duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:opacity-90 active:scale-[0.985] ${FOCUS_RING}`}
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="size-3.5"
					>
						<path d="M12 5v14M5 12h14" strokeLinecap="round" />
					</svg>
					新聊天
				</button>
			</div>
			<nav aria-label="页面导航" className="shrink-0 px-3 pt-1 pb-1">
				<button
					type="button"
					data-testid="sidebar-nav-plaza"
					aria-current={plazaActive ? "page" : undefined}
					onClick={() => go({ view: "plaza" })}
					className={`flex w-full items-center gap-2 rounded-[var(--kit-radius-sm)] px-2.5 py-1.5 text-left text-[length:var(--kit-text-label)] ${HOVER_ROW} ${FOCUS_RING} ${
						plazaActive ? "bg-[var(--kit-nav-active)] font-medium" : ""
					}`}
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						className={`size-4 ${plazaActive ? "text-[var(--kit-fg)]" : "text-[var(--kit-fg-muted)]"}`}
					>
						<rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
						<rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
						<rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
						<rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
					</svg>
					广场
				</button>
			</nav>
			<SessionDirectory
				groups={groups}
				recent={recent}
				loading={directory.loading}
				error={directory.error}
				onReload={directory.reload}
				activeId={sessionId}
				activeSection={activeSection}
				activeStatus={activeStatus}
				activeGroupId={activeGroupId}
				onSelect={onSelect}
				onNewChat={(slug) => void onNewChat(slug)}
				menu={menu}
				editing={editing}
				onEdited={onEdited}
				onEditEnd={onEditEnd}
				actionError={actionError}
				onDismissError={dismissError}
				searchInput={keyword}
				onSearchInput={setKeyword}
				search={searchPage}
				agentName={agentName}
			/>
			<div className="flex shrink-0 items-center gap-1 border-t border-[var(--kit-border-subtle)] px-3 py-2">
				<MemberAccount member={member} onLogout={onLogout} />
				<span className="min-w-0 flex-1" />
				<button
					type="button"
					data-testid="sidebar-usage"
					aria-label="我的用量"
					title="我的用量"
					aria-pressed={view === "usage"}
					onClick={() => go({ view: "usage" })}
					className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--kit-radius-sm)] px-2.5 py-1.5 text-[length:var(--kit-text-label)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-nav-active)] hover:text-[var(--kit-fg)] ${FOCUS_RING} ${
						view === "usage" ? "bg-[var(--kit-nav-active)] text-[var(--kit-fg)]" : "text-[var(--kit-fg-muted)]"
					}`}
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="size-4"
					>
						<path d="M3 12h4l3-8 4 16 3-8h4" />
					</svg>
					我的用量
				</button>
			</div>
		</aside>
	);
}
