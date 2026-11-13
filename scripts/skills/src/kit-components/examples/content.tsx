import {
	Actions,
	ActionsCopy,
	ActionsFeedback,
	type ActionsFeedbackValue,
	ArtifactCard,
	AttachmentFileCard,
	type AttachmentItem,
	Attachments,
	CodeHighlighter,
	FileCard,
	Markdown,
	Mermaid,
	Message,
	MessageList,
	ReasoningBlock,
	SenderHeader,
	ToolCallCard,
} from "@openagentpack/kit-chat-ui";
import type { ChatMessage, MessagePart } from "@openagentpack/kit-sdk/messages";
import { useState } from "react";

export interface ContentExamplesProps {
	messages: ChatMessage[];
	tool: Extract<MessagePart, { type: "tool" }>;
	attachment: AttachmentItem;
	onDownload: (fileId: string) => void;
	onCopy: (text: string) => Promise<void>;
}

// Render the message list inside a host with a bounded height.
export function ContentExamples({ messages, tool, attachment, onDownload, onCopy }: ContentExamplesProps) {
	const [feedback, setFeedback] = useState<ActionsFeedbackValue>("default");
	const message = messages[0];
	return (
		<div className="flex flex-col gap-3" data-kit-appearance="workspace">
			{message ? (
				<Message variant="workspace" message={message} onArtifactDownload={onDownload} onCopy={onCopy} />
			) : null}
			<div className="flex h-full min-h-0 flex-col">
				<MessageList
					variant="workspace"
					messages={messages}
					autoScroll={false}
					onArtifactDownload={onDownload}
					onCopy={onCopy}
					empty={<p>No messages yet.</p>}
				/>
			</div>
			<ReasoningBlock text="Compare the available evidence before answering." status="done" />
			<ToolCallCard part={tool} />
			<ArtifactCard
				filename="report.pdf"
				contentType="application/pdf"
				onDownload={() => onDownload("output-report")}
			/>
			<FileCard name="notes.txt" onDownload={() => onDownload("notes")} />
			<Markdown>
				{
					"## Result\n\nA **sanitized** Markdown response with a table:\n\n| Item | Status |\n| --- | --- |\n| Report | Ready |"
				}
			</Markdown>
			<CodeHighlighter lang="typescript" header="Example code" showLineNumbers>
				{'const status: string = "ready";'}
			</CodeHighlighter>
			<Mermaid header="Request flow" defaultRenderType="image">
				{"flowchart LR\n  User --> Backend\n  Backend --> Agent"}
			</Mermaid>
			<Actions
				aria-label="Response actions"
				items={[{ key: "download", label: "Download report", onItemClick: () => onDownload("output-report") }]}
			>
				<Actions.Copy text="The report is ready." onCopy={onCopy} label="Copy answer" />
				<Actions.Feedback value={feedback} onChange={setFeedback} />
			</Actions>
			{/* Equivalent named exports are supported for selective imports. */}
			<ActionsCopy text="A second excerpt." onCopy={onCopy} label="Copy excerpt" />
			<ActionsFeedback value={feedback} onChange={setFeedback} />
			<SenderHeader title="Prepared files" open closable={false}>
				<Attachments.FileCard item={attachment} />
				<AttachmentFileCard item={attachment} />
			</SenderHeader>
			<p role="status">Local feedback: {feedback}. Persistence belongs to the caller.</p>
		</div>
	);
}
