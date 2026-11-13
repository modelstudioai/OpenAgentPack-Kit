# Stream, Request, Provider, Chat

Choose the lowest layer needed by the task. These APIs are independent of visual
components and do not require Kit Server.

| Layer | Public API | Responsibility |
| --- | --- | --- |
| Stream | `createSseStream` from `@openagentpack/kit-sdk/stream` | Decode bytes and yield raw SSE fields; cancel and release the reader |
| Request | `createRequest` from `@openagentpack/kit-sdk/request` | Resolve URL and identity headers, execute HTTP, return Response/JSON/raw frames |
| Provider | `ChatProvider`, `createSessionEventChatProvider`, `createKitChatProvider`, `createBailianChatProvider`, `transformSessionEvent` | Map backend operations, history and readiness; define event-to-message conversion |
| Chat | `createChatController` from core; `useChat` from react | Own ledger and messages, invoke the Provider strategy, manage optimistic state, reconnects and actions |

The core root also exports Stream and Request. The focused entries do not import
React or the SDK normalizer. The Bailian entry alone needs the SDK browser converter.
Default message conversion is pure and needs no SDK runtime. Read
[message transformation](message-transform.md) for strategy input, ownership, and snapshot rules.

Read [sse-stream.ts](../examples/sse-stream.ts) for an already-owned response body.
The iterator leaves `data` as a string. Defaults are `utf8Fatal=false`,
`flushOnEnd=true`, and no `maxFrameChars` limit. `onComment` reports heartbeat
comments. Cancellation, parse failure and early `break` release the reader.
`SseStreamError` identifies decoding or framing failures; reader errors retain
their transport meaning. A natural EOF is not an Agent completion event.

Read [request.ts](../examples/request.ts) for standalone HTTP and SSE. Request has
no implicit timeout, retry, Content-Type or Kit protocol header. `response` passes
body ownership to its caller; `json<T>` parses without schema validation, returning
undefined on HTTP 204; `stream` delegates to Stream and owns reader cleanup.
Per-request headers override dynamic headers. `mapHttpError` may produce a safe
application error, but must not expose credentials or arbitrary response bodies.

Web connects Kit Server through `createSessionEventChatProvider`, with explicit
paths, headers and response mapping. Existing KitClient applications use
`createTransport` internally: it adds the Kit header, decodes controls/errors and
retains effective-frame timeouts.
Raw Bailian uses Request plus the six operation configurations. Provider owns
stream/history cancellation and ready; Controller alone schedules reconnects.
No layer automatically repeats message or approval writes.
