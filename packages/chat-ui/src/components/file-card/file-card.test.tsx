import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactCard, Message } from "../message/index.tsx";
import { FileCard } from "./index.tsx";

describe("文件卡片", () => {
	// 下载依赖宿主处理器；只读转写不能伪装成可下载状态。
	it("缺少回调只展示文件，Artifact适配不制造无效下载入口", () => {
		const html = renderToStaticMarkup(<FileCard name="报告.pdf" type="application/pdf" />);
		expect(html).toContain('title="报告.pdf"');
		expect(html).not.toContain("<button");
		expect(renderToStaticMarkup(<ArtifactCard filename="报告.pdf" />)).not.toContain("<button");
		expect(
			renderToStaticMarkup(
				<Message
					message={{
						id: "artifact-only",
						role: "assistant",
						status: "done",
						parts: [{ type: "artifact", artifact: { file_id: "report", filename: "报告.pdf" } }],
					}}
				/>,
			),
		).not.toContain("<button");
	});

	// 未知 MIME 不编造「文件」占位；类型词只认已知类型，其余交给徽标表达。
	it("已知类型展示类型词，未知或缺失类型不展示占位", () => {
		expect(renderToStaticMarkup(<FileCard name="demo" type="application/pdf" />)).toContain("PDF");
		expect(renderToStaticMarkup(<FileCard name="demo" type="audio/mpeg" />)).toContain("音频");
		expect(renderToStaticMarkup(<FileCard name="demo" type="text/csv" />)).toContain("表格");
		expect(renderToStaticMarkup(<FileCard name="demo.xyz" type="application/x-unknown" />)).not.toContain("文件");
		expect(renderToStaticMarkup(<FileCard name="demo.xyz" />)).not.toContain("文件");
	});

	// 预览与下载必须可分别触发，不能嵌套button；加载或禁用时两条入口均不可触发。
	it("预览与下载是并列操作，加载与禁用阻止激活", () => {
		const props = { name: "报告.pdf", onClick: () => {}, onDownload: () => {} };
		const html = renderToStaticMarkup(<FileCard {...props} />);
		expect(html).toContain('aria-label="打开 报告.pdf"');
		expect(html).toContain('aria-label="下载 报告.pdf"');
		expect(html.match(/<button/g)).toHaveLength(2);
		expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/s);
		for (const state of [{ disabled: true }, { loading: true }]) {
			const inactive = renderToStaticMarkup(<FileCard {...props} {...state} />);
			expect(inactive.match(/disabled=""/g)).toHaveLength(2);
		}
	});

	// 消息内产物卡的同款合同：宿主同时注入 onArtifactOpen 与 onArtifactDownload 时两条入口并列可达。
	it("消息产物卡在预览与下载回调齐备时渲染并列入口，只给下载时维持单入口", () => {
		const message: ChatMessage = {
			id: "artifact-card",
			role: "assistant",
			status: "done",
			parts: [{ type: "artifact", artifact: { file_id: "report", filename: "报告.pdf" } }],
		};
		const both = renderToStaticMarkup(
			<Message
				message={message}
				onArtifactOpen={(fileId) => {
					void fileId;
				}}
				onArtifactDownload={(fileId) => {
					void fileId;
				}}
			/>,
		);
		expect(both).toContain('aria-label="打开 报告.pdf"');
		expect(both).toContain('aria-label="下载 报告.pdf"');
		expect(both).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/s);
		const downloadOnly = renderToStaticMarkup(<Message message={message} onArtifactDownload={() => undefined} />);
		expect(downloadOnly).toContain('aria-label="下载 报告.pdf"');
		expect(downloadOnly).not.toContain('aria-label="打开');
	});
});
