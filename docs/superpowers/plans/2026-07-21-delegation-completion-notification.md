# Delegation Completion Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep delegated child Agent completions completely silent while preserving one existing completion notification and sound for an eligible top-level parent conversation.

**Architecture:** Reuse `AgentSendInput.triggeredBy` as the authoritative run origin, propagate it through every `STREAM_COMPLETE` payload, and centralize the renderer notification decision in a pure helper with a `sourceDelegationId` compatibility fallback. Leave all non-notification stream finalization paths unchanged so child state and parent result delivery continue normally.

**Tech Stack:** TypeScript, Electron IPC, React/Jotai renderer state, Bun test runner, Bun workspace scripts.

## Global Constraints

- Delegated child completion must produce neither a desktop completion notification nor a task-complete sound.
- Parent completion retains the existing success, error, stop, and `backgroundTasksPending` behavior.
- Claude and Pi runtimes must share the same result because the fix belongs above both adapters.
- Preserve child streaming state, persisted messages, sidebar state, completion markers, and delegation result delivery.
- Add no dependency, setting, IPC channel, unrelated refactor, or README/AGENTS change.
- Increment `@proma/shared` from `0.1.42` to `0.1.43` and `@proma/electron` from `0.15.7` to `0.15.8`.
- Work only in `/Users/rongyulin/Desktop/vibe_projects/Proma/.worktrees/delegation-completion-notification` on `fix/delegation-completion-notification`.

---

## File map

- `packages/shared/src/types/agent.ts`: extend the existing completion IPC contract with the optional run origin.
- `packages/shared/package.json`: patch-version bump for the shared IPC type change.
- `apps/electron/src/main/lib/agent-completion-payload.ts`: pure builder that attaches `sessionId` and `triggeredBy` consistently to completion payloads.
- `apps/electron/src/main/lib/agent-completion-payload.test.ts`: BDD regression coverage for authoritative run-origin propagation.
- `apps/electron/src/main/lib/agent-service.ts`: route all normal and defensive `STREAM_COMPLETE` sends through the builder.
- `apps/electron/src/renderer/lib/agent-completion-presence.ts`: pure user-facing completion-notification policy alongside existing completion-presence policy.
- `apps/electron/src/renderer/lib/agent-completion-presence.test.ts`: BDD coverage for delegation silence and compatibility fallback.
- `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts`: apply notification eligibility without changing the remaining completion flow.
- `apps/electron/package.json`: patch-version bump for the Electron behavior fix.

---

### Task 1: Preserve run origin in every completion IPC payload

**Files:**
- Create: `apps/electron/src/main/lib/agent-completion-payload.ts`
- Create: `apps/electron/src/main/lib/agent-completion-payload.test.ts`
- Modify: `packages/shared/src/types/agent.ts:1106-1120`
- Modify: `packages/shared/package.json:2-4`
- Modify: `apps/electron/src/main/lib/agent-service.ts:150-300`

**Interfaces:**
- Consumes: `AgentSendInput.triggeredBy?: 'user' | 'automation' | 'delegation'`.
- Produces: `AgentStreamCompletePayload.triggeredBy?: AgentSendInput['triggeredBy']`.
- Produces: `buildAgentStreamCompletePayload(run, details): AgentStreamCompletePayload`.

- [ ] **Step 1: Write the failing origin-propagation test**

Create `apps/electron/src/main/lib/agent-completion-payload.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildAgentStreamCompletePayload } from './agent-completion-payload'

describe('Agent 完成载荷来源', () => {
  test('Given 委派子会话 When 构建完成载荷 Then 保留 delegation 来源', () => {
    expect(buildAgentStreamCompletePayload(
      { sessionId: 'child-1', triggeredBy: 'delegation' },
      { stoppedByUser: false, startedAt: 100 },
    )).toEqual({
      sessionId: 'child-1',
      triggeredBy: 'delegation',
      stoppedByUser: false,
      startedAt: 100,
    })
  })

  test('Given 普通历史调用未提供来源 When 构建完成载荷 Then 保持字段可选', () => {
    expect(buildAgentStreamCompletePayload(
      { sessionId: 'parent-1' },
      { messages: [] },
    )).toEqual({
      sessionId: 'parent-1',
      triggeredBy: undefined,
      messages: [],
    })
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd /Users/rongyulin/Desktop/vibe_projects/Proma/.worktrees/delegation-completion-notification
bun test apps/electron/src/main/lib/agent-completion-payload.test.ts
```

