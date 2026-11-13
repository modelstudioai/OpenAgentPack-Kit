import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useState } from "react";
import styles from "./app.module.less";
import { EvalPage } from "./eval-page.tsx";
import { AdminLogin } from "./features/auth/admin-login.tsx";
import { BrandingPage } from "./features/branding/branding-page.tsx";
import { MembersPage } from "./features/members/members-page.tsx";
import { ConsoleLayout } from "./features/navigation/console-layout.tsx";
import { type ConsoleTab, consoleRouteTab } from "./features/navigation/console-route.ts";
import { ConsoleRouter, useConsoleRoute } from "./features/navigation/console-router.tsx";
import { OperationsPage } from "./features/operations/operations-page.tsx";
import { CreateTemplatePage } from "./features/templates/create-template-page.tsx";
import { TemplateDebugCleanupNotice } from "./features/templates/template-debug-cleanup-notice.tsx";
import { TemplateExitConfirmationProvider } from "./features/templates/template-exit-confirmation.tsx";
import { TemplateListPage } from "./features/templates/template-list-page.tsx";
import { SessionUsagePage } from "./features/usage/session-usage-page.tsx";
import { antdTheme } from "./lib/antd-theme.ts";
import { adminToken } from "./lib/api.ts";

const PAGE_COMPONENTS = {
	operations: OperationsPage,
	usage: SessionUsagePage,
	branding: BrandingPage,
	eval: EvalPage,
};

function getSimplePage(tab: ConsoleTab) {
	return tab in PAGE_COMPONENTS ? PAGE_COMPONENTS[tab as keyof typeof PAGE_COMPONENTS] : null;
}

export function App() {
	// button/wave 对齐百炼 BailianConfigProvider：按钮无点击波纹、两字按钮不自动拆分
	return (
		<ConfigProvider theme={antdTheme} locale={zhCN} button={{ autoInsertSpace: false }} wave={{ disabled: true }}>
			<AntdApp>
				<TemplateExitConfirmationProvider>
					<ConsoleRouter>
						<ConsoleApp />
					</ConsoleRouter>
				</TemplateExitConfirmationProvider>
			</AntdApp>
		</ConfigProvider>
	);
}

function ConsoleApp() {
	const { route, navigate, complete, locked: navigationLocked, setLocked: setNavigationLocked } = useConsoleRoute();
	const tab = consoleRouteTab(route);
	const [token, setToken] = useState(adminToken());
	const [savedTemplateName, setSavedTemplateName] = useState<string>();
	if (!token) return <AdminLogin onLogin={setToken} />;
	const Page = getSimplePage(tab);
	return (
		<ConsoleLayout
			tab={tab}
			onChange={(next) => {
				if (next === route.page && !route.id && !route.tab && !route.preset) return;
				setSavedTemplateName(undefined);
				navigate({ page: next });
			}}
			disabled={navigationLocked}
		>
			<TemplateDebugCleanupNotice />
			{Page ? (
				<Page />
			) : tab === "template-create" ? (
				<CreateTemplatePage
					onPendingChange={setNavigationLocked}
					onCancel={() => navigate({ page: "template-list" })}
					onSaved={(template) => {
						setSavedTemplateName(template.name);
						complete({ page: "template-list" });
					}}
				/>
			) : tab === "template-list" ? (
				<TemplateListPage
					savedName={savedTemplateName}
					onPendingChange={setNavigationLocked}
					onCreate={() => {
						setSavedTemplateName(undefined);
						navigate({ page: "template-create" });
					}}
				/>
			) : (
				<MembersPage onPendingChange={setNavigationLocked} />
			)}
			{tab !== "template-create" && tab !== "template-list" ? (
				<p className={styles.pageFootnote}>智能体资产用于创建、编辑和调试模版，智能体管理提供上架与下架操作。</p>
			) : null}
		</ConsoleLayout>
	);
}
