import type { PlazaCategory } from "@openagentpack/kit-sdk/protocol";
import type { KeyboardEvent } from "react";

export type PlazaTabId = PlazaCategory | "featured";

function moveCategoryFocus(
	event: KeyboardEvent<HTMLDivElement>,
	tabs: { id: PlazaTabId }[],
	onChange: (next: PlazaTabId) => void,
) {
	const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
	// target 可能不是按钮本身（子节点/别的元素）：查不到返回 -1，由下方守卫兜住
	const current = buttons.indexOf(event.target as HTMLButtonElement);
	if (current < 0) return;
	let next: number;
	switch (event.key) {
		case "ArrowRight":
			next = (current + 1) % buttons.length;
			break;
		case "ArrowLeft":
			next = (current - 1 + buttons.length) % buttons.length;
			break;
		case "Home":
			next = 0;
			break;
		case "End":
			next = buttons.length - 1;
			break;
		default:
			return;
	}
	event.preventDefault();
	const button = buttons[next];
	const tab = tabs[next];
	if (!button || !tab) return;
	button.focus({ preventScroll: true });
	const listBounds = event.currentTarget.getBoundingClientRect();
	const tabBounds = button.getBoundingClientRect();
	// 只滚分类条，避免键盘切换牵动外层页面。
	event.currentTarget.scrollLeft +=
		Math.min(0, tabBounds.left - listBounds.left) + Math.max(0, tabBounds.right - listBounds.right);
	onChange(tab.id);
}

/** 广场分类 tab（「精选」+ 固定枚举分类）；方向键及 Home/End 切换，Tab 离开分类条。 */
export function CategoryTabs({
	categories,
	active,
	onChange,
}: {
	categories: { id: PlazaCategory; name: string; count: number }[];
	active: PlazaTabId;
	onChange: (next: PlazaTabId) => void;
}) {
	const tabs: { id: PlazaTabId; name: string }[] = [{ id: "featured", name: "精选" }, ...categories];
	return (
		<div
			role="tablist"
			aria-label="广场分类"
			onKeyDown={(event) => moveCategoryFocus(event, tabs, onChange)}
			className="flex min-w-0 gap-2 overflow-x-auto py-1"
		>
			{tabs.map((tab) => {
				const selected = tab.id === active;
				return (
					<button
						key={tab.id}
						type="button"
						role="tab"
						aria-selected={selected}
						tabIndex={selected || (!tabs.some((item) => item.id === active) && tab.id === "featured") ? 0 : -1}
						onClick={() => onChange(tab.id)}
						className={`min-h-10 shrink-0 whitespace-nowrap rounded-[var(--kit-radius-sm)] border px-4 py-2 text-[length:var(--kit-text-label)] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--kit-focus)] ${
							selected
								? "border-transparent bg-[var(--kit-nav-active)] font-medium text-[var(--kit-fg)]"
								: "border-transparent text-[var(--kit-fg-muted)] hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)]"
						}`}
					>
						{tab.name}
					</button>
				);
			})}
		</div>
	);
}
