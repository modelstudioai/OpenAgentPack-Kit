---
name: kit-chat-provider
description: "Connect Kit Server or a self-owned Bailian backend through the public Request and createSessionEventChatProvider configuration, or use createBailianChatProvider for raw SSE. Covers readiness, history, cancellation and tool decisions."
---

# Kit Chat Provider

Use this skill for the frontend adapter between an existing business backend and
Kit's chat Controller. The upstream service remains Bailian Managed Agent. This is
not a second provider abstraction, backend deployment tool, or React context component.

## Choose the path

| Existing backend | Implementation |
| --- | --- |
| Standard SDK `SessionEvent` snapshots and control frames, including Kit Server | Configure `createSessionEventChatProvider`; read [normalized events](references/normalized-events.md) |
| Standard snapshots with a different transport | Implement the five-method `ChatProvider` and map lifecycle callbacks |
| Relays original Bailian SSE | Use `createBailianChatProvider` from `@openagentpack/kit-sdk/providers/bailian`; read [raw SSE](references/raw-sse.md) |

The Web app uses the same public configuration as self-owned backends. Existing
KitClient applications can retain their context entry or use the
[compatibility wrapper](examples/kit-client-provider.ts).

Inspect actual request, response, readiness, and history contracts before choosing.
Raw text chunks without event identity and execution state are not sufficient.
The raw factory uses a persistent subscription and a separate send request; a POST
that returns only one response stream needs a different, explicitly designed adapter.

## Integration workflow

1. Compare backend capabilities with [the contract](references/contract.md).
   Session creation/listing and file operations remain outside ChatProvider.
2. Create one `RequestClient` with the runtime base URL and application-auth headers.
   Configure each HTTP operation with `buildRequest` and `mapResponse`; the Provider
   executes HTTP. Read [the four layers](references/layers.md). Use
   [the compiled examples](references/examples.md) and [the API reference](references/api.md).
   Example routes and wrappers are explicitly sample business contracts, not Bailian URLs.
3. Keep the Provider instance stable and pass it to
   `useChat({ sessionId, provider })`. A null ID postpones the subscription.
   Use `transformSessionEvent` as its message strategy; customize `transformMessage`
   only when the display requires it. Read [message transformation](references/message-transform.md).
4. Verify idle-session readiness, full-history/live overlap, same-ID updates,
   aborted requests, and approval outcomes against the backend's real contract.
5. For Multi-Agent, add optional thread queries and pass `chat.multiAgent` to `Chat`.
   Use [the shared example](examples/multi-agent.tsx) for normalized snapshots or the
   Bailian standard API preset. Do not build a second thread state machine in the page.

The Provider defines message conversion; Chat rebuilds from the latest event ledger
and owns the resulting messages. The Controller owns reconnect scheduling, optimistic
messages, and approval orchestration. Each Provider `stream` invocation owns one connection. Do not add a
second retry loop or automatically resend message/approval POSTs.

Use `createSseStream` for an existing byte stream, or `createRequest` for independent
HTTP and SSE requests. Stream leaves data as text; Request can parse JSON syntax
without validating its business schema. Neither infers readiness or maintains chat
state. The raw factory requires Request plus six operation configurations;
free request callbacks are not an alternate input form.

## Ownership and dependencies

Reuse the SDK's `SessionEvent` contract and public normalization. Do not copy its
accumulator, concatenate snapshots as deltas, or import SDK `internal/*` paths.
The browser may use the SDK `session-events` entry; never its Node-oriented main
entry at runtime. Provider credentials remain on the backend; frontend requests
carry application identity only.

The repository pins the published npm package `@openagentpack/sdk` to the exact
version `0.10.0`, with package contents locked by `pnpm-lock.yaml` integrity.
Its browser-safe `@openagentpack/sdk/session-events` entry
exports `SessionEvent` and `createBailianSessionEventNormalizer`; its server entry
provides `listSessionThreads` and `listSessionThreadEvents`.
Verify resolved public exports and run the relevant contract and browser bundle
tests when changing dependencies. Registry availability does not establish live
backend/Cloud validation.
Do not publish or modify SDK defaults as part of backend integration.
