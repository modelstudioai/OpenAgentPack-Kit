import {
	createMemberAuthController,
	type MemberAuthController,
	type MemberAuthOptions,
} from "@openagentpack/kit-sdk/auth";
import { useMemberAuth } from "@openagentpack/kit-sdk/auth/hooks";
import { KitProvider } from "@openagentpack/kit-sdk/providers/kit/react";
import type { FormEvent, ReactNode } from "react";

// Call once after public config resolves the final API URL. The host's storage
// must be scoped to that full URL, including its path prefix. Store no password.
export function createLogin(options: MemberAuthOptions) {
	return createMemberAuthController(options);
}

export function MemberRoot({ controller, children }: { controller: MemberAuthController; children: ReactNode }) {
	const auth = useMemberAuth(controller);
	if (auth.status === "checking") return <p>Restoring sign-in…</p>;
	if (auth.status === "error") {
		return (
			<section>
				<p role="alert">{auth.error}</p>
				<button type="button" onClick={() => void auth.retry()}>
					Retry
				</button>
			</section>
		);
	}
	if (!auth.client) {
		const submit = async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const form = event.currentTarget;
			const data = new FormData(form);
			try {
				await auth.login({
					username: String(data.get("username") ?? ""),
					password: String(data.get("password") ?? ""),
				});
			} catch {
				// The controller exposes a safe error in its snapshot.
			} finally {
				const password = form.elements.namedItem("password");
				if (password instanceof HTMLInputElement) password.value = "";
			}
		};
		return (
			<form onSubmit={submit}>
				<label>
					Username <input name="username" autoComplete="username" required disabled={auth.pending} />
				</label>
				<label>
					Password{" "}
					<input name="password" type="password" autoComplete="current-password" required disabled={auth.pending} />
				</label>
				{auth.error && <p role="alert">{auth.error}</p>}
				<button type="submit" disabled={auth.pending}>
					Sign in
				</button>
			</form>
		);
	}
	return (
		<KitProvider key={auth.generation} client={auth.client}>
			<header>
				{auth.member?.display_name}
				{auth.member && (
					<button type="button" onClick={() => void auth.logout()}>
						Sign out
					</button>
				)}
			</header>
			{children}
		</KitProvider>
	);
}
