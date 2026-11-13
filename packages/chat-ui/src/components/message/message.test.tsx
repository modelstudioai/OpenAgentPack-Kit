import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chat } from "../chat/index.tsx";
import { ThreadPanel } from "../chrome/index.ts";
import { MessageList, rowOffsets, windowSlice } from "../message-list/index.tsx";

describe("消息展示", () => {
	// 保护实际对话内容：内部拆分不能丢失分片、误解析用户文本或隐藏发送失败。
	it("保留用户原文、助手 Markdown、富内容与发送状态", () => {
		const messages: ChatMessage[] = [
			{
				id: "user-pending",
				role: "user",
				status: "pending",
				parts: [{ type: "text", text: "**原文** <script>示例</script>" }],
			},
			{
				id: "assistant-reply",
				role: "assistant",
				status: "done",
				parts: [
					{ type: "reasoning", text: "先查看" },
					{ type: "reasoning", text: "资料" },
					{ type: "tool", toolId: "search-1", name: "search", status: "done", input: "问题", output: "结果" },
					{ type: "artifact", artifact: { file_id: "report-1", filename: "报告.md", size: 12 } },
					{ type: "status", text: "整理完成" },
					{ type: "text", text: "**回答" },
					{ type: "text", text: "正文**" },
				],
			},
			{ id: "user-failed", role: "user", status: "failed", parts: [{ type: "text", text: "重试问题" }] },
		];
		const html = renderToStaticMarkup(<MessageList messages={messages} empty={<p>开始对话</p>} />);
		expect(html).toContain("**原文** &lt;script&gt;示例&lt;/script&gt;");
		expect(html).toMatch(/<strong\b[^>]*>回答正文<\/strong>/);
		for (const content of [
			"发送中…",
			"发送失败",
			"思考过程",
			"先查看资料",
			"search",
			"问题",
			"结果",
			"报告.md",
			"整理完成",
		])
			expect(html).toContain(content);
		expect(html).not.toContain("开始对话");
	});

	// 用户气泡附件与输入框附件同款展示；上传件不提供下载入口（本地已有原件），artifact 才有。
	it("用户消息附件渲染文件卡且无下载入口，附件在正文上方", () => {
		const messages: ChatMessage[] = [
			{
				id: "user-file",
				role: "user",
				status: "done",
				parts: [
					{ id: "att", type: "attachment", file: { file_id: "file-upload-1", filename: "lerna.json", size: 512 } },
					{ id: "body", type: "text", text: "这是什么文件" },
				],
			},
		];
		const html = renderToStaticMarkup(
			<MessageList messages={messages} onArtifactDownload={() => undefined} empty={<p>开始对话</p>} />,
		);
		const card = html.indexOf("lerna.json");
		const body = html.indexOf("这是什么文件");
		expect(card).toBeGreaterThan(-1);
		expect(body).toBeGreaterThan(card);
		expect(html).not.toContain("下载 lerna.json");
	});

	// workspace 用户消息分两块：附件卡先于用户气泡容器渲染（独立成块），default 仍在气泡内。
	it("workspace 用户消息附件与正文分两块展示", () => {
		const messages: ChatMessage[] = [
			{
				id: "user-file",
				role: "user",
				status: "pending",
				parts: [
					{ id: "att", type: "attachment", file: { file_id: "file-upload-1", filename: "lerna.json", size: 512 } },
					{ id: "body", type: "text", text: "这是什么文件" },
				],
			},
		];
		const workspace = renderToStaticMarkup(<MessageList variant="workspace" messages={messages} />);
		expect(workspace.indexOf("lerna.json")).toBeLessThan(workspace.indexOf("bg-[var(--kit-user-bubble)]"));
		expect(workspace).toContain("这是什么文件");
		expect(workspace).toContain("发送中…");
		const fallback = renderToStaticMarkup(<MessageList messages={messages} />);
		expect(fallback.indexOf("bg-[var(--kit-user-bubble)]")).toBeLessThan(fallback.indexOf("lerna.json"));
	});

	// 保护 Provider 内容块的顺序，不能把正文收集到所有工具/文件之后；未知值仅作为文本。
	it("保持交错分片顺序、结构化工具值和安全兜底，子线程复用相同富内容", () => {
		const message: ChatMessage = {
			id: "ordered",
			role: "assistant",
			status: "interrupted",
			parts: [
				{ id: "a", type: "text", text: "开始段落" },
				{
					id: "b",
					type: "tool",
					toolId: "call",
					name: "write_file",
					status: "done",
					input: { path: "/tmp/a" },
					output: false,
				},
				{ id: "c", type: "text", text: "工具之后" },
				{ id: "d", type: "artifact", artifact: { file_id: "file", filename: "结果.txt" } },
				{
					id: "e",
					type: "unknown",
					label: "vendor_block",
					value: { html: "<script>alert(1)</script>", url: "https://example.com/untrusted" },
				},
				{ id: "f", type: "reasoning", text: "最终检查", status: "interrupted" },
			],
		};
		for (const html of [
			renderToStaticMarkup(<MessageList messages={[message]} />),
			renderToStaticMarkup(<ThreadPanel threads={{ child: [message] }} />),
		]) {
			const positions = ["开始段落", "write_file", "工具之后", "结果.txt", "vendor_block", "最终检查"].map((text) =>
				html.indexOf(text),
			);
			expect(positions.every((position) => position >= 0)).toBe(true);
			expect(positions).toEqual([...positions].sort((a, b) => a - b));
			expect(html).toContain("/tmp/a");
			expect(html).toContain("false");
			expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
			expect(html).not.toContain("<script>");
			expect(html).not.toContain('href="https://example.com/untrusted"');
			expect(html).toContain("已中断");
		}
	});

	// 空会话走同一个列表入口，Chat 组合仍必须允许用户直接输入第一条消息。
	it("独立列表提供空态，完整对话在空态时保留输入框", () => {
		const empty = <p>开始对话</p>;
		expect(renderToStaticMarkup(<MessageList messages={[]} empty={empty} />)).toContain("开始对话");
		const html = renderToStaticMarkup(<Chat messages={[]} turnRunning={false} onSend={() => {}} empty={empty} />);
		expect(html).toContain("开始对话");
		expect(html).toContain('aria-label="消息输入"');
		expect(html).toContain(">发送</button>");
	});

	// 流式期间正文末尾常驻「生成中…」指示；最后一组执行保持展开，被正文终结的组收起，完成后全部收起。
	it("流式指示常驻，最后一组执行展开而已终结的组收起", () => {
		const tool = {
			id: "b",
			type: "tool",
			toolId: "call",
			name: "write_file",
			status: "done",
			input: {},
			output: "ok",
		} as const;
		const trailing: ChatMessage = {
			id: "streaming",
			role: "assistant",
			status: "streaming",
			parts: [{ id: "a", type: "text", text: "开始段落" }, tool, { id: "c", type: "text", text: "工具之后" }],
		};
		const ended = renderToStaticMarkup(<MessageList messages={[trailing]} />);
		expect(ended).toContain("生成中…");
		expect(ended).not.toMatch(/<details[^>]* open[^>]* aria-label="执行过程"/);
		const last: ChatMessage = { ...trailing, parts: [{ id: "a", type: "text", text: "开始段落" }, tool] };
		const openRun = renderToStaticMarkup(<MessageList messages={[last]} />);
		expect(openRun).toMatch(/<details[^>]* open[^>]* aria-label="执行过程"/);
		const done = renderToStaticMarkup(<MessageList messages={[{ ...last, status: "done" }]} />);
		expect(done).not.toContain("生成中…");
		expect(done).not.toMatch(/<details[^>]* open[^>]* aria-label="执行过程"/);
	});

	// 合并配额功能时，禁止编辑与暂停发送不能混为一谈；已有执行仍需要可取消。
	it("配额禁用默认输入框但保留停止，连接恢复只禁发送", () => {
		const blocked = renderToStaticMarkup(<Chat messages={[]} turnRunning composerDisabled />);
		expect(blocked).toMatch(/<div[^>]*contentEditable="false"/);
		expect(blocked).toMatch(/<button[^>]*>停止<\/button>/);
		expect(blocked).not.toMatch(/<button[^>]*disabled=""/);
		const reconnecting = renderToStaticMarkup(<Chat messages={[]} canSend={false} />);
		expect(reconnecting).not.toMatch(/<div[^>]*contentEditable="false"/);
		expect(reconnecting).toMatch(/<button[^>]*disabled=""[^>]*>发送<\/button>/);
	});

	// 仅由线程列表摘要发现的线程（无 thread_created 分片）在列表末尾补卡；分片到达后按 id 去重不双卡。
	it("线程列表专属子 Agent 末尾补卡并与分片卡去重", () => {
		const multiAgent: ChatMultiAgent = {
			selectedThreadId: null,
			loading: false,
			error: null,
			selectThread: () => undefined,
			refreshThreads: async () => undefined,
			loadThreadEvents: async () => undefined,
			threads: [
				{
					id: "sthr_shard",
					name: "研究员",
					status: "idle",
					messages: [],
					loading: false,
					error: null,
					nextPageToken: null,
					historyAvailable: true,
					loaded: true,
				},
				{
					id: "sthr_list",
					name: "数据分析",
					status: "idle",
					messages: [],
					loading: false,
					error: null,
					nextPageToken: null,
					historyAvailable: true,
					loaded: true,
				},
			],
		};
		const messages: ChatMessage[] = [
			{ id: "assistant-1", role: "assistant", status: "done", parts: [{ type: "sub-agent", threadId: "sthr_shard" }] },
		];
		const html = renderToStaticMarkup(<MessageList messages={messages} multiAgent={multiAgent} />);
		expect(html).toContain("以下子 Agent 来自线程列表");
		// 每个线程只出现一张卡：分片卡留在主流位置，列表专属卡在提示行之后补一张。
		expect(html.match(/<details\b/g)?.length).toBe(2);
		expect(html.split(">研究员</span>").length - 1).toBe(1);
		expect(html.split(">数据分析</span>").length - 1).toBe(1);
		expect(html.indexOf("以下子 Agent 来自线程列表")).toBeGreaterThan(html.indexOf("研究员"));
		const allSharded = renderToStaticMarkup(
			<MessageList messages={messages} multiAgent={{ ...multiAgent, threads: [multiAgent.threads[0]!] }} />,
		);
		expect(allSharded).not.toContain("以下子 Agent 来自线程列表");
		expect(allSharded.match(/<details\b/g)?.length).toBe(1);
		// 主历史为空但线程存在时不吞掉补卡，避免「完全不可见」在极端场景复现。
		const emptyHistory = renderToStaticMarkup(
			<MessageList messages={[]} multiAgent={multiAgent} empty={<p>开始对话</p>} />,
		);
		expect(emptyHistory).toContain("以下子 Agent 来自线程列表");
		expect(emptyHistory).toContain("数据分析");
	});
});

