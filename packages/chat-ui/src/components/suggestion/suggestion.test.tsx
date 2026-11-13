/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Suggestion } from "./index.tsx";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

// 用户先用方向键浏览，再缩小查询或插入下一个技能，仍必须能用键盘选择当前候选。
it("自动查询过滤和重新触发后重置高亮，Enter 与 Tab 仍能选择", async () => {
	const onSelect = vi.fn();
	const items = ["alpha", "beta", "bravo"].map((value) => ({ label: value, value }));
	const render = async (value: string, selected: string[] = []) => {
		await act(async () =>
			root.render(
				<Suggestion
					items={items}
					value={value}
					caret={value.length}
					trigger="/"
					filter={(item, query) => item.value.startsWith(query) && !selected.includes(item.value)}
					onSelect={onSelect}
				>
					{({ onKeyDown, inputProps }) => <input aria-label="输入" onKeyDown={onKeyDown} {...inputProps} />}
				</Suggestion>,
			),
		);
	};
	const press = async (key: string) => {
		const input = container.querySelector("input");
		if (!input) throw new Error("输入框未挂载");
		await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
	};
	const highlighted = () => container.querySelector('[aria-selected="true"]')?.textContent;

	await render("/");
	await press("ArrowDown");
	await press("ArrowDown");
	expect(highlighted()).toBe("bravo");
	await render("/b");
	expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
	expect(highlighted()).toBe("beta");
	await press("ArrowDown");
	await press("Enter");
	expect(onSelect).toHaveBeenCalledWith("bravo", expect.objectContaining({ value: "bravo" }), {
		trigger: "/",
		query: "b",
		start: 0,
		end: 2,
	});

	await render("/bravo ", ["bravo"]);
	expect(container.querySelector('[role="listbox"]')).toBeNull();
	await render("/bravo /", ["bravo"]);
	expect(highlighted()).toBe("alpha");
	await press("Tab");
	expect(onSelect).toHaveBeenLastCalledWith("alpha", expect.objectContaining({ value: "alpha" }), {
		trigger: "/",
		query: "",
		start: 7,
		end: 8,
	});
});

// 技能资源刷新或业务过滤可在不改变输入的情况下缩减列表，读屏高亮和实际选择必须一致。
it("同一查询候选缩减后高亮有效项，Enter 选择该项", async () => {
	const onSelect = vi.fn();
	const render = async (names: string[]) => {
		await act(async () =>
			root.render(
				<Suggestion
					items={names.map((value) => ({ label: value, value }))}
					value="/"
					caret={1}
					trigger="/"
					onSelect={onSelect}
				>
					{({ onKeyDown, inputProps }) => <input aria-label="输入" onKeyDown={onKeyDown} {...inputProps} />}
				</Suggestion>,
			),
		);
	};
	const press = async (key: string) => {
		const input = container.querySelector("input");
		if (!input) throw new Error("输入框未挂载");
		await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
	};

	await render(["alpha", "beta", "bravo"]);
	await press("ArrowDown");
	await press("ArrowDown");
	expect(container.querySelector('[aria-selected="true"]')?.textContent).toBe("bravo");
	await render(["alpha", "beta"]);
	const highlighted = container.querySelector('[aria-selected="true"]');
	expect(highlighted?.textContent).toBe("beta");
	expect(container.querySelector("input")?.getAttribute("aria-activedescendant")).toBe(highlighted?.id);
	await press("Enter");
	expect(onSelect).toHaveBeenCalledOnce();
	expect(onSelect).toHaveBeenCalledWith("beta", expect.objectContaining({ value: "beta" }), {
		trigger: "/",
		query: "",
		start: 0,
		end: 1,
	});
});
