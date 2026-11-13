import { ArrowRight } from "./icons.tsx";

const ITEMS = [
	"kit-sdk/protocol",
	"SSE 帧 + after 游标",
	"event_id 去重",
	"kit-sdk",
	"turn / thread / artifact 归并",
	"React adapter",
	"useChat / useSessions",
	"kit-chat-ui",
	"copy-in registry",
	"kit-server",
	"plan → 确认 → apply 闸门",
	"openapi ↔ 文档双向校验",
	"scripts/kit",
	"pnpm kit:create / kit:add / catalog:list",
	"app-local host capabilities",
	"Web / H5 自适应",
];

/**
 * 跑马灯词条条（reactbits 式签名动效）：纯 CSS 平移（track 宽 = 两份副本，translateX(-50%) 无缝），
 * hover 暂停，reduced-motion 下静止；第二份副本 aria-hidden，屏幕阅读器只读一份。
 */
export function Marquee() {
	const row = (hidden: boolean) => (
		<div className="kit-marquee-row" aria-hidden={hidden || undefined}>
			{ITEMS.map((item) => (
				<span key={item} className="kit-marquee-item">
					{item}
					<ArrowRight />
				</span>
			))}
		</div>
	);
	return (
		<div className="kit-marquee">
			<div className="kit-marquee-track">
				{row(false)}
				{row(true)}
			</div>
		</div>
	);
}
