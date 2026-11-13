# Frontend-to-backend contract

`ChatProvider` has five required methods. Use public Kit types instead of defining
a competing event or approval model. Exact declarations are in [the generated API](api.md).
It also accepts an optional `transformMessage` strategy; both built-in factories use
`transformSessionEvent`. Read [message transformation](message-transform.md) when
customizing presentation. The five network methods remain unchanged.

Two optional operations enable native Multi-Agent history: `listThreads` returns
`SessionThreadsResponse`, and `listThreadEvents` returns `EventsPage`. Their options
include `limit`, `pageToken` and `signal`. Event pages are chronological within each
page; the next cursor points to older history. Preserve the event's owner
`metadata.thread_id`; references to other agents do not change ownership.
Old Providers still show child events already received, with incomplete history marked.
Pass `chat.multiAgent` into `Chat` to use the shared tabs, pagination and read-only child views.

For raw Bailian responses, `createBailianThreadOperations({ basePath? })` supplies
both standard GET paths under `/api/v1/agentstudio/sessions/:sessionId/threads`,
maps `limit/page` and `{ data, next_page }`, and reverses descending event pages.
Override its operation configs for custom proxy paths or envelopes. Each thread
page uses an independent SDK normalizer and does not reset the Session stream.
See [multi-agent.tsx](../examples/multi-agent.tsx) for both provider paths and native Chat.

| Method | Required behavior |
| --- | --- |
| `stream(sessionId, options)` | One persistent, abortable subscription delivering SDK `SessionEvent` snapshots and lifecycle callbacks |
| `sendMessage(sessionId, body)` | Submit text and `client_message_id`; return real `session_id`, `accepted`, and `event_ids` |
| `interrupt(sessionId)` | Request remote interruption and return `{ interrupted }` |
| `toolApprovals(sessionId)` | Query the current pending batch/calls with complete frozen arguments |
| `submitToolApproval(sessionId, decision)` | Submit one real allow/deny decision; return acceptance and event IDs |

All five methods are required. A no-op interruption or empty approval adapter does
not satisfy the contract. If a backend cannot provide a required capability, report
the missing backend operation rather than hiding it with a fabricated success.

## Subscription lifecycle

- `onReset()` starts full reconstruction. Deliver all authoritative snapshots and
  only then call `onReady({ sessionId, replayed, cursor? })`.
- `onEvent(event, cursor?)` delivers an SDK `SessionEvent`. A changed snapshot with
  the same `event_id` replaces previous content. Preserve explicit empty values.
- `onPing(t)` reports transport liveness. A heartbeat is not a business event.
- `onDone({ status, lastEventId })` reports an explicit transport end. It does not
  establish that the main Session finished executing.
- Reject unexpected EOF, timeout, and network failures. Use `KitError.retryable`
  to distinguish recoverable failures from authorization or contract failures.
- Pass `options.signal` into the actual network operation. After cancellation,
  close readers and stop all queued callbacks; do not reconnect inside the Provider.

Only use `options.after` and callback cursors when the backend provides a genuine,
opaque update replay contract. `event_id` identifies a business event, not a version
of that event. Reusing it as a cursor loses later snapshots. When no replay cursor is
supported, rebuild complete history and declare a reset.

`session_status` determines execution; `idle` with `requires_action` pauses the
current Turn for approvals. A completed message or child thread does not complete
the main Turn. Preserve unfamiliar event types and content blocks for safe fallback
rendering instead of dropping them.

## Application boundaries

URLs must come from supplied runtime configuration. Do not assume the backend is
on the page origin. The sample `getAppToken` supplies application identity only;
never pass a Bailian API key, vault credential, or SDK server configuration.
For the default Kit Server, local member login is required unless the server
explicitly enables anonymous mode. Kit's member auth controller owns a fixed-token
Client per login and cancels old requests on sign-out or expiry, both while waiting
for headers and while reading the body. Cancellation also ends requests made by
custom fetch implementations that ignore the signal, and releases late response
bodies; it does not add a timeout or retry policy. Custom backends
still own their authentication contract; they do not need to implement Kit's
local member endpoints. Do not read one mutable token for requests retained from
a previous identity or send credentials with the public config probe.

Creation, Session listing, upload, mounting, and download are separate backend
operations. Pass the created real Session ID into `useChat`. The default
`useSessions` hook still uses KitClient; it does not consume this Provider.

Message and decision writes are sent once. A failed browser response can mean the
backend already accepted the request. Preserve identity for reconciliation and
refresh current state before another explicit user action.

The backend must check Session ownership and each approval's current batch/call
and prior response. Browser confirmation checks are complementary. Denying one
tool call is not the same as interrupting the entire Session.

Default Kit Server's member usage and protected deletion are separate resource
operations, not additional ChatProvider methods. The server reads cumulative numeric
usage from SDK `getSession().attributes`; it does not derive token usage from SSE.
Local member experience Sessions must stop and persist a usage snapshot before remote
deletion. An idle Session requiring tool approval is still unfinished. Persisted
numeric snapshots survive deletion, while event bodies remain Provider-owned.
Self-owned backends retain their own statistics and deletion contracts; merely
implementing the five ChatProvider methods does not add Kit's member administration.

## Example HTTP helper

[backend-http.ts](../examples/backend-http.ts) implements application auth, safe
HTTP errors, response validation, and all four non-stream methods. Both provider
examples include it by a local import, so copy the whole Skill example directory.
Its `{ result }` wrapper and `/sessions/...` routes are sample business contracts.
Change those mappings to match the actual backend; do not change Kit types.
