import { Layout, type LayoutAsideControls } from "@openagentpack/kit-chat-ui";
import type { AgentSummary } from "@openagentpack/kit-sdk/protocol";
import type { ReactNode } from "react";
import type { Branding } from "../../lib/branding.ts";
import type { NavigateFn, ViewId } from "../../lib/use-route.ts";
import type { SessionDirectory } from "../../lib/use-session-directory.ts";
import type { MemberAccountProps } from "../auth/member-auth-gate.tsx";
import { SessionSidebar } from "./session-sidebar.tsx";

/** 体验页统一外壳：全局侧栏常驻所有视图（品牌/新聊天/广场/会话目录/账号），
 * 页头只属于聊天视图；目录请求与导航由 Shell 持有后注入，布局不负责数据。 */
export function ExperienceLayout({
	branding,
	view,
	navigate,
	directory,
	agents,
	agentSlug,
	sessionId,
	activeStatus,
	staleStatusId,
	header,
	dialogs,
	aside,
	asideOpen,
	asideLabel,
	onAsideOpenChange,
	children,
	...account
}: MemberAccountProps & {
	branding: Branding;
	view: ViewId;
	navigate: NavigateFn;
	directory: SessionDirectory;
	agents: AgentSummary[];
	agentSlug: string | null;
	sessionId: string | null;
	/** 聊天视图注入的打开行实时状态（运行中/需注意/失败/刚完成）；其余视图缺省。 */
	activeStatus?: "running" | "attention" | "failed" | "completed";
	/** 会话流报错的会话 id：侧栏不展示其不可信的索引状态标记。 */
	staleStatusId?: string | null;
	header?: (menuToggle: ReactNode) => ReactNode;
	dialogs?: ReactNode;
	aside?: ReactNode | ((controls: LayoutAsideControls) => ReactNode);
	asideOpen?: boolean;
	asideLabel?: string;
	onAsideOpenChange?: (open: boolean) => void;
	children: ReactNode;
}) {
	// 未提供 header 时 Layout 只在移动端给标题栏（含抽屉开关），桌面正文不再有公共页头。
	const viewTitle = { usage: "我的用量", plaza: "Agent 广场", new: "新建聊天", chat: "Agent 对话" }[view];
	return (
		<Layout
			data-testid="experience-shell"
			header={header}
			mobileTitle={viewTitle}
			dialogs={dialogs}
			aside={aside}
			asideOpen={asideOpen}
			asideLabel={asideLabel}
			onAsideOpenChange={onAsideOpenChange}
			sidebar={({ closeSidebar, closeButton }) => (
				<SessionSidebar
					branding={branding}
					view={view}
					navigate={navigate}
					directory={directory}
					agents={agents}
					agentSlug={agentSlug}
					sessionId={sessionId}
					activeStatus={activeStatus}
					staleStatusId={staleStatusId}
					closeSidebar={closeSidebar}
					closeButton={closeButton}
					{...account}
				/>
			)}
		>
			{children}
		</Layout>
	);
}
