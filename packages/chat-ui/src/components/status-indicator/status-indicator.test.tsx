import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusIndicator } from "../chrome/index.ts";

describe("会话状态", () => {
	// 徽标不能仅靠颜色传达待审批状态，装饰圆点不应进入辅助技术读出的内容。
	it("徽标保留可读状态与状态播报语义", () => {
		const html = renderToStaticMarkup(
			<StatusIndicator variant="badge" connected turnRunning phase="requires_action" />,
		);
		expect(html).toContain('role="status"');
		expect(html).toContain("等待审批</span>");
		expect(html).toContain('aria-hidden="true"');
	});

	// 页头中的错误可被视觉截断，但完整原因必须保留在文本与悬停提示中。
	it("长错误保留完整的可访问文本和提示", () => {
		const message = "服务暂时不可用，请稍后重试。".repeat(30);
		const html = renderToStaticMarkup(
			<StatusIndicator variant="badge" connected={false} turnRunning={false} error={{ code: "offline", message }} />,
		);
		expect(html).toContain('role="status"');
		expect(html).toContain(`title="连接异常：${message}"`);
		expect(html).toContain(`连接异常：${message}</span>`);
	});

	// 纯文本形态用装饰点补状态标记：空闲不加点避免常驻圆点，活跃态呼吸点保持 aria-hidden。
	it("纯文本形态空闲无状态点，活跃态显示呼吸点", () => {
		const idle = renderToStaticMarkup(<StatusIndicator connected turnRunning={false} />);
		expect(idle).toContain("空闲");
		expect(idle).not.toContain('aria-hidden="true"');
		const running = renderToStaticMarkup(<StatusIndicator connected turnRunning />);
		expect(running).toContain("生成中…");
		expect(running).toContain('aria-hidden="true"');
		expect(running).toContain("motion-safe:animate-pulse");
	});

	// 重连期间保留恢复提示，其他连接错误优先；显式执行阶段不能被旧 turnRunning 覆盖。
	it.each(["default", "badge"] as const)("%s 保留错误、恢复和执行阶段的优先级", (variant) => {
		const error = { code: "offline", message: "网络暂不可用" };
		const reconnecting = renderToStaticMarkup(
			<StatusIndicator
				variant={variant}
				connected={false}
				turnRunning
				phase="failed"
				connection="reconnecting"
				error={error}
			/>,
		);
		expect(reconnecting).toContain("重连中…</span>");
		expect(reconnecting).not.toContain(error.message);
		const failed = renderToStaticMarkup(
			<StatusIndicator
				variant={variant}
				connected={false}
				turnRunning
				phase="running"
				connection="connecting"
				error={error}
			/>,
		);
		expect(failed).toContain(`连接异常：${error.message}</span>`);
		expect(failed).not.toContain("连接中…");
		const stopping = renderToStaticMarkup(<StatusIndicator variant={variant} connected turnRunning phase="stopping" />);
		expect(stopping).toContain("正在停止…</span>");
		expect(stopping).not.toContain("生成中…");
	});
});
