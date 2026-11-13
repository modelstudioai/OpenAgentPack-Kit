import { type AttachmentRef, KitError } from "../protocol/index.ts";
import type { KitClient } from "../providers/kit/client.ts";
import { createObservable } from "../state.ts";
import { sleep } from "./reconnect.ts";

export function deriveTitle(text: string): string | undefined {
	return text.replace(/\s+/g, " ").trim().slice(0, 120) || undefined;
}
export interface ComposerBinding {
	agentSlug: string | null;
	sessionId: string | null;
	files: AttachmentRef[];
	send: (
		text: string,
		options: { sessionId: string; attachments: AttachmentRef[]; skills?: string[] },
	) => Promise<void>;
	onSessionCreated?: (id: string) => void;
	onAccepted?: (fileIds: string[]) => void;
}

/** Only coordinates backend calls. Drafts and skill selection belong to Sender/Chat. Failure always rejects. */
export function createComposer(client: KitClient, options: { retryDelayMs?: number } = {}) {
	const store = createObservable({ pending: false, error: null as unknown });
	let active: AbortController | undefined;
	let created: { slug: string; id: string } | undefined;
	let target: { slug: string | null; id: string | null } | undefined;
	async function createWithAttachments(text: string, binding: ComposerBinding, signal: AbortSignal) {
		const slug = binding.agentSlug;
		if (!slug) throw new KitError("conflict", "请先选择智能体");
		for (let attempt = 1; ; attempt++) {
			try {
				const detail = await client.createSession(
					{ agentSlug: slug, title: deriveTitle(text), files: binding.files },
					signal,
				);
				signal.throwIfAborted();
				created = { slug, id: detail.session_id };
				binding.onSessionCreated?.(detail.session_id);
				return detail.session_id;
			} catch (error) {
				const shape = error as { code?: string; retryable?: boolean };
				const retry = binding.files.length > 0 && shape?.code === "conflict" && shape.retryable === true && attempt < 3;
				if (signal.aborted || !retry) throw error;
				await sleep(options.retryDelayMs ?? 3000, signal);
			}
		}
	}
	const resolveSession = (text: string, binding: ComposerBinding, signal: AbortSignal) => {
		const id = binding.sessionId ?? (created?.slug === binding.agentSlug ? created.id : null);
		return id ? Promise.resolve(id) : createWithAttachments(text, binding, signal);
	};
	return {
		...store,
		setTarget(slug: string | null, id: string | null) {
			// 首次创建的 null → id 属于同一次发送，用户选择其他目标则取消旧流程。
			const ownCreation = target?.id === null && created?.id === id;
			if (target && (target.slug !== slug || (target.id !== id && !ownCreation))) {
				active?.abort();
				created = undefined;
				store.set({ pending: false, error: null });
			}
			target = { slug, id };
		},
		async send(text: string, binding: ComposerBinding, skills?: string[]) {
			if (store.getSnapshot().pending) throw new KitError("conflict", "消息正在发送，请等待结果");
			if (!binding.agentSlug) throw new KitError("conflict", "请先选择智能体");
			const owner = new AbortController();
			active = owner;
			const files = [...binding.files];
			store.set({ pending: true, error: null });
			try {
				const id = await resolveSession(text, { ...binding, files }, owner.signal);
				owner.signal.throwIfAborted();
				await binding.send(text, { sessionId: id, attachments: files, skills });
				owner.signal.throwIfAborted();
				binding.onAccepted?.(files.map((file) => file.file_id));
				store.set({ pending: false, error: null });
			} catch (error) {
				if (!owner.signal.aborted) store.set({ pending: false, error });
				throw error;
			}
		},
		dispose() {
			active?.abort();
		},
	};
}
