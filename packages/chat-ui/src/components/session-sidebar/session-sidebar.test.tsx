import type { SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionSidebar } from "./index.tsx";

const session = (id: string, title?: string, status?: string): SessionSummary => ({
	session_id: id,
	agent_slug: "writer-agent",
	...(title ? { title } : {}),
	...(status ? { status } : {}),
	created_at: "2026-10-30T00:00:00Z",
});

const group = (
	overrides: Partial<{
		id: string;
		name: string;
		sessions: SessionSummary[];
		initialized: boolean;
		loading: boolean;
		loadingMore: boolean;
		hasMore: boolean;
		error: string | null;
		onLoad: () => void;
		onRetry: () => void;
		onLoadMore: () => void;
	}> = {},
) => ({
	id: "writer-agent",
	name: "写手智能体",
	sessions: [session("s1", "季度报告")],
	initialized: true,
	loading: false,
	loadingMore: false,
	hasMore: false,
	error: null,
	onLoad: () => {},
	onRetry: () => {},
	onLoadMore: () => {},
	...overrides,
});

const recent = (
	overrides: Partial<{
		sessions: SessionSummary[];
		loading: boolean;
		loadingMore: boolean;
		hasMore: boolean;
		error: string | null;
		onRetry: () => void;
		onLoadMore: () => void;
	}> = {},
) => ({
	sessions: [session("s1", "季度报告")],
	loading: false,
	loadingMore: false,
	hasMore: false,
	error: null,
	onRetry: () => {},
	onLoadMore: () => {},
	...overrides,
});

const render = (props: Partial<Parameters<typeof SessionSidebar>[0]> = {}) =>
	renderToStaticMarkup(
		<SessionSidebar
			groups={[group()]}
			recent={recent()}
			activeId={null}
			onSelect={() => {}}
			searchInput=""
			onSearchInput={() => {}}
			{...props}
		/>,
	);

const searchPage = (
	overrides: Partial<{
		sessions: SessionSummary[];
		loading: boolean;
		loadingMore: boolean;
		hasMore: boolean;
		error: string | null;
		onRetry: () => void;
		onLoadMore: () => void;
	}> = {},
) => ({
	sessions: [session("s1", "季度报告"), session("s2", "周报草稿")],
	loading: false,
	loadingMore: false,
	hasMore: false,
	error: null,
	onRetry: () => {},
	onLoadMore: () => {},
	...overrides,
});

describe("会话目录区（SSR 结构）", () => {
	it("分组头行带名称与已加载计数；未初始化的组不显示计数", () => {
		const html = render();
		expect(html).toContain('data-testid="sidebar-group-writer-agent"');
		expect(html).toContain("写手智能体");
		expect(html).toContain("已加载 1 条会话");
		const pending = render({ groups: [group({ initialized: false })] });
		expect(pending).not.toContain("已加载 1 条会话");
	});

	it("搜索框常驻并带测试锚点", () => {
		expect(render()).toContain('data-testid="sidebar-search"');
		expect(render()).toContain('aria-label="搜索会话"');
	});

	it("空目录：加载中提示与首用引导", () => {
		expect(render({ groups: [], recent: { sessions: [] }, loading: true })).toContain("正在加载会话…");
		expect(render({ groups: [], recent: { sessions: [] } })).toContain("还没有会话记录");
	});

	it("目录级错误渲染错误卡与重试", () => {
		const html = render({
			groups: [],
			recent: { sessions: [] },
			error: "历史会话加载失败，请重试。",
			onReload: () => {},
		});
		expect(html).toContain("出错了");
		expect(html).toContain("重试");
	});

	it("运行标记只落在归属分区（默认 groups，activeSection=recent 时归最近）", () => {
		expect(render({ activeId: "s1", activeStatus: "running" }).split('aria-label="生成中"').length - 1).toBe(1);
		expect(
			render({ activeId: "s1", activeSection: "recent", activeStatus: "running" }).split('aria-label="生成中"').length -
				1,
		).toBe(1);
	});

	it("受控编辑只点亮归属分区的行内输入框", () => {
		expect(render({ editing: { id: "s1", section: "groups" } }).split('aria-label="重命名会话"').length - 1).toBe(1);
		expect(render({ editing: { id: "s1", section: "recent" } }).split('aria-label="重命名会话"').length - 1).toBe(1);
	});

	it("menu render prop 收到行所在分区", () => {
		const html = render({
			menu: (item, section) => (
				<button type="button" aria-label={`${section}-${item.session_id}`}>
					操作
				</button>
			),
		});
		expect(html).toContain('aria-label="groups-s1"');
		expect(html).toContain('aria-label="recent-s1"');
	});

	it("有更多页时渲染加载更多按钮", () => {
		expect(render({ recent: recent({ hasMore: true }) })).toContain('data-testid="recent-sessions-load-more"');
		expect(render()).not.toContain("recent-sessions-load-more");
	});

	it("动作错误行只在 actionError 时渲染", () => {
		const on = render({ actionError: "该智能体已下架，暂时无法新建会话。" });
		expect(on).toContain("该智能体已下架");
		expect(on).toContain('aria-label="关闭错误提示"');
		expect(render()).not.toContain("关闭错误提示");
	});

	it("onNewChat 提供时才渲染分组新建入口", () => {
		expect(render({ onNewChat: () => {} })).toContain('data-testid="sidebar-group-new-writer-agent"');
		expect(render()).not.toContain("sidebar-group-new-writer-agent");
	});

	it("注入 search 检索页后，输入非空以检索结果替换目录正文", () => {
		const html = render({
			searchInput: "报告",
			search: searchPage(),
			agentName: (slug) => (slug === "writer-agent" ? "写手智能体" : slug),
		});
		expect(html).toContain('data-testid="session-search-results"');
		expect(html).toContain('data-testid="search-agent-writer-agent"');
		expect(html).toContain("季度报告");
		expect(html).not.toContain('data-testid="recent-sessions"');
		expect(html).not.toContain("无匹配会话");
	});

	it("检索结果加载更多与状态文案", () => {
		expect(render({ searchInput: "报告", search: searchPage({ hasMore: true }) })).toContain(
			'data-testid="session-search-results-load-more"',
		);
		expect(render({ searchInput: "报告", search: searchPage({ loading: true }) })).toContain("正在加载会话…");
		expect(render({ searchInput: "报告", search: searchPage({ sessions: [] }) })).toContain("没有匹配的会话");
		expect(render({ searchInput: "报告", search: searchPage({ error: "搜索会话失败，请重试。" }) })).toContain("重试");
	});

	it("未注入 search 时输入只过滤已加载行，不出检索容器", () => {
		const html = render({ searchInput: "季度" });
		expect(html).not.toContain("session-search-results");
		expect(html).toContain("季度报告");
		const none = render({ searchInput: "不存在" });
		expect(none).not.toContain("session-search-results");
		expect(none).toContain("无匹配会话");
	});

	it("受控搜索值渲染进输入框", () => {
		expect(render({ searchInput: "跨页" })).toContain('value="跨页"');
	});
});
