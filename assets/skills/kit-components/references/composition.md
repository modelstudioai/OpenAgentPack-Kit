# Composition and behavior

Use the [generated API reference](api.md) for exact types, required props, aliases, and source documentation links. This guide explains behavior that type signatures cannot express.

## General components and page frame

`Layout` owns the desktop sidebar, mobile Radix drawer, header slot, bounded content area, and visual viewport sizing. Supply a bounded parent such as `h-dvh`. Set `fitViewport=false` when the host already manages that sizing. The component does not route, authenticate, or create sessions.

Compose the whole rail (brand, new-chat entry, `SessionSidebar` directory, navigation, account) in your own aside and return it from the `sidebar` render callback; the desktop column and the mobile drawer mount the same content one at a time, so no mobile-visibility prop is needed. Call `closeSidebar` after navigation and include `closeButton` in the rail header. The `header` callback supplies `menuToggle` for `AgentHeader leading`; without a header, `mobileTitle` labels the mobile fallback header. Keep pending confirmation state in the caller and render it through `dialogs`, so it remains visible within the mobile focus scope and across breakpoints. See [the Layout example](../examples/layout.tsx).

`AgentHeader` displays an `AgentSummary | null`. Passing `actions` replaces its default new-session button; `actions={null}` hides that region. It does not create a session. Use `compact` for the workspace header; `StatusIndicator variant="badge"` fits its actions slot.

Pass a non-empty `agents` array and `onPickAgent` to expose a title selector. The callback supplies the agent slug; the application owns route updates, session selection, and message cleanup. Icons accept image URLs, relative paths, or text such as emoji.

`SessionList` is a controlled navigation list: `sessions`, `activeId`, and `onSelect` are required. The `menu` render prop exposes row actions only; it does not implement confirmation or HTTP requests, and destructive callbacks must not bypass application confirmation. Use business `session_id` values. `SessionSidebar` renders the session directory area above it: agent groups with lazy per-group pagination, a recent section, search, and per-section highlight, rename, and error affordances. The rail frame around it belongs to the caller.

`StatusIndicator` distinguishes connection state from execution phase. Required legacy props are `connected` and `turnRunning`; also pass `phase`, `connection`, and `streamError` as `error` for current `useChat` integration. A reconnecting connection is not a completed turn.

`EmptyState` takes a title and optional hint. `ErrorState` takes a message and optional retry callback; retry behavior belongs to the caller. `ThreadPanel` is a compatibility display for already projected `threads`, forwards copy/download callbacks, and renders nothing for an empty record. New conversation pages use `Chat.multiAgent` for discovery, history, and navigation. Do not infer the main session's completion from a child thread.

`ConfirmDialog` is a conditionally mounted Radix AlertDialog with focus containment and restoration. Its `danger` default is `true`; `busy` disables confirm, cancel, and Escape while a request is pending. The caller owns plan retrieval, the matching one-use confirmation token, pending state, and closing after success. The example is explicitly a local preview reset.

See [general examples](../examples/general.tsx).

## Chat and message projection

`Chat` composes `MessageList` and a default `Sender`. `turnRunning=false` and `canSend=true` are defaults; real integrations should pass actual hook state. The default input clears the submitted draft only after a successful send, and only if the draft has not changed meanwhile. Failed submission preserves it.

Use `composerDisabled` for a fully disabled default input, such as an exhausted server quota; stopping an active turn remains available. `canSend=false` only prevents submission and preserves editing. A custom `sender` slot must implement both policies itself.

Provide `scrollKey={sessionId}` to change the logical scroll target without remounting the composer. A custom `sender` slot owns its entire input wiring: `Chat` does not apply its `onSend`, `onStop`, `turnRunning`, or `canSend` to that slot. An `approvals` slot renders caller-supplied main Agent approval cards at the end of the stream. Pass `null` when empty; a truthy empty wrapper still shows the waiting-for-approval hint and suppresses the pending indicator.

Pass `multiAgent={chat.multiAgent}` with either the default or a custom Provider. Child cards appear at their dispatch positions in the main stream and expand to read-only history, pagination, errors, retry, and file actions. Running children expand automatically; completed children can be reopened. The composer stays mounted while cards expand or load. Only main events govern send readiness, approvals, and turn completion; the main composer stops the whole main turn. Chat does not switch Agent tabs. An optional `SubAgentPanel` groups dispatches by name in the aside and opens their event history in a dialog.

Pass the current Agent's `skills: SenderSkill[]` to Chat for slash selection and message chips. Adapt `onSend(text, selectedSkills)` to `chat.send(text, { skills: selectedSkills })`; these second arguments have different shapes. A custom Sender needs the same skills list and its own submit adapter. Standalone Message/MessageList accept names (`string[]`) to restore known protocol tokens in place; unknown tokens remain text.

See [the hook-driven Chat example](../examples/chat-runtime.tsx).

