import { sleep } from "../chat/reconnect.ts";
import { uploadSizeRejectionReason, uploadTypeRejectionReason } from "../protocol/index.ts";
import type { KitClient } from "../providers/kit/client.ts";
import { createObservable } from "../state.ts";

export interface StagedFile {
	file_id: string;
	filename: string;
	size: number;
	available: boolean;
	timedOut?: boolean;
}
export interface PendingFile {
	uid: string;
	name: string;
	size: number;
}
export interface FailedFile extends PendingFile {
	message: string;
}
/** A file-like input; file pickers, paste and drop remain UI/host responsibilities. */
export interface UploadSource {
	name: string;
	size: number;
	type?: string;
	arrayBuffer(): Promise<ArrayBuffer>;
}
export interface AttachmentsOptions {
	pollIntervalMs?: number;
	scanTimeoutMs?: number;
}

export function createAttachments(client: KitClient, options: AttachmentsOptions = {}) {
	const store = createObservable({
		files: [] as StagedFile[],
		pending: [] as PendingFile[],
		failures: [] as FailedFile[],
	});
	const jobs = new Map<string, AbortController>();
	let sequence = 0;
	let disposed = false;
	const publish = (change: Partial<ReturnType<typeof store.getSnapshot>>) => {
		if (!disposed) store.set({ ...store.getSnapshot(), ...change });
	};
	function remove(id: string) {
		jobs.get(id)?.abort();
		jobs.delete(id);
		const state = store.getSnapshot();
		publish({
			files: state.files.filter((file) => file.file_id !== id),
			pending: state.pending.filter((file) => file.uid !== id),
			failures: state.failures.filter((file) => file.uid !== id),
		});
	}
	const updateFile = (id: string, patch: Partial<StagedFile>) =>
		publish({ files: store.getSnapshot().files.map((row) => (row.file_id === id ? { ...row, ...patch } : row)) });
	function rejectFile(file: StagedFile, status: string) {
		publish({
			files: store.getSnapshot().files.filter((row) => row.file_id !== file.file_id),
			failures: [
				...store.getSnapshot().failures,
				{
					uid: file.file_id,
					name: file.filename,
					size: file.size,
					message: status === "rejected" ? "文件未通过安全审核" : "文件类型不被允许",
				},
			],
		});
	}
	async function scanOnce(file: StagedFile, signal: AbortSignal): Promise<boolean> {
		try {
			const status = await client.fileStatus(file.file_id, signal);
			signal.throwIfAborted();
			if (status.available) {
				updateFile(file.file_id, { available: true });
				return true;
			}
			if (status.status === "rejected" || status.status === "type_rejected") {
				rejectFile(file, status.status);
				return true;
			}
		} catch (error) {
			if (signal.aborted) throw error;
		}
		return false;
	}
	async function scan(file: StagedFile, owner: AbortController) {
		const signal = AbortSignal.any([owner.signal, AbortSignal.timeout(options.scanTimeoutMs ?? 45_000)]);
		try {
			while (!signal.aborted) {
				await sleep(options.pollIntervalMs ?? 1500, signal);
				if (await scanOnce(file, signal)) return;
			}
		} catch {
			if (!owner.signal.aborted) updateFile(file.file_id, { timedOut: true });
		} finally {
			jobs.delete(file.file_id);
		}
	}
	async function uploadSource(source: UploadSource, signal: AbortSignal) {
		const rejection = uploadSizeRejectionReason(source.size) ?? uploadTypeRejectionReason(source.name);
		if (rejection) throw new Error(rejection);
		const bytes = new Uint8Array(await source.arrayBuffer());
		signal.throwIfAborted();
		return client.uploadFile({ name: source.name, bytes, mimeType: source.type || undefined }, signal);
	}
	async function upload(picked: UploadSource[]) {
		if (disposed) throw new Error("附件接入已释放");
		await Promise.all(
			picked.map(async (source) => {
				const uid = `pending-${++sequence}`;
				const owner = new AbortController();
				jobs.set(uid, owner);
				publish({ pending: [...store.getSnapshot().pending, { uid, name: source.name, size: source.size }] });
				try {
					const info = await uploadSource(source, owner.signal);
					owner.signal.throwIfAborted();
					const staged = { ...info, available: false };
					publish({ files: [...store.getSnapshot().files, staged] });
					jobs.set(info.file_id, owner);
					void scan(staged, owner);
				} catch (error) {
					if (!owner.signal.aborted)
						publish({
							failures: [
								...store.getSnapshot().failures,
								{
									uid,
									name: source.name,
									size: source.size,
									message: error instanceof Error ? error.message : String(error),
								},
							],
						});
				} finally {
					jobs.delete(uid);
					publish({ pending: store.getSnapshot().pending.filter((file) => file.uid !== uid) });
				}
			}),
		);
	}
	return {
		...store,
		upload,
		remove,
		consume(ids: string[]) {
			for (const id of ids) remove(id);
		},
		clear() {
			for (const owner of jobs.values()) owner.abort();
			jobs.clear();
			publish({ files: [], pending: [], failures: [] });
		},
		dispose() {
			disposed = true;
			for (const owner of jobs.values()) owner.abort();
			jobs.clear();
		},
	};
}
