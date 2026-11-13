# Raw Bailian SSE

Read [raw-bailian-provider.ts](../examples/raw-bailian-provider.ts) and its
[HTTP helper](../examples/backend-http.ts). The factory consumes a `RequestClient`
and six operation configurations:
`openStream`, `listEvents`, and the four non-stream ChatProvider methods.
The first two jointly implement the public `stream` method. Each operation has
`buildRequest(input, context)` and `mapResponse(response, context)`. Build returns
`{ path, init? }`; map returns the operation result. The Provider executes HTTP,
and maps with the original `input` plus the supplied cancellation context.

## Readiness is a backend guarantee

`openStream.mapResponse` returns `{ response, ready }`, where `ready: Promise<void>` represents
an actual upstream subscription. It cannot depend on the first business event:
an idle Session must become ready before its first send.

The example declares this specific backend contract: establish the Bailian
subscription first, then send response headers with `x-upstream-ready: true`.
For cross-origin requests, expose that header through
`Access-Control-Expose-Headers`. The adapter rejects a missing signal.
Only under this backend guarantee can an already-resolved Promise represent
readiness. An unconditional HTTP 200 check or a header added before upstream
subscription would break the guarantee.

Do not consume the SSE body or await `ready` inside `mapResponse`. Return the body
and promise immediately so the factory can start buffering while readiness is
pending. Mapping failure or cancellation closes the response, including a late
response from an implementation that ignored cancellation.

An independently signaled handshake is also valid. It must identify this
subscription, reject on failure, and be cancelable with the supplied signal.
Do not treat a cached "Session exists" or health response as subscription readiness.

## History and recovery

The factory immediately reads and buffers the stream, waits for upstream readiness,
then reads every ascending history page. `listEvents.mapResponse` returns complete raw objects
and an opaque `nextPageToken`, ending with null or no token. Preserve IDs, creation
timestamps, lifecycle information, content, and main Session status.

The factory feeds history and buffered frames into the SDK normalizer, emits a
reset/reconstruction, and only then announces ready. History must include the
information needed to resolve execution state and pending approvals. Never silently
truncate it or manufacture idle when state is unknown.

Same-ID snapshots can change. Conflicting history/live snapshots without update
evidence may be rejected; `created_at` is not a snapshot version. Unmatched
`object: "content"` frames cannot be discarded to make readiness succeed.
Within one live connection, preserve arrival order, including same-ID state updates.

Each reconnect reads complete history. This path does not forward Kit `after`, SSE
`id`, or a final business event ID as a Bailian per-update cursor. An in-progress
historical snapshot has no reliable delta watermark: recovery may temporarily show
partial content until an authoritative full snapshot arrives. Do not promise
character-perfect continuity across an outage.

## Limits and cleanup

| Option | Default |
| --- | --- |
| `connectTimeoutMs` | 30000 |
| `idleTimeoutMs` | 45000 |
| `maxBufferedFrames` | 1024 |
| `maxBufferedBytes` | 8388608 |
| `maxHistoryEvents` | 10000 |

Bounds fail explicitly rather than dropping events. Stream and history operations
receive `context.signal`; `init` cannot override it. The total connection deadline
covers request construction, dynamic authentication, HTTP, mapping, readiness and
history. The factory cancels readers, timers, history, and buffered
delivery together; the Controller schedules reconnects. Finishing a Turn does not
close a persistent subscription. Natural EOF and silence are failures, not success
or an invented OpenAI `[DONE]` frame.

Kit performs framing and recovery; SDK performs Bailian accumulation and event
conversion. Kit explicitly uses `{ redact: false, truncate: false }` for complete
content, leaving the SDK's existing defaults intact. Never add another normalizer
or post-process every snapshot by appending its text.

## SDK availability

The repository pins the published npm package `@openagentpack/sdk` to the exact
version `0.10.0`, with package contents locked by `pnpm-lock.yaml` integrity.
Its browser-safe `@openagentpack/sdk/session-events` entry exports
`SessionEvent` and `createBailianSessionEventNormalizer`; its server entry provides
`listSessionThreads` and `listSessionThreadEvents`. Recheck public exports and run
the relevant contract and browser bundle tests when changing dependencies.
Registry availability does not establish live backend/Cloud validation.
Do not commit developer-machine paths or use SDK internals.