Expected: FAIL because `./agent-completion-payload` does not exist.

- [ ] **Step 3: Extend the shared completion payload type**

Add this field to `AgentStreamCompletePayload` immediately after `sessionId`:

```ts
  /** 触发来源：用于区分顶层会话与父 Agent 委派的子会话完成 */
  triggeredBy?: AgentSendInput['triggeredBy']
```

- [ ] **Step 4: Implement the pure payload builder**

Create `apps/electron/src/main/lib/agent-completion-payload.ts`:

```ts
import type {
  AgentSendInput,
  AgentStreamCompletePayload,
} from '@proma/shared'

export type AgentStreamCompletionDetails = Omit<
  AgentStreamCompletePayload,
  'sessionId' | 'triggeredBy'
>

export function buildAgentStreamCompletePayload(
  run: Pick<AgentSendInput, 'sessionId' | 'triggeredBy'>,
  details: AgentStreamCompletionDetails = {},
): AgentStreamCompletePayload {
  return {
    sessionId: run.sessionId,
    triggeredBy: run.triggeredBy,
    ...details,
  }
}
```

- [ ] **Step 5: Route every service completion send through the builder**

Import the helper in `apps/electron/src/main/lib/agent-service.ts`:

```ts
import { buildAgentStreamCompletePayload } from './agent-completion-payload'
```

Replace the normal interactive completion payload with:

```ts
webContents.send(
  AGENT_IPC_CHANNELS.STREAM_COMPLETE,
  buildAgentStreamCompletePayload(input, {
    messages,
    stoppedByUser: opts?.stoppedByUser ?? false,
    startedAt: opts?.startedAt,
    resultSubtype: opts?.resultSubtype,
    resultErrors: opts?.resultErrors,
    backgroundTasksPending: opts?.backgroundTasksPending,
  }),
)
```

Replace the interactive catch payload with:

```ts
webContents.send(
  AGENT_IPC_CHANNELS.STREAM_COMPLETE,
  buildAgentStreamCompletePayload(input, {
    messages: [],
    stoppedByUser: false,
  }),
)
```

Replace the normal headless completion payload with:

```ts
wc.send(
  AGENT_IPC_CHANNELS.STREAM_COMPLETE,
  buildAgentStreamCompletePayload(runInput, {
    messages,
    stoppedByUser: opts?.stoppedByUser ?? false,
    startedAt: opts?.startedAt,
    resultSubtype: opts?.resultSubtype,
    resultErrors: opts?.resultErrors,
    backgroundTasksPending: opts?.backgroundTasksPending,
  }),
)
```

Replace the headless catch payload with:

```ts
wc.send(
  AGENT_IPC_CHANNELS.STREAM_COMPLETE,
  buildAgentStreamCompletePayload(runInput, {
    messages: [],
    stoppedByUser: false,
    startedAt,
  }),
)
```

- [ ] **Step 6: Verify GREEN and type safety**

Run:

```bash
bun test apps/electron/src/main/lib/agent-completion-payload.test.ts
bun run --filter='@proma/shared' typecheck
bun run --filter='@proma/electron' typecheck
```

Expected: both tests pass; both typechecks exit 0.

- [ ] **Step 7: Bump the shared package patch version and commit**

Change `packages/shared/package.json`:

```json
"version": "0.1.43"
```

Then run and commit:

```bash
git diff --check
git add packages/shared/src/types/agent.ts packages/shared/package.json \
  apps/electron/src/main/lib/agent-completion-payload.ts \
  apps/electron/src/main/lib/agent-completion-payload.test.ts \
  apps/electron/src/main/lib/agent-service.ts
git commit -m "fix(agent): preserve completion run origin"
```

Expected: one focused commit with no renderer behavior change yet.

---

### Task 2: Suppress delegated child completion notifications

**Files:**
- Modify: `apps/electron/src/renderer/lib/agent-completion-presence.ts`
- Modify: `apps/electron/src/renderer/lib/agent-completion-presence.test.ts`
- Modify: `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts:962-993`
- Modify: `apps/electron/package.json:2-4`

**Interfaces:**
- Consumes: `AgentStreamCompletePayload.triggeredBy` from Task 1.
- Consumes: optional `Pick<AgentSessionMeta, 'sourceDelegationId'>` compatibility metadata.
- Produces: `shouldNotifyAgentCompletion(input): boolean`.

- [ ] **Step 1: Add failing BDD tests for the notification boundary**

