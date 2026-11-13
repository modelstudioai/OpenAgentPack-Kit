/**
 * 技能 token 语法（ADR-0016）：同一意图的两个文本形态——输入侧 `/name` 标记（用户编辑）
 * 与协议侧 `[使用 Skill:name]` token（随事件回显、即气泡正文的一部分）。compose 只转换
 * 载荷授权名单内的技能名；parse 按已知技能名精确匹配切分，未知名 token 按原文保留。
 * 语法常量冻结在此，任何改动需先改 ADR-0016 与 docs/protocol.md。
 */

/** 输入侧标记前缀。交互层在标记后插入一个分隔空格；空格不属标记本体。 */
export const SKILL_INPUT_PREFIX = "/";

/** 协议侧 token 的包裹形式。 */
export const SKILL_TOKEN_PREFIX = "[使用 Skill:";
export const SKILL_TOKEN_SUFFIX = "]";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 匹配单个技能名输入标记的边界正则：标记前须是行首或空白、后须紧跟空白或行尾，
 * 避免 `asd/name`、路径片段被误当标记；前瞻不消费分隔空格。
 */
function inputTokenRegExp(name: string): RegExp {
	return new RegExp(`(^|\\s)/${escapeRegExp(name)}(?=\\s|$)`, "g");
}

/** 匹配已知技能名协议 token 的全局正则；名单为空时返回 null。 */
export function skillTokenRegExp(knownSkills: readonly string[]): RegExp | null {
	if (knownSkills.length === 0) return null;
	return new RegExp(
		`${escapeRegExp(SKILL_TOKEN_PREFIX)}(${knownSkills.map(escapeRegExp).join("|")})${escapeRegExp(SKILL_TOKEN_SUFFIX)}`,
		"g",
	);
}

/**
 * 把文本中授权名单技能名的输入标记转为协议 token；非授权名与未匹配形态原样保留，
 * 无名单时原文返回。转换是逐名独立进行的，顺序无关（边界前瞻保证不误匹配）。
 */
export function composeSkillDirective(text: string, authorizedSkills: readonly string[]): string {
	let composed = text;
	for (const name of authorizedSkills) {
		composed = composed.replace(inputTokenRegExp(name), (_match, boundary: string) => {
			return `${boundary}${SKILL_TOKEN_PREFIX}${name}${SKILL_TOKEN_SUFFIX}`;
		});
	}
	return composed;
}

/** parse 产物的依序分段：文本与技能 token 穿插交错，渲染层按序原位还原 chip。 */
export type SkillDirectiveSegment = { kind: "text"; value: string } | { kind: "skill"; name: string };

/**
 * 按已知技能名精确切分协议 token，产出穿插分段；未知名的 token 不匹配、按原文保留。
 * 名单为空时整段作为纯文本返回，空文本返回空分段。
 */
export function parseSkillDirective(text: string, knownSkills: readonly string[]): SkillDirectiveSegment[] {
	const tokenPattern = skillTokenRegExp(knownSkills);
	if (!tokenPattern) return text ? [{ kind: "text", value: text }] : [];
	const segments: SkillDirectiveSegment[] = [];
	let cursor = 0;
	for (let match = tokenPattern.exec(text); match !== null; match = tokenPattern.exec(text)) {
		if (match.index > cursor) segments.push({ kind: "text", value: text.slice(cursor, match.index) });
		segments.push({
			kind: "skill",
			name: match[0].slice(SKILL_TOKEN_PREFIX.length, match[0].length - SKILL_TOKEN_SUFFIX.length),
		});
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) segments.push({ kind: "text", value: text.slice(cursor) });
	return segments;
}

/**
 * 扫描文本中名单内技能名的输入标记，产出标记名与位置（`/name` 本体，不含尾随分隔空格），
 * 按出现顺序返回；供交互层做覆盖层高亮与原子删除。词中出现（`asd/name`）与未知名不计入。
 */
export interface SkillInputMarker {
	name: string;
	start: number;
	end: number;
}

export function skillInputMarkerRanges(text: string, knownSkills: readonly string[]): SkillInputMarker[] {
	if (knownSkills.length === 0 || !text) return [];
	const pattern = new RegExp(`(^|\\s)/(${knownSkills.map(escapeRegExp).join("|")})(?=\\s|$)`, "g");
	const markers: SkillInputMarker[] = [];
	for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
		const raw = match[0];
		const slash = raw.indexOf(SKILL_INPUT_PREFIX);
		const start = match.index + slash;
		const name = raw.slice(slash + SKILL_INPUT_PREFIX.length);
		markers.push({ name, start, end: start + SKILL_INPUT_PREFIX.length + name.length });
	}
	return markers;
}

/**
 * 扫描文本中名单内技能名的输入标记，按首现顺序去重返回；用于从正文派生 skills 载荷。
 * 词中出现（`asd/name`）与未知名不计入。
 */
export function skillInputTokens(text: string, knownSkills: readonly string[]): string[] {
	if (knownSkills.length === 0 || !text) return [];
	const names = new Set<string>();
	for (const marker of skillInputMarkerRanges(text, knownSkills)) names.add(marker.name);
	return [...names];
}
