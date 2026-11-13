/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { atomicBackspace, renderValueInto, Sender, serializeEditable } from "./index.tsx";

const SKILLS = [
	{ name: "animate", description: "把界面变化做成顺滑过渡动画" },
	{ name: "frontend-design", description: "前端视觉与布局设计" },
];

describe("atomicBackspace", () => {
	const markers = [{ name: "animate", start: 2, end: 10 }];

	it("光标在标记内或紧随其后时整体删除（含尾随分隔空格）", () => {
		expect(atomicBackspace("用 /animate 画", 8, 8, markers)).toEqual({ value: "用 画", caret: 2 });
		expect(atomicBackspace("用 /animate 画", 10, 10, markers)).toEqual({ value: "用 画", caret: 2 });
	});

	it("光标在分隔空格之后走原生退格", () => {
		expect(atomicBackspace("用 /animate 画", 11, 11, markers)).toBeNull();
	});

	it("选区与标记相交时扩展到完整标记", () => {
		expect(atomicBackspace("用 /animate 画", 4, 20, markers)).toEqual({ value: "用 画", caret: 2 });
	});

	it("无标记相交返回 null", () => {
		expect(atomicBackspace("普通文本", 2, 2, [])).toBeNull();
		expect(atomicBackspace("用 /animate 画", 1, 1, markers)).toBeNull();
	});
});

describe("草稿 ↔ 编辑区 DOM 投影", () => {
	it("标记渲染成 contenteditable=false 的 chip 节点（svg 图标 + 名称），往返序列化一致", () => {
		const root = document.createElement("div");
		const value = "用 /animate 和 /frontend-design 画";
		renderValueInto(
			root,
			value,
			SKILLS.map((skill) => skill.name),
		);
		const chips = Array.from(root.querySelectorAll<HTMLElement>("[data-skill]"));
		expect(chips.map((chip) => chip.dataset.skill)).toEqual(["animate", "frontend-design"]);
		const chip = chips[0];
		expect(chip?.contentEditable).toBe("false");
		expect(chip?.querySelector("svg")).not.toBeNull();
		expect(chip?.textContent).toContain("animate");
		expect(serializeEditable(root)).toBe(value);
	});

	it("未知名与裸文本不渲染 chip，保持原样", () => {
		const root = document.createElement("div");
		renderValueInto(
			root,
			"写 /unknown 和 asd/animate 啊",
			SKILLS.map((skill) => skill.name),
		);
		expect(root.querySelector("[data-skill]")).toBeNull();
		expect(serializeEditable(root)).toBe("写 /unknown 和 asd/animate 啊");
	});

	it("空草稿渲染成真空 DOM（无占位 br）；br 节点还原为换行", () => {
		const empty = document.createElement("div");
		renderValueInto(empty, "", []);
		expect(empty.firstChild).toBeNull();
		expect(serializeEditable(empty)).toBe("");

		const multiline = document.createElement("div");
		multiline.append(
			document.createTextNode("第一行"),
			document.createElement("br"),
			document.createTextNode("第二行"),
		);
		expect(serializeEditable(multiline)).toBe("第一行\n第二行");
	});
});

describe("Sender 编辑区（contenteditable）", () => {
	// DOM 是编辑态的源、value 是投影：React 不渲染子节点，chip 由客户端同步 effect 落位。
	// 候选弹层已迁到 Suggestion，Sender 不再自行渲染技能列表。
	it("SSR 渲染空编辑区容器（contenteditable + placeholder），不含 chip 与弹层", () => {
		const html = renderToStaticMarkup(<Sender defaultValue="用 /animate 画" skills={SKILLS} />);
		expect(html).toContain('contentEditable="true"');
		expect(html).toContain("data-placeholder");
		expect(html).not.toContain("data-empty");
		expect(html).not.toContain("data-skill");
		expect(html).not.toContain("技能列表");
	});

	it("空草稿标记 data-empty；正文含标记也不渲染弹层", () => {
		const empty = renderToStaticMarkup(<Sender />);
		expect(empty).toContain('data-empty="true"');
		const draft = renderToStaticMarkup(<Sender defaultValue="/animate" skills={SKILLS} />);
		expect(draft).not.toContain("技能列表");
	});
});
