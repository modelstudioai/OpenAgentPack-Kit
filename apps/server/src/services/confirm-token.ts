/**
 * 破坏性动作的一次性确认令牌（plan → confirm → execute）。
 * 仅 server 使用 WebCrypto 实现。见 docs/protocol.md「确认令牌」。
 */
export interface ConfirmationPayload {
	planId: string;
	action: string;
	subject: string;
	expiresAt: number;
}

export interface ConfirmationSigner {
	sign(payload: Omit<ConfirmationPayload, "expiresAt">, ttlMs?: number): Promise<{ token: string; expiresAt: number }>;
	verify(token: string, expected: Omit<ConfirmationPayload, "expiresAt">): Promise<{ ok: boolean; reason?: string }>;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function enc(input: string): Uint8Array {
	return new TextEncoder().encode(input);
}

function b64url(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array {
	const padded = text
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(text.length / 4) * 4, "=");
	const binary = atob(padded);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

export function createConfirmationSigner(secret: string): ConfirmationSigner {
	const keyMaterial = () =>
		crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

	const mac = async (message: string): Promise<Uint8Array> => {
		const key = await keyMaterial();
		return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc(message)));
	};

	return {
		async sign(payload, ttlMs = DEFAULT_TTL_MS) {
			const expiresAt = Date.now() + ttlMs;
			const body: ConfirmationPayload = { ...payload, expiresAt };
			const message = b64url(enc(JSON.stringify(body)));
			const sig = b64url(await mac(message));
			return { token: `${message}.${sig}`, expiresAt };
		},
		async verify(token, expected) {
			const dot = token.lastIndexOf(".");
			if (dot <= 0) return { ok: false, reason: "malformed" };
			const message = token.slice(0, dot);
			const sig = token.slice(dot + 1);
			let payload: ConfirmationPayload;
			try {
				payload = JSON.parse(new TextDecoder().decode(fromB64url(message))) as ConfirmationPayload;
			} catch {
				return { ok: false, reason: "malformed" };
			}
			const expectedSig = b64url(await mac(message));
			if (!timingSafeEqual(fromB64url(sig), fromB64url(expectedSig))) return { ok: false, reason: "bad_signature" };
			if (payload.expiresAt < Date.now()) return { ok: false, reason: "expired" };
			if (
				payload.planId !== expected.planId ||
				payload.action !== expected.action ||
				payload.subject !== expected.subject
			) {
				return { ok: false, reason: "mismatch" };
			}
			return { ok: true };
		},
	};
}
