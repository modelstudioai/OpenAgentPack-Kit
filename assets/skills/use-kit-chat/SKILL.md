---
name: use-kit-chat
description: "Build React chat flows with OpenAgentPack Kit useChat, including session creation, sending, stopping, connection state, and tool approval. Use with Kit Server or an existing custom ChatProvider."
---

# Use Kit Chat

Connect one Session to one `useChat` owner, then pass its state to the page's message,
composer, and approval components. A `ChatProvider` connects the business backend;
React `KitProvider` supplies the default KitClient context. These are different objects.

## Choose the entry

- **Kit Server and self-owned backends:** use `useChat({ sessionId, provider })`.
  Standard-event backends can configure `createSessionEventChatProvider`; the Web
  app uses that same path. Read [the custom example](examples/custom-chat.tsx).
- **Existing KitClient applications:** `useChat(sessionId)` inside KitProvider
  remains supported. Read [the context example](examples/default-chat.tsx).
- **Local member login:** Kit Server requires login by default. Use a stable
  `createMemberAuthController` and `useMemberAuth` before mounting KitProvider.
  Read [the member login example](examples/member-auth.tsx). Scope host storage to
  the final full API URL, retain only the token and expiry, and key the business
  subtree by `generation` so account changes clear drafts, files and chat state.
  Supply `createClient(request)` and `createChatProvider(request)` to bind an explicit Provider to the same
  fixed identity and cancellation boundary, then pass `auth.chatProvider` to useChat.
- **Existing custom backend adapter:** use `useChat({ sessionId, provider })`.
  No KitProvider is required. Read [the custom example](examples/custom-chat.tsx).
- **A host without React:** use `createChatController` from `@openagentpack/kit-sdk/chat`,
  then subscribe and dispose explicitly. Read [the Controller example](examples/controller.ts).
- Pass `null` until a real Session ID exists. Session creation and listing are separate
  operations; the hook does not create a Session.
- **Discovery and usage with Kit Server:** use `usePlaza`, `useQuota`, and `useQuotaRequests`
  inside KitProvider. Read [the discovery and usage example](examples/discovery-usage.tsx).
  `useAgentResources`, `useUsageLimits` and attachment metadata are also application
  APIs; read [the experience data example](examples/experience-data.tsx).
- **Query and write state:** reuse `createQuery`, `createMutation`, and `createObservable`;
  read the [call state example](examples/call-state.ts). The host owns the backend calls.
  Kit-specific member administration belongs to the Console application.

Keep Client and Provider instances stable. Do not construct a new Provider on every
render or mount another `useChat` just to render approvals.

## Implement the interaction

1. Read [the API reference](references/api.md) for the installed public contract.
2. Render `messages` through `MessageList`, or use stable message and part IDs in a
   custom renderer. Snapshots can replace or remove parts.
3. Bind `Sender.submitDisabled` to `!chat.canSend`; leave the draft editable.
   Clear only the submitted draft after `send` succeeds. Retain it on failure.
4. Use `chat.stop()` for remote interruption. Unmounting or switching Sessions only
   cancels the browser subscription.
5. For approval tasks, read [approval handling](references/approvals.md) and reuse
   [ApprovalList](examples/approval-list.tsx).

Read [session lifecycle](references/lifecycle.md) for new-session targeting,
StrictMode, Provider replacement, and state meanings. All compiled source examples
are collected in [examples](references/examples.md).

## Boundaries

`useChat` has no public `setMessages`, message editing, regenerate, or request-queue API.
Do not invent those methods or automatically resend failed writes. Data hooks accept an explicit `client`; `useKitClient` remains the compatibility Context accessor.
A custom ChatProvider does not configure data operations. Use
[the public experience example](examples/experience.tsx) and supply
`createKitClient({ request, operations })` for your backend. Credit increase requests
are separate from tool approval; submit them with `useCreateQuotaRequest().submit` after
an explicit user action, then refresh usage and request history.
Use `useAttachments` and `useArtifactActions` for reusable upload/download workflows.
File selection, preview windows and saving stay in the host. Uploading a file does
not mount it in an existing Session.
Use `client.downloadFile(fileId, { sessionId })` for authenticated Artifact downloads.
`fileDownloadUrl` only produces a URL and cannot attach Bearer credentials. Login
expiry, HTTP 401 and stream unauthorized errors end the current local identity;
network recovery failures must not silently enable anonymous access. Anonymous
mode is a server opt-in, separate from the mock gateway setting.

The runtime is organized as Stream, Request, Provider, and Chat. The Controller
belongs to core's Chat layer; this hook only binds its state and lifetime to React.
Provider defines event-to-message conversion through `transformMessage`; Chat invokes
it when rebuilding its ledger and owns the messages. Keep conversion in the Provider,
not in the hook or page, and preserve the resulting message and part IDs.
Do not move request execution, SSE parsing or reconnect loops into a page effect.
