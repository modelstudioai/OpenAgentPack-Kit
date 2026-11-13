import { ErrorState } from "@openagentpack/kit-chat-ui";
import { useState } from "react";

const fieldClass =
	"mt-2 block w-full rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-bg-subtle)] px-3 py-2 text-sm disabled:opacity-50";

export function MemberLoginForm({
	pending,
	error,
	onLogin,
	onRetry,
}: {
	pending: boolean;
	error: string | null;
	onLogin: (input: { username: string; password: string }) => Promise<void>;
	onRetry: () => Promise<void>;
}) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	return (
		<main className="flex min-h-full items-center justify-center p-4">
			<form
				aria-labelledby="member-login-heading"
				className="w-full max-w-md space-y-6 rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-bg)] p-6 shadow-[var(--kit-shadow)]"
				onSubmit={(event) => {
					event.preventDefault();
					if (pending) return;
					void onLogin({ username: username.trim(), password })
						.catch(() => undefined)
						.finally(() => {
							setPassword("");
						});
				}}
			>
				<header>
					<p className="mb-2 text-sm text-[var(--kit-fg-muted)]">OpenAgentPack Kit</p>
					<h1 id="member-login-heading" className="text-xl font-semibold">
						成员登录
					</h1>
					<p className="mt-2 text-sm text-[var(--kit-fg-muted)]">使用管理员为你创建的用户名和密码登录。</p>
				</header>
				{error && (
					<ErrorState message={error} onRetry={pending ? undefined : () => void onRetry().catch(() => undefined)} />
				)}
				<fieldset disabled={pending} className="space-y-4">
					<legend className="sr-only">成员账号</legend>
					<div>
						<label htmlFor="login-username" className="text-sm">
							用户名
						</label>
						<input
							id="login-username"
							name="username"
							autoComplete="username"
							required
							maxLength={32}
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							className={fieldClass}
						/>
					</div>
					<div>
						<label htmlFor="login-password" className="text-sm">
							密码
						</label>
						<input
							id="login-password"
							name="password"
							type="password"
							autoComplete="current-password"
							required
							maxLength={128}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							className={fieldClass}
						/>
					</div>
					<button
						type="submit"
						className="w-full rounded-[var(--kit-radius-sm)] bg-[var(--kit-accent)] px-4 py-2 text-sm font-semibold text-[var(--kit-accent-fg)] disabled:opacity-50"
					>
						{pending ? "处理中…" : "登录"}
					</button>
				</fieldset>
			</form>
		</main>
	);
}
