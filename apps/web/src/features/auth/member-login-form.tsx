import { ErrorState } from "@openagentpack/kit-chat-ui";
import { useState } from "react";

const fieldClass =
	"mt-2 block min-h-11 w-full min-w-0 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-bg-subtle)] px-3 py-2.5 text-[length:var(--kit-text-heading)] transition-colors focus-visible:border-[var(--kit-focus)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:opacity-50";

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
		<main className="grid min-h-full min-w-0 place-items-center px-4 py-8 sm:px-6">
			<form
				aria-labelledby="member-login-heading"
				className="w-full min-w-0 max-w-sm space-y-6 rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] p-6 shadow-[var(--kit-shadow)] sm:p-8"
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
				<header className="text-center">
					<p className="mb-3 text-[length:var(--kit-text-caption)] font-medium text-[var(--kit-fg-muted)]">
						Managed Agent
					</p>
					<h1 id="member-login-heading" className="text-[length:var(--kit-text-display)] font-medium leading-snug">
						成员登录
					</h1>
					<p className="mt-3 text-[length:var(--kit-text-label)] leading-6 text-[var(--kit-fg-muted)]">
						使用管理员为你创建的用户名和密码登录。
					</p>
				</header>
				{error && (
					<ErrorState message={error} onRetry={pending ? undefined : () => void onRetry().catch(() => undefined)} />
				)}
				<fieldset disabled={pending} className="min-w-0 space-y-5">
					<legend className="sr-only">成员账号</legend>
					<div>
						<label htmlFor="login-username" className="text-[length:var(--kit-text-label)] font-medium">
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
						<label htmlFor="login-password" className="text-[length:var(--kit-text-label)] font-medium">
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
						aria-busy={pending}
						className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--kit-radius-sm)] bg-[var(--kit-accent)] px-4 py-2.5 text-[length:var(--kit-text-base)] font-medium text-[var(--kit-accent-fg)] transition-opacity enabled:hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50"
					>
						{pending ? (
							<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
						) : null}
						{pending ? "处理中…" : "登录"}
					</button>
				</fieldset>
			</form>
		</main>
	);
}
