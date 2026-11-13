export function normalizedMountPath(path: string) {
	return `/${path
		.trim()
		.split("/")
		.filter((part) => part && part !== ".")
		.join("/")}`;
}

/** 与 kit 挂载解析约定一致；保留已占用路径，为同名文件添加数字后缀。 */
export function defaultMountPath(filename: string, fallback: string, used: Set<string>) {
	const base = filename.split(/[\\/]/).pop()?.trim() ?? "";
	const name = base.replace(/^\.+/, "").replace(/\s+/g, "_") || fallback;
	const path = `/mnt/session/uploads/${name}`;
	const dot = path.lastIndexOf(".");
	const split = dot > path.lastIndexOf("/") ? dot : path.length;
	let candidate = path;
	for (let suffix = 2; used.has(candidate); suffix++) {
		candidate = `${path.slice(0, split)}-${suffix}${path.slice(split)}`;
	}
	return candidate;
}
