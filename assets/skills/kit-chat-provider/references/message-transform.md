# Message transformation

SDK normalization converts raw Bailian SSE into `SessionEvent` snapshots. A Provider's
`transformMessage` converts those snapshots into Kit `ChatMessage` presentation data.
It does not normalize raw SSE again. Both built-in Provider factories explicitly use
the public `transformSessionEvent` default, which has no SDK runtime dependency.

`MessageTransformer` accepts `{ messages, event, identity }` and returns
`{ messages, artifacts? }`. `messages` is the temporary array for the current thread
in the current reconstruction; the transformer may modify it or return a replacement
array. `identity` is assigned by Chat and stays stable across snapshot replacements.
Preserve it when delegating, along with message IDs, part IDs, and reconciliation fields.

Chat owns the event ledger and rebuilds from its latest snapshots. It invokes the
strategy for each event and owns the returned arrays. Do not retain messages in a
Provider closure, mutate events, or keep a cumulative cache across reconstructions.
A Provider can serve multiple Sessions. Same-ID snapshots can replace or clear content,
and reset can remove an event entirely. Transformations must support those operations.

[message-transform.ts](../examples/message-transform.ts) wraps the default strategy
with an idempotent display-label replacement. It returns replacement arrays while
preserving IDs, status, tool data, and artifacts. Construct the wrapper once for each
backend binding. The wrapper forwards each network method on the original instance,
preserving prototype methods and their `this` binding. This sample deliberately uses the default strategy; wrapping another
custom strategy requires deciding how the two display policies compose.

Execution phase, pending approvals, optimistic messages, reconciliation, and reconnects
remain in Chat. Hiding a status part or changing text cannot complete a Turn or authorize
a tool. UI components still receive the same `ChatMessage` shape.

The property is optional for compatibility: an existing five-method Provider or KitClient
uses `transformSessionEvent` when omitted. Direct Store consumers can inject the same
strategy with `createSessionStore(sessionId, { transformMessage })`; hook consumers
configure it on their Provider rather than rebuilding the Store in the page.