`MessageList` defaults to `autoScroll=true`. Give its parent a bounded height and `min-h-0` in flex layouts. Reading earlier messages pauses following; returning to the bottom, changing `scrollKey`, or emptying the list restores it. `autoScroll={false}` disables following even on session changes. Custom hidden panels can use `active=false` to suspend scrolling; update `historyCursor` after a successful earlier-page load to preserve the reading anchor.

`Message` consumes a `ChatMessage`, preserving the relative order of text, reasoning, tool, artifact, status, and unknown parts. Adjacent text/reasoning parts may be combined for rendering. Use core-provided stable IDs for custom dynamic renderers; cumulative snapshots are not append-only arrays. Completed assistant messages with text expose copy; failed, pending, streaming, and interrupted states remain distinct.

Provider defines `SessionEvent` to `ChatMessage` transformation, and Chat owns its
reconstructed state. Components do not call the SDK or perform that conversion.
They can also render caller-owned `ChatMessage` props without `useChat`; that caller
then owns message updates, identity, and execution state.

`ReasoningBlock` starts collapsed, including while streaming, and preserves manual disclosure choices across content and status updates. Do not replace the reasoning part status with the overall message status. Missing status does not imply completion. `ToolCallCard` displays a `MessagePart` with `type="tool"` and `running`, `done`, or `error` status; it does not execute tools or request approval. Both accept `contentMaxHeight` to replace the expanded area's default `max-h-80`. `ArtifactCard` wraps `FileCard` for output files and delegates preview and download. Input attachments and output artifacts are different data flows.

See [content examples](../examples/content.tsx).

## Input and attachments

The employee-style composition opts into both `data-kit-appearance="workspace"` and `variant="workspace"`. Chat forwards its variant to the default Sender and message list; a custom sender must opt in separately. Workspace Sender places the editor above a toolbar, prefix on the left, send/stop on the right, and attachments in the header inside the card. Omitting the variant preserves the default inline layout.

`Sender` supports controlled `value` or uncontrolled `defaultValue=""`. Its default submit mode is `enter`; Shift+Enter inserts a line break. `shiftEnter` reverses that convention, and `false` disables keyboard submission. IME composition does not submit. Default autosizing is one to six rows.

- `onSubmit(text, skills?)` receives text and derived skill names and never clears the draft automatically. The contenteditable editor renders known `/name ` markers as atomic inline chips. After successful application work, reset the controlled value or call `SenderRef.clear()`.
- `loading` switches the default send action to stop. `submitDisabled` blocks both button and keyboard submission while leaving the draft editable. `disabled` disables input; `readOnly` makes it read-only and blocks submission. The generation stop action remains available in either case.
- `onKeyDown` runs before built-in submission; `preventDefault()` is how Suggestion consumes Enter.
- `onPasteFile` receives pasted files. Connect it to the same upload handler as `Attachments.onSelectFiles`.
- `suffix`/`footer` render callbacks receive context-bound `SendButton`, `LoadingButton`, and `ClearButton`. They are not standalone public exports.
- `Sender.Header` and the separately exported `SenderHeader` are the same component. Defaults are `open=false` and `closable=true`. Closing a header does not remove its data.
- `SenderRef` exposes focus, blur, clear, insertion at the current selection, and native/input elements.

`Attachments` defaults to `items=[]`, `multiple=true`, `disabled=false`, and `overflow="wrap"`. It owns a native picker and drag/drop surface, not uploads. `onPick` replaces the native picker for a host bridge; that callback must apply its own accept/count rules. Native `accept` is a chooser hint, not file validation. Validate uploaded content in the application/backend.

`maxCount` limits the built-in selection/drop path. Enforce the same policy in the shared application handler so paste cannot bypass it. `getDropContainer` needs a positioned container. Provide `onSelectFiles` for drag/drop, even when a host picker is present.

`Attachments.FileCard` and `AttachmentFileCard` are the same single-item component. They display caller-provided `AttachmentItem` state. Uploading hides removal and can show determinate or indeterminate progress. Done/error items can be removed when a callback is supplied; removal updates local state only and does not delete a remote file.

Use [the attachment composer](../examples/attachment-sender.tsx) as the full reference. It shares one selection/paste/drop handler, blocks submission while files are uploading or failed, preserves drafts on send failure, and ignores uploads after unmount. Remount this composer when intentionally discarding a session-specific upload draft; `Chat.scrollKey` alone does not reset it.

The example's `onSubmit(text, fileIds)` is an application composition callback, not `Sender.onSubmit`. Upload success does not mount a file. In the default Kit Server contract, attach files when creating a session; sending attachments to an existing session is rejected. For custom backends, follow their actual session-file contract instead of assuming that file IDs in a send request work.

## Prompts and suggestions

`Prompts` renders nothing when `items` is empty. `vertical`, `wrap`, `fadeIn`, and `fadeInLeft` default to `false`. A parent with children is a group; only its selectable children emit a click. Disabled items do not submit. `onItemClick` supplies data; choose explicitly whether to populate a draft or call send.

