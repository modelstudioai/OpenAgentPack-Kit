# Tool approval

Use the existing chat result with `ToolApprovalCard`. The card shows the frozen
tool arguments inline and allow/deny are direct one-click submissions.
Its callbacks are `chat.submitApproval` and `chat.refreshApprovals`; see
[the compiled example](../examples/approval-list.tsx).

`requires_action` belongs to the current Turn. Keep the draft editable and ordinary
submission disabled. A rejection is a decision for one tool call, not an instruction
to stop the whole Session.

| Approval state | Interaction |
| --- | --- |
| `pending` and `actionable` | Review current arguments, then allow or deny |
| `submitting` | Prevent duplicate submission |
| `submitted` | Wait for Provider execution events |
| `uncertain` | Refresh before considering another explicit decision |
| `stale` | Refresh the current pending set |

Identify a decision with the current `batch_id` and `call_id`, never the tool name.
Send `result: "allow"` or `"deny"`; an optional `deny_message` has a 200-character
Kit limit. Do not edit the tool arguments or activate historical requests.
Unsupported tools or incomplete information remain read-only.

The Controller refreshes the pending set before submission and rejects changed or
invalidated confirmations. The backend must independently verify application
identity, Session ownership, current pending batch/call, and existing responses.
Browser checks do not replace backend authorization.

On a lost response, the decision may already have reached the backend. Never wrap
approval submission in an automatic retry loop. The Controller attempts a query;
if the outcome is still `uncertain`, offer `refreshApprovals()`. Only a refreshed,
still-actionable request can be confirmed again by the user.

Resource operations such as apply, destroy, or publish retain their separate
plan-and-confirm workflow. Tool approval does not authorize them.
