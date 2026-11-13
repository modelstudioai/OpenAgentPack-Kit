import { EmptyState } from "@openagentpack/kit-chat-ui";
import type { MemberAuthController } from "@openagentpack/kit-sdk/auth";
import { useMemberAuth } from "@openagentpack/kit-sdk/auth/hooks";
import type { MemberView } from "@openagentpack/kit-sdk/protocol";
import { KitProvider } from "@openagentpack/kit-sdk/providers/kit/react";
import type { ReactNode } from "react";
import { MemberLoginForm } from "./member-login-form.tsx";

export interface MemberAccountProps {
	member: MemberView | null;
	onLogout: () => Promise<void>;
}

/** 身份改变时整棵业务视图重新挂载；旧会话、草稿、附件与用量不进入新身份。 */
export function MemberAuthGate({
	controller,
	children,
}: {
	controller: MemberAuthController;
	children: (account: MemberAccountProps) => ReactNode;
}) {
	const auth = useMemberAuth(controller);
	if (auth.status === "checking") return <EmptyState title="正在恢复登录状态…" />;
	if (auth.client && (auth.status === "signed-in" || auth.status === "anonymous")) {
		return (
			<KitProvider key={auth.generation} client={auth.client}>
				{children({ member: auth.member, onLogout: auth.logout })}
			</KitProvider>
		);
	}
	return <MemberLoginForm pending={auth.pending} error={auth.error} onLogin={auth.login} onRetry={auth.retry} />;
}

export function MemberAccount({ member, onLogout }: MemberAccountProps) {
	if (!member) return null;
	return (
		<div className="ml-auto flex min-w-0 max-w-full items-center gap-2 text-[12px] md:text-[13px]">
			<span className="min-w-0 truncate text-[var(--kit-fg-muted)]" title={member.username}>
				{member.display_name}
			</span>
			<button
				type="button"
				onClick={() => void onLogout().catch(() => undefined)}
				className="shrink-0 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-3 py-1"
			>
				退出登录
			</button>
		</div>
	);
}