`Suggestion` wraps an input through a render prop. `block=false` and an initially closed popup are defaults. Forward both `onKeyDown` and `inputProps` to Sender. Open with `onTrigger(info)`, close with `onTrigger(false)`, and update your draft in `onSelect`. It handles arrow keys, Enter, Escape, and nested choices. It does not implement slash-command parsing; the application chooses the trigger and filtering.

See [prompts and suggestion examples](../examples/prompts-suggestion.tsx).

## Feedback, files, and rich text

`Actions` is a composable action group, defaulting to empty `items` and `variant="borderless"`. Item clicks call the item callback and then the group callback. Nested `subItems` form disclosure menus. Stable item keys are required.

`Actions.Copy` and `ActionsCopy` are the same implementation. The supplied asynchronous `onCopy` must reject on failure; absent that callback the component uses the browser clipboard. Empty text, pending work, and `disabled` prevent copying. A denied clipboard permission is shown as failure, not success.

`Actions.Feedback` and `ActionsFeedback` are controlled. Values are `default`, `like`, and `dislike`; selecting the active choice returns to `default`. The component does not persist feedback. Disable it or reconcile state while the application's write is pending.

`FileCard` defaults to `loading=false` and `disabled=false`. `onClick` is the primary activation when supplied; otherwise `onDownload` is primary. When both exist, download is a separate button. A caller supplies the thumbnail `src`; the component does not fetch file contents. `ArtifactCard` adapts output-file naming to this card.

`Markdown` accepts a string, uses GFM and sanitization, and delegates code blocks to `CodeHighlighter`. Complete Mermaid fences render as diagrams; an incomplete streaming fence remains source. Keep sanitization when copying or extending the renderer.

`CodeHighlighter` defaults to `copyable=true`, `showLineNumbers=false`, and plain text for a missing/unsupported language. Inputs longer than 50,000 characters retain their full text and copy support but skip syntax highlighting. `header={false}` hides the header and its copy action. It renders text/AST nodes, not executable HTML.

`Mermaid` defaults to image view, `copyable=true`, and `streaming=false`. Use `streaming=true` while a diagram is incomplete. It falls back to source on parse failure or resource-loading syntax, uses strict Mermaid security, and renders SVG as an image rather than inserting interactive SVG into the document. Do not remove these boundaries to make arbitrary tool output render.

See [content and feedback examples](../examples/content.tsx).

## Tool approval

`ToolApprovalCard` consumes a `ChatToolApproval` projection plus asynchronous `onDecision` and `onRefresh` callbacks. Optional `onStop` interrupts the whole turn; denying one tool is a different action.

Wire the hook's `submitApproval`, `refreshApprovals`, and `stop` methods. Use the combination of `batch_id` and `call_id` as the key. The card shows the frozen arguments inline with a collapsible full-JSON view; allow and deny are one-click submissions, and the controller invalidates a submission when identity or parameters changed.

Only `pending` and `actionable` requests permit decisions. `submitting`/`submitted` do not imply execution completion. An `uncertain` outcome requires refresh, not automatic resubmission; `stale` requests cannot be approved. Unknown tool types remain read-only. Denial reasons are optional and limited to 200 characters.

See [approval examples](../examples/approvals.tsx). The backend remains authoritative for current batch, ownership, and duplicate-response validation.

## Discovery and usage

`CategoryTabs` takes controlled `active` and `onChange` values; it prepends the `featured` tab to caller-provided categories. Counts are part of category data but are not currently displayed. Selecting a category does not fetch data or navigate.

`PlazaCard` displays one `PlazaEntry`, including its category, featured/mine badges, and recent turn count. `onOpen` receives the slug; the application decides how to open the conversation.

`MeterBar` clamps its visual fill to zero through 100 percent. Set `unlimited` to show a track without a percentage; a nonpositive `max` also produces no fill. The caller owns quota calculation and enforcement.

`ActivityHeatmap` renders supplied days in order, keyed by unique day strings. It computes relative intensity from the largest turn count. Supply the desired date range, including zero-activity days; it does not fetch, sort, or insert missing dates.

See [discovery and usage examples](../examples/discovery-usage.tsx). These components perform no backend operations.

Member cumulative Session usage is a separate admin view, not the Credits meter.
Render input/output/cache token counters and active/duration seconds independently;
show unknown values, per-metric coverage, refresh time, and partial collection states.
Do not sum all token counters into a total because cache inclusion is Provider-specific.
Use the existing table, empty, and error primitives with admin hooks; do not fetch
Provider details or enforce token overages inside components. Deleted Session rows
can retain numeric usage, but their message content is not retained by the Kit store.
SessionList delete callbacks must handle server refusal when execution cannot stop or
usage cannot be persisted, and must not hide the Session until deletion is confirmed.
