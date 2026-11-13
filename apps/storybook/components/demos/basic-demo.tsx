"use client";

import { Menu, MenuContent, MenuItem, MenuTrigger } from "@openagentpack/kit-chat-ui";
import { useState } from "react";

const IMAGE_ICON = (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
		<rect x="3.5" y="5" width="17" height="14" rx="2" />
		<circle cx="9" cy="10" r="1.5" />
		<path d="m6 18 4.5-4.5a1.5 1.5 0 0 1 2 0L17 18" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

const VIDEO_ICON = (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
		<rect x="3" y="6" width="13" height="12" rx="2" />
		<path d="m16 10 4.5-2.5v9L16 14" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

const FILE_ICON = (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-4">
		<path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
		<path
			d="M7 3.5h7l5 5V19.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

const ELLIPSIS_ICON = (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-4">
		<circle cx="5" cy="12" r="1.5" />
		<circle cx="12" cy="12" r="1.5" />
		<circle cx="19" cy="12" r="1.5" />
	</svg>
);

const HOVER_ROW =
	"transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-bg-subtle)]";

/** 基本用法：输入框「附件」菜单形态——trigger 在组合器 prefix 的真实位置，onSelect 回传文件类型。 */
export function MenuDemo() {
	const [note, setNote] = useState("尚未选择；onSelect 回传文件类型给宿主选择器");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col justify-center gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
				{note}
			</p>
			<div className="flex min-w-0 flex-col rounded-[var(--kit-radius-composer)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-3 shadow-[var(--kit-shadow)]">
				<div className="px-1 pb-5 text-[length:var(--kit-text-body)] text-[var(--kit-fg-muted)]">
					输入消息，Enter 发送
				</div>
				<div className="flex items-center gap-2">
					<Menu>
						<MenuTrigger asChild>
							<button
								type="button"
								className={`inline-flex min-h-9 items-center gap-2 rounded-[var(--kit-radius-sm)] px-2.5 py-1.5 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)] ${HOVER_ROW} hover:text-[var(--kit-fg)]`}
							>
								{IMAGE_ICON}
								附件
							</button>
						</MenuTrigger>
						<MenuContent>
							<MenuItem onSelect={() => setNote("onSelect → image/*（打开图片选择器）")}>
								{IMAGE_ICON}
								上传图片
							</MenuItem>
							<MenuItem onSelect={() => setNote("onSelect → video/*（打开视频选择器）")}>
								{VIDEO_ICON}
								上传视频
							</MenuItem>
							<MenuItem onSelect={() => setNote("onSelect → 不限类型（打开文件选择器）")}>
								{FILE_ICON}
								上传文件
							</MenuItem>
						</MenuContent>
					</Menu>
					<span className="min-w-0 flex-1" />
					<span
						aria-hidden="true"
						className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--kit-accent)] text-[var(--kit-accent-fg)]"
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="size-4"
						>
							<path d="M12 19V5m-6 6 6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</span>
				</div>
			</div>
		</div>
	);
}

const MOCK_SESSIONS = [
	{ id: "s1", title: "季度经营分析", meta: "3 分钟前" },
	{ id: "s2", title: "团队周报整理", meta: "昨天" },
	{ id: "s3", title: "新品发布计划", meta: "3 天前" },
];

/** 行尾对齐与危险项：会话列表每行的「更多操作」菜单——align="end" 向左展开，删除项 danger 色。 */
export function MenuAlignDemo() {
	const [note, setNote] = useState("尚未选择；归档/删除是不可逆操作，业务侧先走确认弹窗");
	return (
		<div
			data-kit-appearance="workspace"
			className="flex min-w-0 flex-1 flex-col justify-center gap-4 bg-[var(--kit-bg)] p-6 text-[var(--kit-fg)]"
		>
			<p role="status" className="text-sm text-[var(--kit-fg-muted)]">
				{note}
			</p>
			<div className="overflow-hidden rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)]">
				{MOCK_SESSIONS.map((session) => (
					<div
						key={session.id}
						className={`flex min-w-0 items-center gap-3 border-b border-[var(--kit-border-subtle)] px-3 py-2.5 last:border-b-0 ${HOVER_ROW}`}
					>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[length:var(--kit-text-label)]">{session.title}</p>
							<p className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)]">{session.meta}</p>
						</div>
						<Menu>
							<MenuTrigger asChild>
								<button
									type="button"
									aria-label={`更多操作：${session.title}`}
									className="grid size-8 shrink-0 place-items-center rounded-[var(--kit-radius-sm)] text-[var(--kit-fg-muted)] hover:text-[var(--kit-fg)]"
								>
									{ELLIPSIS_ICON}
								</button>
							</MenuTrigger>
							<MenuContent align="end">
								<MenuItem onSelect={() => setNote(`${session.title} → 重命名（进 kit 受控行内编辑）`)}>重命名</MenuItem>
								<MenuItem onSelect={() => setNote(`${session.title} → 归档`)}>归档</MenuItem>
								<MenuItem
									className="text-[var(--kit-danger)]"
									onSelect={() => setNote(`${session.title} → 删除（先确认）`)}
								>
									删除
								</MenuItem>
							</MenuContent>
						</Menu>
					</div>
				))}
			</div>
		</div>
	);
}