Extend imports in `apps/electron/src/renderer/lib/agent-completion-presence.test.ts`:

```ts
import {
  getAgentCompletionMarkers,
  isAgentSessionActiveForCompletion,
  shouldNotifyAgentCompletion,
} from './agent-completion-presence'
```

Append:

```ts
describe('Agent 完成通知边界', () => {
  test('Given 顶层会话成功完成 When 判断通知资格 Then 允许提醒', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { sessionId: 'parent-1', triggeredBy: 'user' },
    })).toBe(true)
  })

  test('Given 委派子会话快速完成且 metadata 尚未加载 When 判断通知资格 Then 完全静默', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { sessionId: 'child-1', triggeredBy: 'delegation' },
    })).toBe(false)
  })

  test('Given 旧完成载荷缺少来源但 metadata 标记为委派 When 判断通知资格 Then 完全静默', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { sessionId: 'child-legacy' },
      session: { sourceDelegationId: 'delegation-1' },
    })).toBe(false)
  })

  test('Given 自动任务完成 When 判断通知资格 Then 不误判为委派', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { sessionId: 'automation-1', triggeredBy: 'automation' },
    })).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test apps/electron/src/renderer/lib/agent-completion-presence.test.ts
```

Expected: FAIL because `shouldNotifyAgentCompletion` is not exported.

- [ ] **Step 3: Implement the minimum pure notification policy**

Add the shared type imports and policy to `agent-completion-presence.ts`:

```ts
import type {
  AgentSessionMeta,
  AgentStreamCompletePayload,
} from '@proma/shared'

export interface AgentCompletionNotificationInput {
  completion: AgentStreamCompletePayload
  session?: Pick<AgentSessionMeta, 'sourceDelegationId'>
}

/** 仅顶层 Agent 会话完成属于用户级任务完成提醒边界 */
export function shouldNotifyAgentCompletion({
  completion,
  session,
}: AgentCompletionNotificationInput): boolean {
  return completion.triggeredBy !== 'delegation' && !session?.sourceDelegationId
}
```

Keep the existing `TabItem` import and completion-marker functions unchanged.

- [ ] **Step 4: Apply the policy only to the desktop-notification branch**

Update the helper import in `useGlobalAgentListeners.ts`:

```ts
import {
  getAgentCompletionMarkers,
  shouldNotifyAgentCompletion,
} from '@/lib/agent-completion-presence'
```

Before the existing notification `if`, resolve the current metadata and eligibility:

```ts
const completionSession = store.get(agentSessionsAtom)
  .find((session) => session.id === data.sessionId)
const shouldNotifyCompletion = shouldNotifyAgentCompletion({
  completion: data,
  session: completionSession,
})
```

Change only the notification guard:

```ts
if (!backgroundTasksPending && isSuccessfulCompletion && shouldNotifyCompletion) {
```

Do not place the remaining stream finalization, completion-marker, message-refresh, or sidebar logic inside this guard.

- [ ] **Step 5: Verify GREEN and focused behavior**

Run:

```bash
bun test \
  apps/electron/src/main/lib/agent-completion-payload.test.ts \
  apps/electron/src/renderer/lib/agent-completion-presence.test.ts
bun run --filter='@proma/electron' typecheck
```

Expected: all tests in both focused files pass with 0 failures; typecheck exits 0.

- [ ] **Step 6: Bump the Electron package patch version and commit**

Change `apps/electron/package.json`:

```json
"version": "0.15.8"
```

Then run and commit:

```bash
git diff --check
git add apps/electron/package.json \
  apps/electron/src/renderer/lib/agent-completion-presence.ts \
  apps/electron/src/renderer/lib/agent-completion-presence.test.ts \
  apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts
git commit -m "fix(agent): silence delegated completion notifications"
```

Expected: one renderer-policy commit; no change to child completion state handling.

---

### Task 3: Verify, independently review, and prepare the upstream PR

**Files:**
- Review only: all files changed since `origin/main`
- Create outside Git history: `/tmp/proma-delegation-completion-pr-body.md`
- Create outside Git history: session-scoped developer/QA evidence artifacts

**Interfaces:**
- Consumes: the two implementation commits from Tasks 1 and 2.
- Produces: fresh verification evidence, independent review disposition, revision-pinned QA result, pushed fork branch, and upstream PR URL.

- [ ] **Step 1: Run focused regression tests**

```bash
bun test \
  apps/electron/src/main/lib/agent-completion-payload.test.ts \
  apps/electron/src/renderer/lib/agent-completion-presence.test.ts
```

