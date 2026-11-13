import type { SessionSummary } from "@openagentpack/kit-sdk/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../menu/index.tsx";
import { filterSessions, SessionList } from "./index.tsx";

const session = (id: string, title?: string): SessionSummary => ({
	session_id: id,
	agent_slug: "writer-agent",
	...(title ? { title } : {}),
	created_at: "2026-10-30T00:00:00Z",
});

/** 测试用行尾菜单：闭包持有行 id，触发按钮 + 单个归档项（SSR 关闭态不出弹层内容）。 */
function RowMenu({ id }: { id: string }) {
	return (
		<Menu>
			<MenuTrigger asChild>
				<button type="button" aria-label="更多操作">
					<span aria-hidden="true">⋯</span>
				</button>
			</MenuTrigger>
			<MenuContent align="end">
				<MenuItem onSelect={() => {}}>归档 {id}</MenuItem>
			</MenuContent>
		</Menu>
	);
}

describe("会话列表", () => {
	it("搜索过滤按展示标题：title 优先，无 title 回退 agent_slug，大小写不敏感", () => {
		const sessions = [session("s1", "季度报告"), session("s2"), session("s3", "Report Draft")];
		expect(filterSessions(sessions, "报告").map((s) => s.session_id)).toEqual(["s1"]);
		expect(filterSessions(sessions, "WRITER").map((s) => s.session_id)).toEqual(["s2"]);
		expect(filterSessions(sessions, "  report  ").map((s) => s.session_id)).toEqual(["s3"]);
		expect(filterSessions(sessions, "  ")).toBe(sessions);
	});

	it("行内状态：每行按索引状态出线形图标（running 旋转环/审批警示三角/失败叉），activeStatus 只覆盖打开行，归档显示小字", () => {
		const row = (status: string) =>
			renderToStaticMarkup(
				<SessionList sessions={[{ ...session("s1"), status }]} activeId={null} onSelect={() => {}} />,
			);
		expect(row("running")).toContain('aria-label="生成中"');
		expect(row("running")).toContain("animate-spin");
		expect(row("requires_action")).toContain('aria-label="等待审批"');
		expect(row("requires_action")).toContain('stroke="currentColor"');
		// 着色用语义 token 本体色（-fg 是深色底文字对比变体，形状标记读不出「黄」）。
		expect(row("requires_action")).toContain("--kit-warning");
		expect(row("requires_action")).not.toContain("rounded-full");
		expect(row("failed")).toContain('aria-label="执行失败"');
		expect(row("failed")).toContain("--kit-danger");
		expect(row("archived")).toContain("已归档");
		// idle 与移除态不出点：不是回合中的瞬时状态。
		const plain = renderToStaticMarkup(
			<SessionList
				sessions={[session("s2"), { ...session("s3"), status: "idle" }, { ...session("s4"), status: "terminated" }]}
				activeId={null}
				onSelect={() => {}}
			/>,
		);
		expect(plain).not.toContain("生成中");
		expect(plain).not.toContain("已归档");
		// 打开行的实时态优先于（重取列表前可能滞后的）索引状态。
		const override = renderToStaticMarkup(
			<SessionList
				sessions={[{ ...session("s5"), status: "failed" }]}
				activeId="s5"
				activeStatus="running"
				onSelect={() => {}}
			/>,
		);
		expect(override).toContain("生成中");
		expect(override).not.toContain("执行失败");
		// 非打开行不吃 activeStatus：同一数据换 activeId 后回退到索引状态。
		const other = renderToStaticMarkup(
			<SessionList
				sessions={[{ ...session("s6"), status: "requires_action" }]}
				activeId="s1"
				activeStatus="running"
				onSelect={() => {}}
			/>,
		);
		expect(other).toContain("等待审批");
		expect(other).not.toContain("生成中");
	});

	it("activeStatus=completed 点亮「已完成」对勾（中性色）并盖住滞留的索引状态；只作用于打开行", () => {
		const done = renderToStaticMarkup(
			<SessionList sessions={[session("s1", "报告")]} activeId="s1" activeStatus="completed" onSelect={() => {}} />,
		);
		expect(done).toContain('aria-label="已完成"');
		expect(done).toContain("M20 6 9 17l-5-5");
		// 完成是中性提示，不引语义色。
		expect(done).not.toContain("--kit-warning");
		expect(done).not.toContain("--kit-danger");
		// 回合刚收敛、列表还没重取的瞬间，滞留 running 的索引状态被完成标记盖住。
		const overStale = renderToStaticMarkup(
			<SessionList
				sessions={[{ ...session("s2"), status: "running" }]}
				activeId="s2"
				activeStatus="completed"
				onSelect={() => {}}
			/>,
		);
		expect(overStale).toContain("已完成");
		expect(overStale).not.toContain("生成中");
		// 完成提示只属于打开行：切走后该行回退索引状态（协议终态无完成语义，不出标记）。
		const other = renderToStaticMarkup(
			<SessionList sessions={[session("s3", "下一轮")]} activeId={null} activeStatus="completed" onSelect={() => {}} />,
		);
		expect(other).not.toContain("已完成");
	});

	it("行尾菜单每行调用 menu(session) 交给业务渲染：触发按钮带 menu 语义、SSR 关闭态不出菜单项；未传 menu 不渲染操作槽", () => {
		const withMenu = renderToStaticMarkup(
			<SessionList
				sessions={[session("s1", "报告")]}
				activeId={null}
				onSelect={() => {}}
				menu={(row) => <RowMenu id={row.session_id} />}
			/>,
		);
		expect(withMenu).toContain('aria-label="更多操作"');
		expect(withMenu).toContain('aria-haspopup="menu"');
		expect(withMenu).not.toContain("归档");
		expect(withMenu).not.toContain('aria-label="重命名会话"');
		const without = renderToStaticMarkup(
			<SessionList sessions={[session("s1", "报告")]} activeId={null} onSelect={() => {}} />,
		);
		expect(without).not.toContain("更多操作");
	});

	// 受控编辑：editingId 命中的行渲染重命名输入框（回填展示标题）并整组卸载菜单槽；
	// 提交校验（去空白、截断 120、空值或未变化只退出）与 Escape 退出在事件回调里，由调用方经
	// onEdited / onEditEnd 收尾。
	it("editingId 让对应行进入编辑态：输入框回填标题、菜单槽卸载，其余行不受影响", () => {
		const editing = renderToStaticMarkup(
			<SessionList
				sessions={[session("s1", "报告")]}
				activeId={null}
				editingId="s1"
				menu={(row) => <RowMenu id={row.session_id} />}
				onSelect={() => {}}
			/>,
		);
		expect(editing).toContain('aria-label="重命名会话"');
		expect(editing).toContain('value="报告"');
		expect(editing).not.toContain("更多操作");
		expect(editing).not.toContain("归档");
		const others = renderToStaticMarkup(
			<SessionList
				sessions={[session("s1", "报告"), session("s2", "草稿")]}
				activeId={null}
				editingId="s1"
				menu={(row) => <RowMenu id={row.session_id} />}
				onSelect={() => {}}
			/>,
		);
		expect(others).toContain("更多操作");
		expect(others).toContain("草稿");
	});

	it("ariaLabel 覆盖 nav 名称：侧栏多列表（分组/最近）用不同标签区分导航语义，缺省仍为会话列表", () => {
		const labeled = renderToStaticMarkup(
			<SessionList sessions={[session("s1")]} activeId={null} onSelect={() => {}} ariaLabel="最近会话" />,
		);
		expect(labeled).toContain('aria-label="最近会话"');
		const fallback = renderToStaticMarkup(
			<SessionList sessions={[session("s1")]} activeId={null} onSelect={() => {}} />,
		);
		expect(fallback).toContain('aria-label="会话列表"');
	});
});
