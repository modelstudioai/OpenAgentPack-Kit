# Already-normalized events

When the backend already converts Bailian to SDK `SessionEvent` snapshots, use
`createSessionEventChatProvider` with the documented control frames. Running those
events through the raw factory would use the wrong input contract and risk double accumulation.

[normalized-provider.ts](../examples/normalized-provider.ts) is a complete example
for a self-owned backend that adopts Kit's public SSE control-frame format at its
own `/sessions/:id/events/stream` endpoint. The server can be implemented in any
stack; deploying Kit Server is not required. The sample also expects the public
control frames and explicitly accepts the `x-kit-protocol-version` request header.
The factory uses the injected RequestClient for one abortable stream and four
configured HTTP operations. Paths, methods, identity headers and JSON response
wrappers belong to the application. There are no implicit protocol headers.
The factory defaults to 30 seconds for readiness and 45 seconds without an effective
frame. Keep this policy rather than duplicating a reader loop or retrying writes.
The four non-stream operations use the same configured RequestClient as the raw example.
The factory defaults to `transformMessage: transformSessionEvent`. Chat calls
this strategy while rebuilding messages; the Provider does not maintain its own message
cache. Custom display policies are described in [message transformation](message-transform.md).

This sample backend sends:

1. `reset` with the Session ID when complete reconstruction is required.
2. `event` frames with full SDK `SessionEvent` snapshots.
3. `ready` only after historical and live events have been reconciled.
4. Ongoing `event` updates and `ping` frames.
5. `done` only for explicit transport termination, or `error` for stream failure.

Use protocol `SseFrame`/`encodeFrame` when implementing this wire format. Preserve
opaque transport update cursors in SSE `id`; the backend validates `after` and
replays updates, or resets when the cursor is expired. A replay cursor must advance
for updates to an existing business event too.

If the backend uses a different normalized envelope or transport, keep the same
five-method Provider and map that transport to `StreamSessionOptions` callbacks.
The callback contract does not require those wire event names. Do not feed an
unrelated wire format to `decodeFrame` or invent a second business event type.

The Web app connects Kit Server through this same public factory, configured with
`/api/kit/sessions` and `{ data }`. The independent example uses `/sessions` and
`{ result }`. Existing KitClient applications can retain `createKitChatProvider`
or the context entry; see [the compatibility example](../examples/kit-client-provider.ts).
