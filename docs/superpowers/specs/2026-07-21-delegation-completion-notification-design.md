# Delegation Completion Notification Design

Date: 2026-07-21
Status: design approved; awaiting written-spec review

## Problem

Proma sends every Agent run through the same renderer-level `STREAM_COMPLETE` handler. Visible collaboration children run through `runAgentHeadless()` with `AgentSendInput.triggeredBy = 'delegation'`, but the completion IPC payload does not preserve that origin. The renderer therefore treats both a delegated child finishing and the parent conversation finishing as a user-level task completion, producing a desktop notification and playing the configured `taskComplete` sound for each child.

This is a lifecycle-boundary bug: a delegated child completion is an internal milestone of the parent conversation, not the user-facing completion boundary.

## Goals

1. Play the task-complete sound only for a successful top-level Agent conversation completion.
2. Keep delegated child completions completely silent: no task-complete sound and no desktop completion notification.
3. Preserve child-session streaming state, persisted messages, sidebar status, completion markers, delegation result delivery, and parent wake-up behavior.
4. Use authoritative run-origin data so fast child completions cannot race asynchronous session metadata loading.
5. Apply the same behavior to Claude and Pi runtimes because both share the Agent service and renderer completion path.

## Non-goals

- Aggregate all child results into a new main-process lifecycle state machine.
- Change permission, AskUser, or ExitPlanMode notifications.
- Change task-complete sound settings or add a new preference.
- Silence independent automation, Feishu, DingTalk, WeChat, or bridge-triggered Agent sessions.
- Refactor unrelated completion, sidebar, or notification code.

## Behavior contract

- A completion whose run origin is `delegation` does not send a desktop completion notification and does not play a completion sound.
- The rule covers initial delegation, continued delegation, and retried delegation runs.
- A successful top-level parent completion continues to notify once when `backgroundTasksPending !== true`.
- Errors, user stops, abnormal result subtypes, and background-task waiting retain their current behavior.
- Delegated child sessions still transition to their terminal UI state and remain inspectable.
- If an old or incomplete completion payload lacks the run origin, a session carrying `sourceDelegationId` is still treated as a delegated child.

## Architecture

### Authoritative origin propagation

Reuse the existing `AgentSendInput.triggeredBy` union (`user | automation | delegation`). Add an optional field with the same semantics to `AgentStreamCompletePayload` and populate it at every `STREAM_COMPLETE` send site in `runAgent()` and `runAgentHeadless()`, including defensive catch paths.

The origin is captured from the immutable run input rather than inferred from renderer timing. No new IPC channel or persistent setting is required.

### Central completion-notification policy

Add a small pure function near the existing Agent completion-presence helpers. It receives the completion payload plus optional session metadata and returns whether a user-facing task-complete notification is allowed.

The policy rejects completion notification when either condition is true:

1. `payload.triggeredBy === 'delegation'`; or
2. the session metadata has `sourceDelegationId`.

The metadata check is a compatibility fallback. The IPC origin is the primary source of truth and eliminates the race in which a child finishes before `agentSessionsAtom` has refreshed.

The existing success checks remain separate and unchanged: a notification is sent only when the completion is successful and no background tasks remain. All non-notification completion handling continues to run for delegated children.

## Data flow

```text
parent Agent delegates work
→ collaboration tool creates child session with sourceDelegationId
→ child run starts with triggeredBy = delegation
→ shared Agent service streams and persists child output
→ child run emits STREAM_COMPLETE(triggeredBy = delegation)
→ renderer notification policy rejects user-facing completion notice
→ renderer still finalizes child state and refreshes messages/sidebar
→ parent receives/waits for child result and continues
→ parent emits top-level STREAM_COMPLETE
→ existing success/background checks pass
→ one desktop notification and configured task-complete sound are emitted
```

## Error handling and compatibility

- Defensive completion payloads emitted from service catch blocks must preserve `triggeredBy`; otherwise an exceptional child run could regress to a false completion notification.
- `triggeredBy` remains optional for compatibility with older callers and stored type consumers.
- `sourceDelegationId` provides a renderer-side fallback when origin is absent.
- No notification-policy failure may block stream finalization, message refresh, or delegation bookkeeping.
- Existing suppression for stream errors, user stops, abnormal result subtypes, and `backgroundTasksPending` remains authoritative.

## Tests

BDD-focused tests will cover:

1. a normal top-level completion is eligible for notification;
2. a payload with `triggeredBy = delegation` is ineligible even if metadata has not loaded;
3. a payload without origin is ineligible when session metadata has `sourceDelegationId`;
4. automation and other non-delegation origins remain eligible for the existing completion policy;
5. the renderer combines origin policy with existing success and background-task conditions;
6. focused tests, affected package typechecks, the Electron build, and the relevant broader Bun test suite pass.

The regression test must be observed failing before production logic is changed, then passing after the minimum fix.

## Versioning and documentation

The change affects shared IPC types and the Electron application, so patch versions for `@proma/shared` and `@proma/electron` will be incremented according to repository policy. No dependency is added.

README and AGENTS documentation will not be changed: this is a bug fix restoring the existing user-facing meaning of “Agent task complete,” not a new setting, feature, or public workflow.

## Acceptance criteria

- Delegated child completion produces neither a desktop completion notification nor a task-complete sound.
- Parent conversation completion still produces exactly one configured completion notification/sound when currently eligible.
- Child session state, messages, sidebar status, and parent result flow remain intact.
- The implementation is race-safe when renderer session metadata is unavailable.
- Focused regression tests, typechecks, Electron build, independent code review, and PR checks pass.
- The PR contains no dependency change, unrelated refactor, or current-branch work from `fix/pi-context-compaction-recovery`.
