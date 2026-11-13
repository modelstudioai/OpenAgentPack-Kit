# Session lifecycle

## State and acceptance

The Provider supplies a message transformation strategy. Chat owns the latest event
ledger and calls the strategy during reconstruction; the resulting messages are part
of the Controller snapshot. `useChat` does not perform another event conversion.
Execution and approval state stay in Chat even when a custom strategy changes display.

`connection` is `disconnected`, `connecting`, `connected`, or `reconnecting`.
`phase` is `idle`, `running`, `requires_action`, `stopping`, `failed`, or `interrupted`.
They describe separate facts. A network failure does not mean execution ended.

`canSend` combines readiness, execution, and Session status. Do not derive it from
`connected` alone. `turnRunning` remains true while awaiting tool approval or stop
confirmation. `stop()` returning successfully means the interruption request was
accepted; Provider events determine the eventual execution state.

`send()` waits for readiness and submits one request. Its resolution means acceptance,
not that the response is complete. The Controller owns optimistic messages and
reconciliation; do not also append a local user message to `messages`.

Keep a controlled draft in page state. Clear it only when the submitted text still
matches the current draft, so text entered while the request was pending survives.
Use `submitDisabled` to gate submission rather than disabling the entire input.

## Create, then send

For the default backend, `client.createSession()` returns a real `session_id`.
For a self-owned backend, call its creation endpoint separately.
Update selection and call `chat.send(text, { sessionId: createdId })` in the same
handler. The explicit target avoids a stale React closure using the previous ID.
The first-session example implements this without a second hook or a synthetic ID.

Before a Session exists, `canSend` is false. A page may separately enable a
"create and send" action; it must create a Session first and handle failure without
discarding the draft. Do not pretend that `null` is a connected Session.

If creation outlives a page or backend change, ignore its result for sending. A
backend may still have created the Session; list refresh can discover it. Do not
automatically delete it to compensate for a canceled browser action.
The custom example scopes selection and pending work to the current backend binding.
Changing that binding clears its busy state and selection; an older completion
cannot unlock or select a Session for the new binding. Keep these inputs stable for
ordinary renders so a rerender does not intentionally start a new binding.

## Lifetime and selection

Outside React, [controller.ts](../examples/controller.ts) imports the public core
Controller. The host subscribes, awaits `connect()` readiness, and calls `dispose()`
when ownership ends. `dispose()` is local cleanup, not a remote interrupt request.
The same Controller implements the state and actions used by the hook.
The optional `createLocalStore` example instead injects the Provider's strategy into
`createSessionStore`. That host must deliver snapshots with `applyEvent` and own all
lifecycle transitions. Prefer the Controller unless event delivery is already owned;
do not create another Store alongside `useChat`.

The hook owns Controller creation, connection, and disposal. Its StrictMode support
does not require a component-level "connect once" ref or manual Controller disposal.
Avoid calling `send` from a mount effect, which can execute twice in development.

Keep a Provider in application initialization, state, or a memo with stable
dependencies. A new Provider identity replaces the old Controller even when the
Session ID is unchanged. A changed Session ID releases the old subscription.
Unmounting aborts the subscription; callbacks from old bindings must not be reused.

The default example keys its panel by Session ID and resets that panel's draft.
If drafts must survive selection changes, maintain a page-level map keyed by Session
ID instead. Use an independent draft key for a not-yet-created Session.

Session selection, multi-session caching, history navigation, and files remain
application responsibilities. `threads` are message groups, not Session CRUD objects.
`artifacts` describe output files; supply a backend download action instead of placing
Provider credentials or presigned credentials in the browser.

## Multi-Agent views

Pass `chat.multiAgent` to the chat-ui `Chat` component with both the default client and a custom Provider. `selectedThreadId=null` selects the main Agent. Selecting a child loads its history when available; `refreshThreads()` retries discovery, and `loadThreadEvents(id, { more: true })` or `{ retry: true }` handle pagination and recovery. Child histories never replace the main event cursor, execution phase, or approval state.

Chat keeps its main composer and loaded Agent panels mounted during selection. Do not add a React key based on the selected thread, or implement a second child panel inside the approvals slot. Child views are read-only; their stop action stops the main turn. A custom Provider without thread-history methods remains usable, but its child view only contains messages observed during the current connection and must say so.

The default and custom examples use a workspace Chat with a custom Sender. The caller still wires submit, stop, generation, and submission-disabled state into that Sender; Chat also needs `turnRunning` and `onStop` for its child view. Pass `approvals=null` when no main Agent approvals exist.

## Member usage and Session deletion

Default Kit Server member statistics come from cumulative Provider Session details,
not from counting rendered messages or SSE chunks. `client.session(id)` may include
`usage` (input, output, cache read, and cache creation tokens) and `stats` (active and
duration seconds). Missing fields are unknown, not zero. These counters are separate
from the existing one-accepted-Turn-per-Credit quota.

Kit-specific member administration belongs to the repository's Console application,
not the public Kit SDK. Do not require its administration routes when integrating
Chat UI with a self-owned backend. Generic query and write lifecycle helpers are
shown in the [call state example](../examples/call-state.ts).

Session deletion still requires a reviewed plan and explicit AlertDialog confirmation.
For local member experience Sessions, the server blocks new writes, waits for current
writes, interrupts unfinished or approval-paused execution, confirms it stopped, then
reads and persists usage before sending DELETE. Input and output counts must be valid;
missing optional cache or timing values remain partial. A failed capture prevents
deletion but execution may already have stopped. A persisted snapshot is the Provider's
latest returned cumulative value, not a guarantee of final billing settlement.

When `KitError.details.deletion_uncertain` is true, keep the Session unavailable for
new writes and prompt the user to obtain a new plan and explicitly retry deletion.
The server reconciles remote state while retaining the snapshot, including after a
restart. Do not automatically resend DELETE or compensate by sending another message.
An existing Session after a DELETE network error does not prove the request was
rejected. Retrying capture must preserve the earlier deletion uncertainty. After
interrupt has been sent, a later idle state followed by capture failure must not
reopen writes: the old interrupt may still arrive. The server keeps that protection
until the explicitly confirmed deletion flow completes.
Completed deletion removes the normal Session entry but keeps its member usage.
