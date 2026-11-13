"use client";

import { Tooltip } from "@openagentpack/kit-chat-ui";
import { useState } from "react";
import { CONTROL_CLASS, TOOLBAR_CLASS } from "./general-demo.tsx";

/** 四个方位：悬停或键盘聚焦显示；气泡贴边时夹回视口，保持所选方位不翻转。 */
export function TooltipDemo() {
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="flex flex-1 flex-wrap items-center justify-center gap-3 p-4">
				<Tooltip content="出现在触发器上方" side="top">
					<button type="button" className={CONTROL_CLASS}>
						上方
					</button>
				</Tooltip>
				<Tooltip content="出现在触发器下方" side="bottom">
					<button type="button" className={CONTROL_CLASS}>
						下方
					</button>
				</Tooltip>
				<Tooltip content="出现在触发器左侧" side="left">
					<button type="button" className={CONTROL_CLASS}>
						左侧
					</button>
				</Tooltip>
				<Tooltip content="出现在触发器右侧" side="right">
					<button type="button" className={CONTROL_CLASS}>
						右侧
					</button>
				</Tooltip>
			</div>
			<p className="px-4 pb-3 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				悬停或键盘聚焦显示；页面滚动或窗口缩放时气泡立即收起。
			</p>
		</div>
	);
}

/** 会话列表同款：truncate 收敛到 Tooltip 触发器上，未溢出的标题不出提示。 */
const OVERFLOW_ROWS = [
	{ id: "long", title: "百炼托管 Agent 工作台：调研数据整理与周报生成" },
	{ id: "short", title: "新会话" },
];

export function TooltipOverflowDemo() {
	const [overflowOnly, setOverflowOnly] = useState(true);
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={overflowOnly} onChange={(event) => setOverflowOnly(event.target.checked)} />
					仅溢出时提示（overflowOnly）
				</label>
			</div>
			<div className="mx-auto w-60 py-3">
				{OVERFLOW_ROWS.map((row) => (
					<button
						key={row.id}
						type="button"
						className="flex w-full items-center rounded-[var(--kit-radius-sm)] px-2 py-1.5 text-start hover:bg-[var(--kit-bg-subtle)]"
					>
						<Tooltip className="block truncate" content={row.title} overflowOnly={overflowOnly}>
							{row.title}
						</Tooltip>
					</button>
				))}
			</div>
			<p className="px-4 pb-3 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				长标题悬停看完整内容；关闭开关后未溢出的「新会话」也会出提示。
			</p>
		</div>
	);
}

/** 锚点栏同款：side="left" 的富内容气泡（标题 + 摘要）；气泡可悬停进入并在内部滚动。 */
const RAIL_ITEMS = [
	{ label: "梳理核心结论", summary: "会话量环比增长 12%，工具失败率 0.8%" },
	{ label: "起草跟进邮件", summary: "收件人与抄送留空待填" },
];

const SCROLL_LINES = Array.from(
	{ length: 12 },
	(_, index) => `气泡第 ${index + 1} 行：内容超过最大高度时在气泡内滚动，指针移入气泡可持续阅读。`,
);

export function TooltipRichDemo() {
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col bg-[var(--kit-bg)] text-[var(--kit-fg)]"
		>
			<div className="flex flex-1 items-center justify-end gap-6 p-4">
				<div className="flex flex-col items-center gap-3 py-3">
					{RAIL_ITEMS.map((item, index) => (
						<Tooltip
							key={item.label}
							side="left"
							className="group pointer-events-auto relative block w-full shrink cursor-pointer"
							content={
								<span className="block">
									<span className="block font-medium">{item.label}</span>
									<span className="mt-1 block text-[var(--kit-fg-muted)]">{item.summary}</span>
								</span>
							}
						>
							<span
								aria-hidden
								className={`block size-2.5 rounded-full ${index === 0 ? "bg-[var(--kit-accent)]" : "bg-[var(--kit-border)]"}`}
							/>
						</Tooltip>
					))}
				</div>
				<Tooltip
					content={
						<span className="block">
							{SCROLL_LINES.map((line) => (
								<span key={line} className="block">
									{line}
								</span>
							))}
						</span>
					}
				>
					<button type="button" className={CONTROL_CLASS}>
						长内容气泡（可在气泡内滚动）
					</button>
				</Tooltip>
			</div>
			<p className="px-4 pb-3 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
				离开触发器后有小段宽限期，指针移入气泡不收起；气泡内容超过最大高度时在气泡内滚动。
			</p>
		</div>
	);
}
