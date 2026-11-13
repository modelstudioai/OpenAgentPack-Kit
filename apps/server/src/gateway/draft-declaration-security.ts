import { type DeclarationType, KitError, redactMemoryConfigurationText } from "@openagentpack/kit-sdk/protocol";

const sensitive = /(?:api[_-]?key|access[_-]?key|authorization|credential|headers?|password|secret|signature|token)/i;
const reference = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
function sensitiveField(type: DeclarationType, path: string[], value: unknown) {
	const key = path.at(-1) ?? "";
	if (type === "vault" && path[0] === "credentials") {
		if (path.length === 1 && Array.isArray(value)) return false;
		if (path.length === 3 && key === "secret_name") return false;
		if (path.length === 4 && path[2] === "injection_location" && key === "header" && typeof value === "boolean")
			return false;
	}
	return sensitive.test(key) || path.at(-2) === "environment_variables";
}
const emptyOrReference = (value: unknown) =>
	value === undefined || value === null || value === "" || (typeof value === "string" && reference.test(value));

/** 与新建输入一样，编辑不接受明文凭据；字段检查必须在 SDK 规范化之前递归执行。 */
export function assertSafeDraftDeclaration(type: DeclarationType, value: unknown, path: string[] = []) {
	if (
		["__proto__", "constructor", "prototype"].includes(path.at(-1) ?? "") ||
		(sensitiveField(type, path, value) && !emptyOrReference(value)) ||
		(typeof value === "string" && redactMemoryConfigurationText(value) !== value)
	)
		throw new KitError("invalid_request", "资源声明不能包含明文凭据，请使用密钥库或环境变量引用");
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) assertSafeDraftDeclaration(type, item, [...path, String(index)]);
	} else if (value && typeof value === "object") {
		for (const [child, item] of Object.entries(value)) assertSafeDraftDeclaration(type, item, [...path, child]);
	}
}

/** 防御旧版本已接受的声明；读取不改变存储，受限字段的位置交给调用方展示。 */
export function redactDraftDeclaration(
	type: DeclarationType,
	value: unknown,
	readOnly: string[][],
	path: string[] = [],
): unknown {
	const key = path.at(-1) ?? "";
	if (sensitiveField(type, path, value) && !emptyOrReference(value)) {
		readOnly.push(path);
		return "[redacted]";
	}
	if (typeof value === "string") {
		// Agent 的描述和指令读取保留原文；其写入仍经过上述校验。
		if (type === "agent" && path.length === 1 && ["description", "instructions"].includes(key)) return value;
		const safe = redactMemoryConfigurationText(value);
		if (safe !== value) readOnly.push(path);
		return safe;
	}
	if (Array.isArray(value))
		return value.map((item, index) => redactDraftDeclaration(type, item, readOnly, [...path, String(index)]));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([child, item]) => [
			child,
			redactDraftDeclaration(type, item, readOnly, [...path, child]),
		]),
	);
}
