import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageListSkeleton } from "./index.tsx";

describe("会话加载骨架屏", () => {
	// 骨架没有可见文案：加载状态必须经 role/aria-label 进入辅助技术，不能只靠视觉占位。
	it("保留状态语义", () => {
		const html = renderToStaticMarkup(<MessageListSkeleton />);
		expect(html).toContain('role="status"');
		expect(html).toContain('aria-label="加载会话中…"');
	});
});