Expected: all tests pass with 0 failures.

- [ ] **Step 2: Run package typechecks and the Electron build**

```bash
bun run --filter='@proma/shared' typecheck
bun run --filter='@proma/electron' typecheck
bun run electron:build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the repository-wide Bun test suite**

```bash
bun test
```

Expected: 0 failures. If a pre-existing environment-dependent failure appears, record the exact test and prove it is unchanged from `origin/main`; do not call the suite passing.

- [ ] **Step 4: Inspect the complete diff and version scope**

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- \
  packages/shared/src/types/agent.ts \
  packages/shared/package.json \
  apps/electron/package.json \
  apps/electron/src/main/lib/agent-completion-payload.ts \
  apps/electron/src/main/lib/agent-completion-payload.test.ts \
  apps/electron/src/main/lib/agent-service.ts \
  apps/electron/src/renderer/lib/agent-completion-presence.ts \
  apps/electron/src/renderer/lib/agent-completion-presence.test.ts \
  apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts
```

Expected: only the approved design document, plan, shared payload contract/builder, renderer notification policy, service wiring, tests, and two patch version bumps appear.

- [ ] **Step 5: Request independent code review and resolve findings**

Give the reviewer:

```text
Requirement: delegated child completions must emit no desktop completion notification or sound; eligible top-level parent completions retain existing behavior.
Base: origin/main
Head: current HEAD
Review priorities: every STREAM_COMPLETE exit preserves triggeredBy; metadata race is covered; no child state/finalization path is skipped; automation/bridge sessions are not silenced; tests genuinely cover the regression.
```

Expected: no unresolved Critical or Important finding. Any code change made for a finding must receive a focused failing test when it changes behavior, then repeat Steps 1-4.

- [ ] **Step 6: Perform revision-pinned independent QA**

QA acceptance criteria:

```text
1. A synthetic/controlled completion with triggeredBy=delegation produces no completion notification call.
2. A top-level successful completion remains eligible for exactly one notification call.
3. Delegated child completion still finalizes stream state and completion markers outside the notification guard.
4. The tested revision equals the final pushed revision.
```

Expected: QA accepts the same revision that will be pushed. If desktop runtime instrumentation is unavailable, mark runtime sound playback as unverified rather than substituting developer confidence; retain unit-level evidence for the notification-call boundary.

- [ ] **Step 7: Create or reuse the authenticated fork and push the branch**

```bash
gh repo view rongyulin3/Proma >/dev/null 2>&1 || gh repo fork proma-ai/Proma --clone=false
if ! git remote get-url fork >/dev/null 2>&1; then
  git remote add fork https://github.com/rongyulin3/Proma.git
fi
git push -u fork fix/delegation-completion-notification
```

Expected: branch is available as `rongyulin3:fix/delegation-completion-notification`; no force push.

- [ ] **Step 8: Create the upstream PR**

Write `/tmp/proma-delegation-completion-pr-body.md`:

```markdown
## Summary

- preserve each Agent run's `triggeredBy` origin in completion IPC payloads
- keep delegated child completions completely silent while retaining their normal state/message finalization
- add race-safe BDD coverage with a `sourceDelegationId` compatibility fallback

## Root cause

Visible collaboration children complete through the same global `STREAM_COMPLETE` handler as top-level conversations, but the completion payload dropped `triggeredBy`. The renderer therefore treated child milestones as user-level task completion and played the configured completion sound.

## Test plan

- `bun test apps/electron/src/main/lib/agent-completion-payload.test.ts apps/electron/src/renderer/lib/agent-completion-presence.test.ts`
- `bun run --filter='@proma/shared' typecheck`
- `bun run --filter='@proma/electron' typecheck`
- `bun run electron:build`
- `bun test`
```

Create the PR:

```bash
gh pr create \
  --repo proma-ai/Proma \
  --base main \
  --head rongyulin3:fix/delegation-completion-notification \
  --title "fix(agent): silence delegated completion notifications" \
  --body-file /tmp/proma-delegation-completion-pr-body.md
```

Expected: an open PR URL targeting `proma-ai/Proma:main`.

- [ ] **Step 9: Check upstream CI and report exact status**

```bash
gh pr checks --repo proma-ai/Proma --watch
```

Expected: report every check result. If checks are still pending at the bounded wait limit or fail for an upstream/environmental reason, leave the PR open and report the exact state without claiming merge readiness.
