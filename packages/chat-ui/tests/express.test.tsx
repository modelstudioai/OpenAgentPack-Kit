import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttachmentFileCard, type AttachmentItem, Attachments } from "../src/components/attachments/index.tsx";
import { Sender } from "../src/components/sender/index.tsx";
import { activeTriggerQuery, Suggestion } from "../src/components/suggestion/index.tsx";

describe("输入框", () => {
	// 生成中必须能停止，且不能再提交；禁用时连输入都不可用。
	it("生成中显示停止按钮，禁用时输入框不可编辑", () => {
		const running = renderToStaticMarkup(<Sender value="继续" loading disabled />);
		expect(running).toContain(">停止</button>");
		expect(running).not.toContain(">发送</button>");
		expect(running).toMatch(/<div[^>]*contentEditable="false"/);
		expect(running).not.toMatch(/<button[^>]*disabled=""/);
		const idle = renderToStaticMarkup(<Sender value="已有草稿" disabled />);
		expect(idle).toMatch(/<div[^>]*contentEditable="false"/);
		expect(idle).toMatch(/<button[^>]*disabled=""[^>]*>发送<\/button>/);
	});

	it("头部面板只在展开时渲染", () => {
		const header = (open: boolean) => (
			<Sender.Header title="附件" open={open}>
				暂存区
			</Sender.Header>
		);
		expect(renderToStaticMarkup(<Sender header={header(true)} />)).toContain("暂存区");
		expect(renderToStaticMarkup(<Sender header={header(false)} />)).not.toContain("暂存区");
	});
});

describe("附件", () => {
	const items: [AttachmentItem, AttachmentItem] = [
		{ uid: "a", name: "报告.pdf", size: 2048, status: "done" as const },
		{ uid: "b", name: "图片.png", status: "uploading" as const, percent: 40 },
	];

	// 上传中没有可撤销的请求，移除入口只给已完成的文件；没有选择回调、数量上限与禁用都要收起添加入口。
	it("只有已完成的文件可移除，不可选择时不再提供添加入口", () => {
		const select = () => {};
		const html = renderToStaticMarkup(<Attachments items={items} onSelectFiles={select} onRemove={() => {}} />);
		expect(html).toContain('aria-label="移除 报告.pdf"');
		expect(html).not.toContain('aria-label="移除 图片.png"');
		expect(html).toContain("上传中 40%");
		expect(html).toContain('aria-label="添加文件"');
		expect(renderToStaticMarkup(<Attachments items={items} />)).not.toContain("添加文件");
		expect(renderToStaticMarkup(<Attachments items={items} onSelectFiles={select} maxCount={2} />)).not.toContain(
			"添加文件",
		);
		const disabled = renderToStaticMarkup(
			<Attachments items={items} onSelectFiles={select} onRemove={() => {}} disabled />,
		);
		expect(disabled).not.toContain("添加文件");
		expect(disabled).not.toContain("移除");
	});

	it("没有文件时显示上传占位", () => {
		expect(renderToStaticMarkup(<Attachments />)).toContain("上传文件");
	});

	// 独立使用时仍遵守移除闸门，不依赖列表为它过滤回调。
	it("独立卡片仅在可移除时提供入口", () => {
		const item = items[0];
		const remove = () => {};
		const card = renderToStaticMarkup(<Attachments.FileCard item={item} onRemove={remove} />);
		expect(card).toContain('aria-label="移除 报告.pdf"');
		expect(renderToStaticMarkup(<AttachmentFileCard item={item} onRemove={remove} disabled />)).not.toContain("移除");
		expect(
			renderToStaticMarkup(<Attachments.FileCard item={{ ...item, status: "uploading" }} onRemove={remove} />),
		).not.toContain("移除");
		expect(renderToStaticMarkup(<AttachmentFileCard item={item} />)).not.toContain("移除");
	});

	// 消费方将服务端状态写回卡片后，用户需要看到文件身份、上传进度和失败原因。
	it("独立卡片展示文件信息与上传状态", () => {
		const item = items[0];
		const ready = renderToStaticMarkup(<Attachments.FileCard item={item} className="custom-card" />);
		expect(ready).toContain('title="报告.pdf"');
		expect(ready).toContain(">PDF</span>");
		// 卡片不展示尺寸；文件身份由名称与徽标承载。
		expect(ready).not.toContain("2.0 KB");
		expect(ready).toContain("custom-card");
		const uploading = renderToStaticMarkup(<Attachments.FileCard item={items[1]} />);
		expect(uploading).toContain("上传中 40%");
		expect(uploading).toMatch(/<progress[^>]*aria-label="图片.png 上传进度"[^>]*value="40"/);
		expect(renderToStaticMarkup(<Attachments.FileCard item={{ ...item, status: "error" }} />)).toContain("上传失败");
		const described = renderToStaticMarkup(
			<Attachments.FileCard
				item={{ ...item, status: "error", description: "文件超出限制", thumbUrl: "/preview.png" }}
			/>,
		);
		expect(described).toContain("文件超出限制");
		expect(described).toMatch(/<img[^>]*src="\/preview.png"/);
	});
});

