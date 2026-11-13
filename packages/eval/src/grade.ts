import { extractJson, type LlmClient } from "./llm.ts";
import type { AssertionResult } from "./schema.ts";

/** 归一化 transcript 事件（来自 SDK listSessionEvents 的映射形状）。 */
export interface TranscriptEvent {
	type: string;
	role?: string;
	tool_name?: string;
	tool_input?: string;
	text?: string;
	raw_type?: string;
}

function textOf(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	return (content as { type?: string; text?: string }[])
		.filter((c) => c?.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

export function toTranscript(events: Record<string, unknown>[]): TranscriptEvent[] {
	return events.map((e) => {
		const text = textOf(e.content);
		return {
			type: String(e.type ?? "?"),
			...(e.raw_type ? { raw_type: String(e.raw_type) } : {}),
			...(e.role ? { role: String(e.role) } : {}),
			...(e.tool_name ? { tool_name: String(e.tool_name) } : {}),
			...(e.tool_input ? { tool_input: String(e.tool_input) } : {}),
			...(text ? { text } : {}),
		};
	});
}

/** 触发判定唯一信号（包级 AGENTS.md 不变量 2）：activate_skill 且 name 匹配。 */
export function detectTrigger(events: TranscriptEvent[], skillName: string): { triggered: boolean; atIndex: number } {
	for (let i = 0; i < events.length; i++) {
		const e = events[i] as TranscriptEvent;
		if (e.type !== "tool_use" || e.tool_name !== "activate_skill") continue;
		try {
			const input = JSON.parse(e.tool_input ?? "{}") as { name?: string };
			if (input.name === skillName) return { triggered: true, atIndex: i };
		} catch {}
	}
	return { triggered: false, atIndex: -1 };
}

const QUESTION_MARK = /[?？]/;

/** 首次 activate_skill 之前是否出现 assistant 提问（违反「零提问」类铁律）。 */
export function clarifyBeforeActivate(
	events: TranscriptEvent[],
	atIndex: number,
): { violated: boolean; evidence: string } {
	if (atIndex < 0) return { violated: false, evidence: "未触发技能，不适用该断言" };
	const before = events.slice(0, atIndex);
	const question = before.find(
		(e) => e.type === "message" && e.role === "assistant" && QUESTION_MARK.test(e.text ?? ""),
	);
	return question
		? { violated: true, evidence: `触发前出现提问：${(question.text ?? "").slice(0, 80)}` }
		: { violated: false, evidence: "首次 activate_skill 之前无 assistant 提问" };
}

export interface ScriptCtx {
	events: TranscriptEvent[];
	triggered: boolean;
	atIndex: number;
	turns: number;
	maxTurns: number;
	artifactText: string;
}

/** 脚本断言词表（见 schema.ts SCRIPT_ASSERTIONS）；未知名字判 FAIL 并给证据，不静默跳过。 */
export function runScriptAssertion(assertion: string, ctx: ScriptCtx): AssertionResult {
	const base = { text: assertion, kind: "script" as const };
	if (assertion === "skill_activated") {
		return {
			...base,
			passed: ctx.triggered,
			evidence: ctx.triggered ? `事件 #${ctx.atIndex} activate_skill` : "全程无 activate_skill 事件",
		};
	}
	if (assertion === "skill_not_activated") {
		return {
			...base,
			passed: !ctx.triggered,
			evidence: ctx.triggered ? `意外在事件 #${ctx.atIndex} 触发` : "无 activate_skill 事件",
		};
	}
	if (assertion === "no_clarify_before_activate") {
		const v = clarifyBeforeActivate(ctx.events, ctx.atIndex);
		return { ...base, passed: !v.violated, evidence: v.evidence };
	}
	if (assertion === "turns_within_budget") {
		return {
			...base,
			passed: ctx.turns <= ctx.maxTurns,
			evidence: `assistant 回合 ${ctx.turns} / 预算 ${ctx.maxTurns}`,
		};
	}
	if (assertion.startsWith("artifact_contains:")) {
		const needle = assertion.slice("artifact_contains:".length);
		const hit = ctx.artifactText.includes(needle);
		return { ...base, passed: hit, evidence: hit ? `产物文本包含「${needle}」` : `产物文本未包含「${needle}」` };
	}
	return { ...base, passed: false, evidence: `未知脚本断言：${assertion}（见 schema.ts 词表）` };
}

/**
 * judge 视图：消息全文保留（确认表单/写入回执都在 message 里），tool payload 只留头部——
 * 朴素整段截断会把大 write 载荷之后的关键证据切掉（2026-10-23 实测假失败根因）。
 */
function judgeLine(e: TranscriptEvent): string | null {
	if (e.type === "thinking" || e.type === "unknown" || e.type === "status") return null;
	if (e.type === "tool_use") return `[tool_use:${e.tool_name ?? "?"}] ${(e.tool_input ?? "").slice(0, 600)}`;
	if (e.type === "tool_result") return `[tool_result:${e.tool_name ?? "?"}] ${(e.text ?? "").slice(0, 600)}`;
	return `[${e.type}${e.role ? `/${e.role}` : ""}] ${e.text ?? ""}`.slice(0, 4000);
}

export function judgeView(events: TranscriptEvent[], budget = 30_000): string {
	const lines: string[] = [];
	let total = 0;
	for (const e of events) {
		const line = judgeLine(e);
		if (!line) continue;
		if (total + line.length > budget) {
			lines.push(`…（transcript 过长，余 ${events.length - lines.length} 事件省略）`);
			break;
		}
		lines.push(line);
		total += line.length;
	}
	return lines.join("\n");
}

/** judge 断言：一次调用批量判，强制 evidence 引原文；解析失败该条判 FAIL 不拖累其余。 */
export async function gradeWithJudge(
	llm: LlmClient,
	input: { skillName: string; skillMd: string; transcriptText: string; assertions: string[] },
): Promise<AssertionResult[]> {
	if (input.assertions.length === 0) return [];
	const prompt = [
		`你是 skill 评测裁判。技能名：${input.skillName}。`,
		"SKILL.md 如下：",
		input.skillMd.slice(0, 6000),
		"会话 transcript 如下：",
		input.transcriptText.slice(0, 12000),
		'逐条判断以下断言是否成立，输出 JSON 数组 [{"text","passed","evidence"}]；',
		"evidence 必须引用 transcript 或 SKILL.md 原文片段（≤80 字），不能只写结论。",
		JSON.stringify(input.assertions),
	].join("\n");
	const raw = await llm.chat([{ role: "user", content: prompt }], { temperature: 0 });
	const parsed = extractJson<{ text?: string; passed?: boolean; evidence?: string }[]>(raw);
	return input.assertions.map((text) => {
		const found = parsed.find((r) => r.text === text);
		return {
			text,
			kind: "judge" as const,
			passed: Boolean(found?.passed),
			evidence: (found?.evidence ?? "judge 未返回该条结果").slice(0, 200),
		};
	});
}

/** 加权通过率：rubric 权重优先，未登记权重按 1。 */
export function computeScore(results: AssertionResult[], weights: Record<string, number>): number {
	let total = 0;
	let got = 0;
	for (const r of results) {
		const w = weights[r.text] ?? 1;
		total += w;
		if (r.passed) got += w;
	}
	return total === 0 ? 0 : got / total;
}

/** 基础设施故障指纹扫描（沙箱/环境抖动）：命中返回指纹串，否则 null。见探针记录第 7 节。 */
export function detectInfraError(events: TranscriptEvent[], patterns: string[]): string | null {
	if (patterns.length === 0) return null;
	for (const e of events) {
		const hay = `${e.text ?? ""}\n${e.tool_input ?? ""}`;
		for (const pattern of patterns) {
			if (hay.includes(pattern)) return pattern;
		}
	}
	return null;
}
