import { CodeHighlighter, MessageList } from "@openagentpack/kit-chat-ui";
import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const messages: ChatMessage[] = [
	{
		id: "session-integration-answer",
		role: "assistant",
		status: "done",
		parts: [
			{
				id: "session-integration-prose",
				type: "text",
				text: `# 客户端会话接入建议

建议将事件接收、消息展示和用户操作分开处理。界面只展示已确认的状态，连接暂时中断时保留用户正在编辑的内容。

## 建立可靠的事件处理

先保存服务端返回的游标，再处理后续消息。恢复连接时使用同一个会话标识，避免将一次重连误认为新建会话。

- 事件接收层负责恢复与去重。
  - 历史回放和实时消息可能交叉到达。
  - 使用事件标识识别重复内容，不依赖显示顺序。
- 展示层保留正文、工具结果和文件的相对位置。

### 上线前的检查顺序

3. 验证断线后能够恢复接收。
4. 验证切换会话后不会显示旧连接迟到的内容。

- [x] 已确认复制保留原始换行。
- [ ] 待确认移动端长内容可以完整阅读。

> 连接恢复不等于本轮执行完成。请根据服务端的执行状态更新操作入口。

详细流程可查看[接入文档](https://example.com/session-guide)。存储键可以使用 \`session.cursor\`；较长的追踪标识也应完整保留：\`SESSION_STREAM_CURSOR_AFTER_${"abcdefghijklmnopqrstuvwxyz".repeat(6)}\`。

下面的类型用于在界面层保存会话游标：

\`\`\`typescript
type SessionState = {
  sessionId: string;
  cursor: string | null;
};
\`\`\`

类型只描述本地状态，发送和恢复仍通过公开客户端完成。`,
			},
		],
	},
];

const codeTitle = "TypeScript · 客户端会话游标存储与断线恢复示例 · 保留完整的工作区和会话命名空间";
const source = [
	"type SessionRecord = {",
	"  sessionId: string;",
	"  cursor: string | null;",
	"};",
	"",
	"export function cursorStorageKey(record: SessionRecord): string {",
	`\tconst prefix = "${"SESSION_RECOVERY_CURSOR_NAMESPACE_".repeat(5)}";`,
	'\treturn [prefix, record.sessionId, record.cursor ?? "initial"].join(":");',
	"}",
	"",
].join("\n");

/** 只通过公开组件展示正文与可复制源码，不加载 Provider 或请求外部链接。 */
createRoot(document.getElementById("root") as HTMLElement).render(
	<main className="flex min-h-full min-w-0 flex-col">
		<MessageList variant="workspace" messages={messages} autoScroll={false} />
		<section aria-label="带行号的代码示例" className="px-4 pb-6 md:px-6">
			<div className="mx-auto w-full min-w-0 max-w-[var(--kit-chat-width)]">
				<CodeHighlighter lang="typescript" header={codeTitle} showLineNumbers>
					{source}
				</CodeHighlighter>
			</div>
		</section>
	</main>,
);