describe("activeTriggerQuery", () => {
	it("光标后的未完查询被识别，边界 / 激活候选", () => {
		expect(activeTriggerQuery("先 /anim", 7, "/")).toEqual({ start: 2, query: "anim" });
		expect(activeTriggerQuery("/an", 3, "/")).toEqual({ start: 0, query: "an" });
		expect(activeTriggerQuery("说 /", 3, "/")).toEqual({ start: 2, query: "" });
	});

	it("词中 / 与空白分隔后不再激活", () => {
		expect(activeTriggerQuery("asd/anim", 8, "/")).toBeNull();
		expect(activeTriggerQuery("/anim 好", 7, "/")).toBeNull();
		expect(activeTriggerQuery("没有标记", 4, "/")).toBeNull();
	});
});

describe("快捷指令", () => {
	const items = [
		{ label: "了解", value: "learn", children: [{ label: "什么是 Agent", value: "what" }] },
		{ label: "写周报", value: "report" },
	];

	it("未触发时只渲染输入框", () => {
		const html = renderToStaticMarkup(<Suggestion items={items}>{() => <input aria-label="输入" />}</Suggestion>);
		expect(html).toContain('aria-label="输入"');
		expect(html).not.toContain('role="listbox"');
	});

	// 打开时默认高亮第一项；高亮项有子项时同时展开下一列，键盘右移即可进入。
	it("打开后高亮第一项并展开它的子项", () => {
		const html = renderToStaticMarkup(
			<Suggestion items={items} open>
				{() => <input aria-label="输入" />}
			</Suggestion>,
		);
		expect(html.match(/role="listbox"/g)).toHaveLength(2);
		expect(html).toMatch(/aria-selected="true"[^>]*>.*?了解/);
		expect(html).toContain("什么是 Agent");
	});

	// 自动触发：value + caret 命中 "/" 查询即展开，不需要调用方手动 onTrigger。
	it("value/caret 命中 / 查询时自动展开并过滤", () => {
		const html = renderToStaticMarkup(
			<Suggestion items={items} value="/rep" caret={4} trigger="/" block>
				{() => <input aria-label="输入" />}
			</Suggestion>,
		);
		expect(html).toContain('role="listbox"');
		expect(html).toContain("写周报");
		expect(html).not.toContain("了解");
	});

	it("词中 / 或查询已用空白结束时保持关闭", () => {
		const inWord = renderToStaticMarkup(
			<Suggestion items={items} value="asd/rep" caret={7} trigger="/">
				{() => <input aria-label="输入" />}
			</Suggestion>,
		);
		expect(inWord).not.toContain('role="listbox"');
		const ended = renderToStaticMarkup(
			<Suggestion items={items} value="/report " caret={8} trigger="/">
				{() => <input aria-label="输入" />}
			</Suggestion>,
		);
		expect(ended).not.toContain('role="listbox"');
	});

	// 业务 filter 可在空查询时排除已插入项；description 与关键词同样参与展示/匹配。
	it("自定义 filter 在空查询下仍生效，并渲染描述", () => {
		const html = renderToStaticMarkup(
			<Suggestion
				items={[
					{ label: "animate", value: "animate", description: "顺滑过渡动画" },
					{ label: "frontend-design", value: "frontend-design", description: "前端视觉设计" },
				]}
				value="/"
				caret={1}
				trigger="/"
				filter={(item, query) => item.value !== "animate" && item.value.toLowerCase().startsWith(query.toLowerCase())}
			>
				{() => <input aria-label="输入" />}
			</Suggestion>,
		);
		expect(html).not.toContain("animate");
		expect(html).toContain("frontend-design");
		expect(html).toContain("前端视觉设计");
	});

	it("默认过滤匹配 keywords", () => {
		const html = renderToStaticMarkup(
			<Suggestion
				items={[{ label: "写周报", value: "report", keywords: ["weekly", "summary"] }]}
				value="/week"
				caret={5}
				trigger="/"
			>
				{() => <input aria-label="输入" />}
			</Suggestion>,
		);
		expect(html).toContain("写周报");
	});
});
