import type { ArtifactDescriptor } from "../protocol/index.ts";
import type { KitClient } from "../providers/kit/client.ts";
import { createObservable } from "../state.ts";
import {
	DANGEROUS_PREVIEW_TYPES,
	mimeOfType,
	previewableArtifactType,
	previewBlobOf,
	resolveArtifactType,
} from "./artifact-types.ts";

export interface ArtifactHost {
	/** Reserve synchronously during the user's gesture. Browser/desktop implementations stay in the host. */
	reservePreview?: () => { show(blob: Blob): boolean | Promise<boolean>; close(): void } | null;
	save?: (input: { filename: string; blob: Blob }) => Promise<boolean>;
	fallbackSave: (input: { filename: string; blob: Blob }) => Promise<boolean>;
}
export interface ArtifactActionInput {
	sessionId?: string;
	artifacts?: ArtifactDescriptor[];
	contentType?: string;
}
function artifactFilename(fileId: string, response: Response, options: ArtifactActionInput): string {
	return (
		options.artifacts?.find((file) => file.file_id === fileId)?.filename ??
		response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
		fileId
	);
}
async function showPreview(
	target: ReturnType<NonNullable<ArtifactHost["reservePreview"]>> | undefined,
	blob: Blob,
	type: string,
	signal: AbortSignal,
) {
	if (!target || !previewableArtifactType(type)) return false;
	const converted = await previewBlobOf(blob, type);
	signal.throwIfAborted();
	return target.show(converted);
}
export function createArtifactActions(client: KitClient, host: ArtifactHost) {
	const store = createObservable({ pending: 0, error: null as string | null });
	const active = new Set<AbortController>();
	async function save(filename: string, blob: Blob) {
		if (!(await host.save?.({ filename, blob })) && !(await host.fallbackSave({ filename, blob })))
			throw new Error("当前宿主无法保存文件");
	}
	const reservePreview = (preview: boolean, contentType?: string) =>
		preview && !DANGEROUS_PREVIEW_TYPES.has(mimeOfType(contentType)) ? host.reservePreview?.() : null;
	const recordError = (error: unknown) =>
		store.set({ pending: active.size, error: error instanceof Error ? error.message : "文件读取失败，请重试" });
	async function run(fileId: string, options: ArtifactActionInput = {}, preview = false) {
		const owner = new AbortController();
		active.add(owner);
		const target = reservePreview(preview, options.contentType);
		store.set({ pending: active.size, error: null });
		try {
			const response = await client.downloadFile(fileId, { sessionId: options.sessionId, signal: owner.signal });
			const blob = await response.blob();
			owner.signal.throwIfAborted();
			const filename = artifactFilename(fileId, response, options);
			const type = resolveArtifactType(options.contentType, filename, response.headers.get("content-type") ?? "");
			if (await showPreview(target, blob, type, owner.signal)) return;
			target?.close();
			owner.signal.throwIfAborted();
			await save(filename, blob);
		} catch (error) {
			target?.close();
			if (!owner.signal.aborted) recordError(error);
			throw error;
		} finally {
			active.delete(owner);
			if (!owner.signal.aborted) store.set({ ...store.getSnapshot(), pending: active.size });
		}
	}
	return {
		...store,
		download: (fileId: string, options?: Parameters<typeof run>[1]) => run(fileId, options),
		open: (fileId: string, options?: Parameters<typeof run>[1]) => run(fileId, options, true),
		dispose() {
			for (const owner of active) owner.abort();
			active.clear();
		},
	};
}