// 长会话分窗渲染（方案 A：数据层全量、仅 MessageList 渲染窗口）。
// 几何函数是窗口推导的唯一事实：前缀和错一行、二分差一行，阅读位置与锚点跳转都会漂移。
describe("长会话分窗渲染", () => {
	const makeMessages = (count: number): ChatMessage[] =>
		Array.from(
			{ length: count },
			(_, index): ChatMessage => ({
				id: `m${index}`,
				role: "user",
				status: "done",
				parts: [{ type: "text", text: `消息-${index}` }],
			}),
		);

	it("rowOffsets 按实测高度累积前缀和，未实测行用估算占位", () => {
		const messages = makeMessages(3);
		expect(
			rowOffsets(
				messages,
				new Map([
					["m0", 100],
					["m1", 50],
				]),
				10,
			),
		).toEqual([0, 110, 170, 340]);
		expect(rowOffsets([], new Map(), 10)).toEqual([0]);
	});

	it("windowSlice 覆盖视口并上下各扩 overscan，首尾夹取不越界", () => {
		const offsets = Array.from({ length: 101 }, (_, index) => index * 100);
		expect(windowSlice(offsets, 5000, 800)).toEqual({ start: 44, end: 64 });
		expect(windowSlice(offsets, 0, 1000)).toEqual({ start: 0, end: 16 });
		expect(windowSlice(offsets, 9900, 800)).toEqual({ start: 93, end: 100 });
		expect(windowSlice(offsets, 5000, 0)).toEqual({ start: 44, end: 56 });
	});

	// 阈值以下逐字节保持整体渲染；25 条启用分窗但初始窗夹取到顶，仍全部可见；
	// 120 条首帧只出末 60 条，顶部 spacer 用估算行高撑起未渲染区（会话从底部打开不跳位）。
	it("超过阈值只渲染末窗，阈值内与夹取后的初始窗全量可见", () => {
		const atThreshold = renderToStaticMarkup(<MessageList messages={makeMessages(24)} />);
		expect(atThreshold).toContain("消息-0");
		expect(atThreshold).toContain("消息-23");
		expect(atThreshold).not.toMatch(/aria-hidden="true" style="height:/);

		const justOver = renderToStaticMarkup(<MessageList messages={makeMessages(25)} />);
		expect(justOver).toContain("消息-0");
		expect(justOver).toContain("消息-24");
		expect(justOver).not.toMatch(/aria-hidden="true" style="height:/);

		const html = renderToStaticMarkup(<MessageList messages={makeMessages(120)} />);
		expect(html).not.toContain("消息-0");
		expect(html).not.toContain("消息-59");
		expect(html).toContain("消息-60");
		expect(html).toContain("消息-119");
		expect(html).toContain('style="height:9600px"');
	});

	// 宿主可用 virtualize=false 强制整体渲染（窄面板嵌入等特殊场景）。
	it("virtualize=false 关闭分窗，长列表回到整体渲染", () => {
		const html = renderToStaticMarkup(<MessageList messages={makeMessages(120)} virtualize={false} />);
		expect(html).not.toContain("data-kit-virtual-id");
		expect(html).toContain("消息-0");
		expect(html).toContain("消息-119");
		expect(html).not.toMatch(/aria-hidden="true" style="height:/);
	});
});

describe("用户气泡技能 chip 还原（ADR-0016）", () => {
	const tokenMessage: ChatMessage = {
		id: "u-token",
		role: "user",
		status: "done",
		parts: [{ id: "q", type: "text", text: "用 [使用 Skill:animate] 做转场，再 /frontend-design 审查" }],
	};

	it("已知技能 token 按原位穿插还原 chip；手打的未知 / 名保持原文", () => {
		const html = renderToStaticMarkup(<MessageList messages={[tokenMessage]} skills={["animate"]} />);
		expect(html).toContain("animate");
		expect(html).toContain("svg");
		expect(html).toContain("/frontend-design 审查");
		expect(html).not.toContain("[使用 Skill:animate]");
	});

	it("名单缺失或未知名 token 时整段按原文显示", () => {
		const plain = renderToStaticMarkup(<MessageList messages={[tokenMessage]} />);
		expect(plain).toContain("[使用 Skill:animate]");
		const unknown = renderToStaticMarkup(<MessageList messages={[tokenMessage]} skills={["frontend-design"]} />);
		expect(unknown).toContain("[使用 Skill:animate]");
	});
});
