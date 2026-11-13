"use client";

import { EmptyState, Prompts, type PromptsItem, type PromptsProps } from "@openagentpack/kit-chat-ui";
import { useState } from "react";
import { CONTROL_CLASS, TOOLBAR_CLASS } from "./general-demo.tsx";

/** 开场示例问题：体验页 suggested_prompts 同形态（纯文本，key = label）。 */
const SUGGESTED = [
	"总结这份周报的要点",
	"把这段会议记录整理成行动清单",
	"对比两家云厂商的 GPU 定价",
	"解释一下 SSE 断流重连的原理",
];

const IDEAS: PromptsItem[] = [
	{ key: "ideas", icon: "💡", label: "激发创意", description: "下个季度的活动可以策划些什么？" },
	{ key: "concept", icon: "📘", label: "了解概念", description: "托管 Agent 和普通对话有什么区别？" },
	{ key: "efficiency", icon: "🚀", label: "提升效率", description: "怎样让 Agent 帮我整理周报？" },
	{ key: "relax", icon: "😄", label: "轻松一下", description: "讲个程序员才懂的笑话" },
	{ key: "troubleshoot", icon: "🛠️", label: "排查问题", description: "部署失败时先看哪些日志？" },
];

const LAYOUTS: Record<string, { label: string; props: Partial<PromptsProps> }> = {
	scroll: { label: "横向滚动（默认）", props: {} },
	vertical: { label: "纵向 vertical", props: { vertical: true } },
	wrap: { label: "换行 wrap", props: { wrap: true } },
	grid: { label: "两列（wrap + classNames）", props: { wrap: true, classNames: { item: "basis-[calc(50%-4px)]" } } },
};

const MOTIONS: Record<string, { label: string; props: Partial<PromptsProps> }> = {
	none: { label: "无", props: {} },
	fadeIn: { label: "fadeIn", props: { fadeIn: true } },
	fadeInLeft: { label: "fadeInLeft", props: { fadeInLeft: true } },
};

/** 开场引导：Chat 空态同款组合（EmptyState + 去重 suggested_prompts），点击回显发送文本；配额超限时整体禁用。 */
export function PromptsDemo() {
	const [sent, setSent] = useState<string | null>(null);
	const [quotaExceeded, setQuotaExceeded] = useState(false);
	const items = [...new Set(SUGGESTED)].map((prompt) => ({ key: prompt, label: prompt, disabled: quotaExceeded }));
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={quotaExceeded} onChange={(event) => setQuotaExceeded(event.target.checked)} />
					模拟配额超限（全部禁用）
				</label>
				<span role="status">{sent ? `已发送：${sent}` : "尚未发送"}</span>
			</div>
			<div className="min-w-0 p-4">
				<EmptyState title="你好，我是数据助手" hint="选择下面任一示例，或直接输入你的问题" />
				<Prompts
					className="mt-4 w-full"
					wrap
					items={items}
					onItemClick={({ data }) => setSent(data.key)}
					classNames={{ list: "justify-center" }}
				/>
			</div>
		</div>
	);
}

/** 布局与渐入：同一组条目切换排列方式与入场动效；重播重新挂载观察逐项错峰。 */
export function PromptsLayoutDemo() {
	const [layout, setLayout] = useState("scroll");
	const [motion, setMotion] = useState("none");
	const [round, setRound] = useState(0);
	const [note, setNote] = useState("尚未点击");
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					布局
					<select className={CONTROL_CLASS} value={layout} onChange={(event) => setLayout(event.target.value)}>
						{Object.entries(LAYOUTS).map(([value, option]) => (
							<option key={value} value={value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-2">
					渐入
					<select
						className={CONTROL_CLASS}
						value={motion}
						onChange={(event) => {
							setMotion(event.target.value);
							setRound((value) => value + 1);
						}}
					>
						{Object.entries(MOTIONS).map(([value, option]) => (
							<option key={value} value={value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<button type="button" className={CONTROL_CLASS} onClick={() => setRound((value) => value + 1)}>
					重播
				</button>
				<span role="status">{note}</span>
			</div>
			<div className="min-w-0 p-4">
				<Prompts
					key={round}
					title="✨ 灵感与常见问题"
					items={IDEAS}
					onItemClick={({ data }) => setNote(`onItemClick → key = ${data.key}`)}
					{...LAYOUTS[layout]?.props}
					{...MOTIONS[motion]?.props}
				/>
			</div>
		</div>
	);
}

/** 分组入口：children 渲染为分组卡片，只有子项可点击；父项禁用时整组不可用。 */
export function PromptsNestDemo() {
	const [opsDisabled, setOpsDisabled] = useState(true);
	const [note, setNote] = useState("尚未点击");
	const items: PromptsItem[] = [
		{
			key: "hot",
			icon: "🔥",
			label: "热门话题",
			description: "大家都在问",
			children: [
				{ key: "hot-1", description: "托管 Agent 能做什么？" },
				{ key: "hot-2", description: "怎样给 Agent 配置工具？" },
				{ key: "hot-3", description: "会话历史保存在哪里？" },
			],
		},
		{
			key: "guide",
			icon: "🧭",
			label: "新手上路",
			description: "三步完成第一个体验页",
			children: [
				{ key: "guide-1", icon: "①", label: "声明 Agent", description: "在 agents.yaml 里写模型与工具" },
				{ key: "guide-2", icon: "②", label: "发布并上架", description: "plan 确认后 apply、publish" },
				{ key: "guide-3", icon: "③", label: "嵌入体验页", description: "复制嵌入代码到你的站点" },
			],
		},
		{
			key: "ops",
			icon: "🛡️",
			label: "运维操作",
			description: "需要管理员权限",
			disabled: opsDisabled,
			children: [
				{ key: "ops-1", description: "归档不再使用的会话" },
				{ key: "ops-2", description: "下架某个 Agent", disabled: true },
			],
		},
	];
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className={TOOLBAR_CLASS}>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={opsDisabled} onChange={(event) => setOpsDisabled(event.target.checked)} />
					禁用「运维操作」分组
				</label>
				<span role="status">{note}</span>
			</div>
			<div className="min-w-0 p-4">
				<Prompts
					title="你想了解什么？"
					items={items}
					wrap
					classNames={{ item: "grow basis-56" }}
					onItemClick={({ data }) => setNote(`onItemClick → key = ${data.key}`)}
				/>
			</div>
		</div>
	);
}
