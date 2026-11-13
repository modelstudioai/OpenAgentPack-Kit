"use client";

import { useState } from "react";
import { Desktop, Smartphone } from "./icons.tsx";
import { PhoneFrame } from "./phone-frame.tsx";
import { PreviewViewport } from "./preview-viewport.tsx";
import { TerminalCard, type TerminalLine } from "./terminal-card.tsx";

const QUICKSTART: TerminalLine[] = [
	{ cmd: "pnpm install", comment: "monorepo：pnpm 10 + Turborepo" },
	{ cmd: "pnpm dev", comment: "server :8787 + web :5173 + console :5174" },
	{ cmd: "pnpm kit:create my-experience", comment: "从模板生成可跑仓库" },
	{ cmd: "pnpm kit:add chat", comment: "copy-in：组件源码进你的项目" },
];

/**
 * 落地页右侧的「活卡片」（对应 reactbits hero 右边的可交互代码卡）：
 * 两个 tab —— 真实 Chat 组件预览 / quickstart 终端；底部变体行走设备切换。
 * 预览里的 kit-chat-ui 跟随站点主题（data-kit-theme）。
 */
export function HeroShowcase() {
	const [tab, setTab] = useState<"chat" | "quickstart">("chat");
	const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

	return (
		<div className="kit-showcase">
			<div className="kit-showcase-tabs" role="tablist" aria-label="落地页示例">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "chat"}
					data-active={tab === "chat" || undefined}
					onClick={() => setTab("chat")}
				>
					Chat 预览
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "quickstart"}
					data-active={tab === "quickstart" || undefined}
					onClick={() => setTab("quickstart")}
				>
					quickstart
				</button>
				<span className="kit-showcase-hint">真实组件 · 非截图</span>
			</div>
			<div className="kit-showcase-body">
				{tab === "chat" ? (
					<PhoneFrame device={device}>
						<PreviewViewport name="chat" title="Chat 交互预览" device={device} />
					</PhoneFrame>
				) : (
					<TerminalCard title="bash — quickstart" lines={QUICKSTART} />
				)}
			</div>
			<div className="kit-showcase-foot">
				{tab === "chat" ? (
					<span className="kit-seg">
						<button
							type="button"
							data-active={device === "desktop"}
							aria-pressed={device === "desktop"}
							onClick={() => setDevice("desktop")}
						>
							<Desktop />
							桌面
						</button>
						<button
							type="button"
							data-active={device === "mobile"}
							aria-pressed={device === "mobile"}
							onClick={() => setDevice("mobile")}
						>
							<Smartphone />
							手机
						</button>
					</span>
				) : (
					<span className="kit-showcase-foot-hint">复制即可运行；server 凭据不出服务端</span>
				)}
				<span className="kit-showcase-foot-hint">@openagentpack/kit-chat-ui</span>
			</div>
		</div>
	);
}
