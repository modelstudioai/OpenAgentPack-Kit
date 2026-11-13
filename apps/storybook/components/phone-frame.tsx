"use client";

import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { Battery, SignalBars, Wifi } from "./icons.tsx";

/**
 * 仿真手机壳：金属中框 + 侧键 + 黑色 bezel + 灵动岛 + 状态栏 + Home 指示条 + 屏幕眩光。
 * - 状态栏/指示条颜色走 kit-chat-ui 的 `--kit-fg`，随预览主题（data-kit-theme）自适应；
 * - 内容区留出安全区（上 48 / 下 26），与 kit 的 H5 安全区叙事一致；
 * - 全部是装饰层：aria-hidden + pointer-events none，不挡预览交互；
 * - desktop 设备就是原来的裸 frame，不加壳。
 */
export function PhoneFrame({ device, children }: { device: "desktop" | "mobile"; children: ReactNode }) {
	const { resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const kitTheme = mounted && resolvedTheme === "dark" ? "dark" : undefined;

	const mobile = device === "mobile";
	// 保持内容节点的父级与位置稳定：切换设备时保留 iframe、草稿与待确认操作。
	return (
		<div className={mobile ? "kit-phone" : "kit-desktop-frame"}>
			{mobile && (
				<>
					<span className="kit-phone-btn" data-btn="mute" aria-hidden="true" />
					<span className="kit-phone-btn" data-btn="vol-up" aria-hidden="true" />
					<span className="kit-phone-btn" data-btn="vol-down" aria-hidden="true" />
					<span className="kit-phone-btn" data-btn="power" aria-hidden="true" />
				</>
			)}
			<div className="kit-preview-frame" data-device={device} data-kit-theme={kitTheme}>
				{mobile && (
					<>
						<div className="kit-phone-status" aria-hidden="true">
							<span className="kit-phone-time">9:41</span>
							<span className="kit-phone-status-icons">
								<SignalBars />
								<Wifi />
								<Battery />
							</span>
						</div>
						<span className="kit-phone-island" aria-hidden="true" />
					</>
				)}
				<div className={mobile ? "kit-phone-content" : "kit-preview-content"}>{children}</div>
				{mobile && (
					<>
						<span className="kit-phone-home" aria-hidden="true" />
						<span className="kit-phone-glare" aria-hidden="true" />
					</>
				)}
			</div>
		</div>
	);
}
