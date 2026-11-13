---
name: kit-components
description: "Build or update React chat interfaces with OpenAgentPack Kit components, including message rendering, input attachments, prompts, feedback, session navigation, and tool approval UI. Use for component selection and composition; backend protocol adaptation belongs to kit-chat-provider."
---

# Kit Components

Use the existing `@openagentpack/kit-chat-ui` public components to build the requested interface. The examples use package imports; a copy-in consumer should replace them with its local component imports.

## Select the smallest composition

- Complete conversation: `Chat` with `multiAgent={chat.multiAgent}` for main/child Agent views, or `MessageList` plus `Sender` when the input area needs custom behavior.
- Page frame: `Layout`, `AgentHeader`, `SessionList` or `SessionSidebar`, and the state helpers.
- Start a conversation: `Prompts`; choose whether selecting a prompt fills a draft or submits it.
- Compose input: `Sender`, `Sender.Header`, `Attachments`, and `Suggestion`.
- Render content: `Message`, `ReasoningBlock`, `ToolCallCard`, `ArtifactCard`, and `Markdown`.
- Feedback and review: `Actions`, `FileCard`, `CodeHighlighter`, `Mermaid`, and `ToolApprovalCard`.
- Discovery and usage: `CategoryTabs`, `PlazaCard`, `MeterBar`, and `ActivityHeatmap`.

Read [setup](references/setup.md) before integrating styles or copying component source. Read only the relevant section of [composition](references/composition.md) for behavior and ownership. The generated [API reference](references/api.md) covers every public runtime export, static subcomponent, and exported type. The generated [example reference](references/examples.md) contains the same code as the compilable examples below.

## Working rules

1. Feed components with `useChat` results and application callbacks. Core owns Stream, Request, Provider and Chat; React binds chat state to its lifetime. Components do not fetch, parse Bailian SSE, own credentials, or create sessions. `kit-chat-provider` is an optional separate Skill for backend integration; this folder contains everything needed for component composition.
2. Preserve `ChatMessage` and core-provided message/part IDs. Provider defines event-to-message conversion; Chat owns the rebuilt messages. Components render these props, not raw `SessionEvent`. Caller-owned data of the same shape is also valid. A cumulative snapshot can replace or remove parts; never key dynamic parts by their array positions.
3. Pass `submitDisabled={!chat.canSend}` while recovering a connection or waiting for tool approval. Keep the draft editable. `loading` represents generation; file uploads have separate state.
4. `Sender` does not clear input or upload files. Select, paste, and drop files through one caller-owned upload function. An uploaded file is not automatically mounted in a session.
5. Keep tool approval and destructive-operation confirmation explicit. `ToolApprovalCard` submits one reviewed decision and waits for authoritative state. The application owns plan retrieval and confirmation tokens for destructive operations.
6. Use Tailwind utilities and existing `--kit-*` tokens. Verify that Tailwind scans the component source, including when it lives behind a workspace or package link.

## Examples

- [Workspace Layout](examples/layout.tsx): desktop navigation, mobile drawer, compact header, and caller-owned dialogs.
- [Hook-driven Chat](examples/chat-runtime.tsx): multi-Agent history, a preserved default composer, and main Agent approvals.
- [Reasoning lifecycle](examples/reasoning.tsx): streaming expansion, terminal collapse, and manual disclosure.
- [Attachment composer](examples/attachment-sender.tsx): file selection, paste, drag/drop, upload callbacks, failed uploads, removal, draft preservation, and custom Sender actions.
- [General components](examples/general.tsx): Layout composition, headers, navigation, state helpers, confirmation preview, and the legacy ThreadPanel display.
- [Content and feedback](examples/content.tsx): individual message parts, complete messages, Markdown, code, diagrams, files, copy, and controlled feedback.
- [Prompts and suggestions](examples/prompts-suggestion.tsx): draft insertion and keyboard-safe slash commands.
- [Tool approvals](examples/approvals.tsx): caller-owned decisions, refresh, and stop callbacks.
- [Discovery and usage](examples/discovery-usage.tsx): controlled category selection, agent cards, quota meters, and activity summaries.

All authored examples and guidance are English. Some existing components have fixed Chinese labels and do not yet expose a locale API; do not invent one. Use existing label props where available, or localize copied source when the user requests it.
