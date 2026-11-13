import { describe, expect, it } from "vitest";
import {
	composeSkillDirective,
	parseSkillDirective,
	SKILL_TOKEN_PREFIX,
	SKILL_TOKEN_SUFFIX,
	skillInputMarkerRanges,
	skillInputTokens,
	skillTokenRegExp,
} from "./skill-directive.ts";

describe("composeSkillDirective", () => {
	it("转换授权名单内的输入标记为协议 token，保留分隔空格", () => {
		expect(composeSkillDirective("帮我 /frontend-design 审查页面", ["frontend-design"])).toBe(
			"帮我 [使用 Skill:frontend-design] 审查页面",
		);
	});

	it("句首与连续标记均可转换", () => {
		expect(composeSkillDirective("/frontend-design /animate 动效", ["frontend-design", "animate"])).toBe(
			"[使用 Skill:frontend-design] [使用 Skill:animate] 动效",
		);
	});

	it("裸 token（正文为空）同样转换", () => {
		expect(composeSkillDirective("/animate ", ["animate"])).toBe(`[使用 Skill:animate] `);
	});

	it("非授权名的 /name 原样保留", () => {
		const text = "路径 /usr/bin 与未知 /foo 保持原样";
		expect(composeSkillDirective(text, ["frontend-design"])).toBe(text);
	});

	it("无授权名单时原文返回", () => {
		expect(composeSkillDirective("/frontend-design 任务", [])).toBe("/frontend-design 任务");
	});

	it("词中出现与无边界跟随的名字不是标记", () => {
		expect(composeSkillDirective("asd/frontend-design 3/4", ["frontend-design"])).toBe("asd/frontend-design 3/4");
	});

	it("紧跟标点（无空白边界）不转换，标记须以空白或行尾收尾", () => {
		expect(composeSkillDirective("a /animate,b", ["animate"])).toBe("a /animate,b");
	});

	it("名字含正则特殊字符时按字面匹配", () => {
		expect(composeSkillDirective("看 /Code_Review.1 先", ["Code_Review.1"])).toBe("看 [使用 Skill:Code_Review.1] 先");
	});
});

describe("parseSkillDirective", () => {
	it("按已知技能名切分并保留位置顺序", () => {
		expect(
			parseSkillDirective("是的 [使用 Skill:frontend-design] 中间 [使用 Skill:animate] 尾", [
				"frontend-design",
				"animate",
			]),
		).toEqual([
			{ kind: "text", value: "是的 " },
			{ kind: "skill", name: "frontend-design" },
			{ kind: "text", value: " 中间 " },
			{ kind: "skill", name: "animate" },
			{ kind: "text", value: " 尾" },
		]);
	});

	it("开头与结尾的 token 不产生空文本分段", () => {
		expect(parseSkillDirective("[使用 Skill:animate]", ["animate"])).toEqual([{ kind: "skill", name: "animate" }]);
	});

	it("未知名的 token 按原文保留", () => {
		expect(parseSkillDirective("[使用 Skill:ghost] 正文", ["frontend-design"])).toEqual([
			{ kind: "text", value: "[使用 Skill:ghost] 正文" },
		]);
	});

	it("空名单整段纯文本，空文本返回空分段", () => {
		expect(parseSkillDirective("正文", [])).toEqual([{ kind: "text", value: "正文" }]);
		expect(parseSkillDirective("", ["frontend-design"])).toEqual([]);
	});

	it("compose 后 parse 往返还原穿插分段", () => {
		const raw = "帮我 /frontend-design 审查 /animate 动效";
		const composed = composeSkillDirective(raw, ["frontend-design", "animate"]);
		expect(parseSkillDirective(composed, ["frontend-design", "animate"])).toEqual([
			{ kind: "text", value: "帮我 " },
			{ kind: "skill", name: "frontend-design" },
			{ kind: "text", value: " 审查 " },
			{ kind: "skill", name: "animate" },
			{ kind: "text", value: " 动效" },
		]);
	});

	it("skillTokenRegExp 空名单返回 null", () => {
		expect(skillTokenRegExp([])).toBeNull();
		expect(SKILL_TOKEN_PREFIX).toBe("[使用 Skill:");
		expect(SKILL_TOKEN_SUFFIX).toBe("]");
	});
});

describe("skillInputTokens", () => {
	it("按首现顺序去重扫描输入标记", () => {
		expect(skillInputTokens("/animate 与 /frontend-design 和 /animate", ["frontend-design", "animate"])).toEqual([
			"animate",
			"frontend-design",
		]);
	});

	it("未知名与词中出现不计入", () => {
		expect(skillInputTokens("/ghost 与 asd/animate", ["frontend-design", "animate"])).toEqual([]);
	});

	it("空名单或空文本返回空数组", () => {
		expect(skillInputTokens("/animate", [])).toEqual([]);
		expect(skillInputTokens("", ["animate"])).toEqual([]);
	});
});

describe("skillInputMarkerRanges", () => {
	it("产出标记名与 /name 本体位置（不含尾随空格），按出现顺序", () => {
		const text = "先 /animate 再 /Code_Review.1";
		expect(skillInputMarkerRanges(text, ["animate", "Code_Review.1"])).toEqual([
			{ name: "animate", start: 2, end: 10 },
			{ name: "Code_Review.1", start: 13, end: 27 },
		]);
	});

	it("词中出现与未知名不产出标记", () => {
		expect(skillInputMarkerRanges("asd/animate 与 /ghost", ["animate"])).toEqual([]);
	});

	it("空名单或空文本返回空数组", () => {
		expect(skillInputMarkerRanges("/animate", [])).toEqual([]);
		expect(skillInputMarkerRanges("", ["animate"])).toEqual([]);
	});
});
