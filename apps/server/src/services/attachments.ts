import type { AttachmentRef } from "@openagentpack/kit-sdk/protocol";

/**
 * 默认挂载目录。实测（SDK 0.8 `PROVIDER_MOUNT_PREFIXES`）：bailian/ark 的 sandbox 前缀是 `/mnt`，
 * qoder 是 `/data`、claude 是 `/workspace`；kit 只服务 bailian，故默认落在 `/mnt/session/uploads`
 * （与 provider webui 的上传目录一致）。显式 `mount_path` 的前缀合法性由 SDK 校验并抛 UserError。
 */
export const DEFAULT_MOUNT_PREFIX = "/mnt/session/uploads";

function safeName(filename: string | undefined, fallback: string): string {
	const base = (filename ?? "").split(/[\\/]/).pop()?.trim() ?? "";
	const cleaned = base.replace(/^\.+/, "").replace(/\s+/g, "_");
	return cleaned.length > 0 ? cleaned : fallback;
}

function unique(path: string, used: Set<string>): string {
	if (!used.has(path)) return path;
	const dot = path.lastIndexOf(".");
	const split = dot > path.lastIndexOf("/") ? dot : path.length;
	for (let n = 2; ; n++) {
		const candidate = `${path.slice(0, split)}-${n}${path.slice(split)}`;
		if (!used.has(candidate)) return candidate;
	}
}

/**
 * 解析附件挂载路径（纯函数，单测覆盖）：
 * 省略 `mount_path` → `<prefix>/<安全文件名>`；显式值必须是绝对路径；同会话内路径唯一（冲突加 `-2`）。
 * 建会话与运行时挂载共用；运行时挂载把会话已有挂载路径传入 `taken` 防止覆盖同路径文件。
 */
export function resolveMounts(
	files: AttachmentRef[],
	prefix = DEFAULT_MOUNT_PREFIX,
	taken: Iterable<string> = [],
): AttachmentRef[] {
	const used = new Set(taken);
	return files.map((file, index) => {
		const requested = file.mount_path?.trim();
		const wanted = requested?.startsWith("/") ? requested : `${prefix}/${safeName(file.filename, `file_${index + 1}`)}`;
		const mountPath = unique(wanted, used);
		used.add(mountPath);
		return { ...file, mount_path: mountPath };
	});
}
