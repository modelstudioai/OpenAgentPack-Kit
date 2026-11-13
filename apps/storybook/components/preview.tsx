"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { type ReactNode, useId, useState } from "react";
import type { ShowcaseName } from "../lib/showcase-names.ts";
import { Check, Copy, Desktop, FileCode, Smartphone } from "./icons.tsx";
import { PhoneFrame } from "./phone-frame.tsx";
import { PreviewViewport } from "./preview-viewport.tsx";

/**
 * 组件在线预览：设备切换（桌面 / 手机 390px）+ 源码查看 + copy-in 命令。
 * 预览渲染的是**真实的 kit-chat-ui 组件**（storybook 直接依赖 workspace 包），
 * 因此样式与行为和体验页一致——不是截图，也不是复刻。
 *
 * 交互细节（ui-ux-pro-max）：复制反馈有可见状态 + aria-live；设备切换是 segmented
 * 控件（选中态有底色，不靠颜色单一维度）；动效只动 opacity/transform/max-width。
 */
export function Preview({
	title,
	command,
	code,
	children,
	previewName,
}: {
	title: string;
	command?: string;
	code?: string;
	children?: ReactNode;
	previewName?: ShowcaseName;
}) {
	const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
	const [showCode, setShowCode] = useState(false);
	const codeId = useId();
	const [copied, setCopied] = useState<string | null>(null);

	const copy = async (text: string, key: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(key);
			setTimeout(() => setCopied(null), 1600);
		} catch {
			setCopied(null);
		}
	};

	return (
		<div className="kit-preview my-10">
			<div className="kit-preview-toolbar">
				<span className="kit-preview-dots" aria-hidden="true">
					<i />
					<i />
					<i />
				</span>
				<strong className="kit-preview-title">{title}</strong>
				<span className="kit-preview-actions">
					{command ? (
						<button
							type="button"
							className="kit-preview-button"
							data-copied={copied === "cmd" || undefined}
							onClick={() => void copy(command, "cmd")}
							title={command}
						>
							{copied === "cmd" ? <Check /> : <Copy />}
							<span aria-live="polite">{copied === "cmd" ? "已复制" : "复制接入命令"}</span>
						</button>
					) : null}
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
					{code ? (
						<button
							type="button"
							className="kit-preview-button"
							data-active={showCode}
							aria-expanded={showCode}
							aria-controls={codeId}
							onClick={() => setShowCode((v) => !v)}
						>
							<FileCode />
							源码
						</button>
					) : null}
				</span>
			</div>
			<div className="kit-preview-stage">
				<PhoneFrame device={device}>
					{previewName ? <PreviewViewport name={previewName} title={title} device={device} /> : children}
				</PhoneFrame>
			</div>
			{showCode && code ? (
				<div id={codeId} className="border-t border-fd-border bg-fd-background p-4">
					<DynamicCodeBlock
						lang="tsx"
						code={code}
						codeblock={{
							title: "示例代码 · TSX",
							"data-line-numbers": true,
							allowCopy: false,
							Actions: () => (
								<button
									type="button"
									className="kit-preview-button"
									aria-label="复制源码"
									aria-live="polite"
									onClick={() => void copy(code, "source")}
								>
									{copied === "source" ? "已复制" : "复制代码"}
								</button>
							),
							viewportProps: { "aria-label": "组件示例源码" },
						}}
					/>
				</div>
			) : null}
		</div>
	);
}
