# Pi Persistent Goal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pi-native, session-scoped `/goal <task>` mode that persists the active goal across turns, automatically continues unfinished work, and stops on completion, explicit stop, or a safety limit.

**Architecture:** Register a small inline Pi extension factory from `PiAgentAdapter`. The extension owns goal state reconstruction, `/goal` command handling, the `goal_complete` tool, hidden per-turn context injection, and bounded follow-up turns. State is persisted as `proma-goal-state` entries in the existing Pi session transcript; no new database, IPC channel, or runtime dependency is introduced.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` 0.80.9, Bun test, esbuild.

## Global Constraints

- Use the existing Pi lifecycle; do not duplicate slash-command parsing in Proma.
- Keep the feature session-scoped; do not implement Scheduler, Cron, Monitor, or cross-session execution.
- Do not modify Claude Runtime behavior.
- Do not add dependencies or a new persistence service.
- Write comments and logs in Chinese where needed.
- Use BDD/TDD: write a failing test before production implementation.
- Preserve the existing Codex request-settings extension and existing retry/compaction behavior.
- Cap automatic continuation at 50 turns.

---

### Task 1: Add pure Goal state model and failing tests

**Files:**
- Create: `apps/electron/src/main/lib/adapters/pi-goal-extension.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts`

**Interfaces:**
- Produces `PromaGoalState`, `GOAL_STATE_ENTRY_TYPE`, `GOAL_MAX_TURNS`, and an exported `createPromaGoalExtension()` factory.
- The state helpers must be testable without starting an actual provider session.

- [ ] **Step 1: Write the failing test**

Create Bun tests covering the pure state contract:

```ts
import { describe, expect, test } from 'bun:test'
import {
  GOAL_MAX_TURNS,
  GOAL_STATE_ENTRY_TYPE,
  getLatestGoalState,
  type PromaGoalState,
} from './pi-goal-extension'

describe('Proma goal state', () => {
  test('uses the latest state entry on the current branch', () => {
    const active: PromaGoalState = {
      id: 'goal-1', task: 'ship feature', status: 'active', turnCount: 2,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:02:00.000Z',
    }
    const stopped = { ...active, status: 'stopped' as const, updatedAt: '2026-07-22T00:03:00.000Z' }
    const branch = [
      { type: 'custom' as const, customType: 'other', data: {} },
      { type: 'custom' as const, customType: GOAL_STATE_ENTRY_TYPE, data: active },
      { type: 'custom' as const, customType: GOAL_STATE_ENTRY_TYPE, data: stopped },
    ]
    expect(getLatestGoalState(branch)).toEqual(stopped)
  })

  test('defines a finite continuation limit', () => {
    expect(GOAL_MAX_TURNS).toBe(50)
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts
```

Expected: FAIL because the new module and exports do not exist.

- [ ] **Step 3: Implement the minimal pure state model**

Define the state interface, entry type, limit, and `getLatestGoalState(branch)` by scanning the current branch from oldest to newest and accepting only valid `proma-goal-state` payloads. Keep malformed entries ignored rather than throwing during session resume.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the same Bun test. Expected: PASS with zero failures.

- [ ] **Step 5: Commit the focused state model**

```bash
git add apps/electron/src/main/lib/adapters/pi-goal-extension.ts apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts
git commit -m "feat(pi): add persistent goal state model"
```

### Task 2: Implement the Pi Goal extension behavior

**Files:**
- Modify: `apps/electron/src/main/lib/adapters/pi-goal-extension.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts`

**Interfaces:**
- `createPromaGoalExtension(): import('@earendil-works/pi-coding-agent').ExtensionFactory`
- Registers command `goal` and custom tool `goal_complete`.
- Persists state using `pi.appendEntry(GOAL_STATE_ENTRY_TYPE, state)`.

- [ ] **Step 1: Add failing command/tool behavior tests**

Use a small fake `ExtensionAPI`/session context harness that captures registered commands, tools, lifecycle handlers, appended entries, and sent messages. Cover:

```ts
test('/goal <task> creates an active goal and triggers the initial turn')
test('/goal stop is idempotent and prevents follow-up turns')
test('goal_complete marks the active goal completed')
test('agent_end queues follow-up only for an active goal below the limit')
test('the limit transitions an active goal to max_turns without queuing another turn')
```

Each test must fail before the extension behavior exists.

- [ ] **Step 2: Run the focused tests and verify the expected failures**

```bash
bun test apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts
```

Expected: the behavior tests fail while the Task 1 state tests remain passing.

- [ ] **Step 3: Implement command, tool, and lifecycle handlers**

Implement the following behavior:

- `/goal <task>` creates a new active state, persists it, and calls `pi.sendUserMessage()` with an explicit execution contract.
- `/goal stop` persists `stopped`; repeated stop does not throw or start a turn.
- Empty/unknown arguments use `ctx.ui.notify()` when available and otherwise emit a safe command error without calling the model.
- `session_start` and `session_tree` reconstruct the latest state from `ctx.sessionManager.getBranch()`.
- `before_agent_start` returns a hidden context message containing the task, ID, current turn, completion requirement, and stop condition.
- `goal_complete` accepts only a completion summary, persists `completed`, and returns a text result with state details.
- `agent_end` increments and persists the turn count, then sends one `followUp` with `triggerTurn: true` while active and below 50; it does nothing for completed, stopped, or max-turn states.
- At the limit, persist `max_turns` and emit a visible bounded-stop message through the Pi message API.

Use a per-extension `continuationQueued` guard so one `agent_end` cannot enqueue duplicate follow-ups.

- [ ] **Step 4: Run the focused tests to verify they pass**

```bash
bun test apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the extension behavior**

```bash
git add apps/electron/src/main/lib/adapters/pi-goal-extension.ts apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts
git commit -m "feat(pi): add persistent goal extension"
```

### Task 3: Load the extension from PiAgentAdapter

**Files:**
- Modify: `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts` (create if no suitable existing adapter test seam exists)

**Interfaces:**
- `DefaultResourceLoader.extensionFactories` receives the Goal factory plus the existing Codex request settings factory when applicable.
- No change to `createAgentSession` custom tools, retry, compaction, or message conversion.

- [ ] **Step 1: Add a failing wiring test or deterministic source-level seam test**

Refactor the extension factory list into a small exported/internal helper that accepts the provider and Codex fast-mode inputs. Test that Pi sessions always include the Goal factory and Codex sessions retain the request-settings factory without replacing it.

- [ ] **Step 2: Run the focused adapter test and verify it fails**

```bash
bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts
```

Expected: FAIL because the Goal factory is not included.

- [ ] **Step 3: Wire the Goal factory into `DefaultResourceLoader`**

Import `createPromaGoalExtension` and set `extensionFactories` to an array containing it plus the conditional existing Codex settings extension. Preserve current `noSkills`, `skillsOverride`, `systemPromptOverride`, and remote connection settings unchanged.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts
bun run typecheck
```

Expected: both test commands and typecheck exit 0.

- [ ] **Step 5: Commit the adapter wiring**

```bash
git add apps/electron/src/main/lib/adapters/pi-agent-adapter.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts
 git commit -m "feat(pi): load goal extension in Proma sessions"
```

### Task 4: Build verification and documentation/version alignment

**Files:**
- Modify: `apps/electron/package.json` only if the affected package patch version must be incremented by repository policy.
- Modify: `README.md` only if the current feature list documents Pi capabilities and needs the new session-scoped Goal behavior.
- Modify: `CLAUDE.md`/`AGENTS.md` only with explicit user approval; otherwise do not touch them.

- [ ] **Step 1: Inspect the final diff and package version policy**

```bash
git diff --stat HEAD~3..HEAD
git diff --check
git status --short
```

Confirm no unrelated files or generated artifacts are included.

- [ ] **Step 2: Run affected checks**

```bash
bun test apps/electron/src/main/lib/adapters/pi-goal-extension.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts
bun run typecheck
bun run --filter='@proma/electron' build:main
```

Expected: all commands exit 0. If the repository has unrelated baseline failures, record them separately instead of masking them.

- [ ] **Step 3: Review behavior against the approved spec**

Check explicitly: command parsing, transcript persistence, resume/tree reconstruction, hidden context, completion, stop, max-turn guard, adapter wiring, no Claude changes, and no new dependency.

- [ ] **Step 4: Commit any narrowly required docs/version change**

Use a package-specific patch commit only if repository policy requires it for the actual changed package; do not modify instruction files without separate approval.

### Task 5: Independent review and PR preparation

**Files:**
- No production file changes unless review identifies a critical or important issue.
- Create/update: PR description outside the repository or via GitHub CLI/browser as authorized.

- [ ] **Step 1: Capture the final revision and request an independent code review**

```bash
BASE_SHA=$(git merge-base HEAD origin/main)
HEAD_SHA=$(git rev-parse HEAD)
printf '%s\n%s\n' "$BASE_SHA" "$HEAD_SHA"
```

Dispatch a fresh reviewer with the approved spec, changed paths, test commands, and these two SHAs. Resolve all critical/important findings before pushing.

- [ ] **Step 2: Re-run fresh verification after review fixes**

Run the full affected test, typecheck, and main build commands again on the final revision.

- [ ] **Step 3: Push to the authorized fork and create the PR**

```bash
git push -u fork feat/pi-goal-mode
```

Create a PR from `rongyulin3:feat/pi-goal-mode` into `proma-ai/Proma:main` with:

- Problem: `/goal` is not registered in Proma's Pi runtime.
- Solution: session-scoped Pi inline extension with transcript persistence and bounded follow-up turns.
- Scope: Pi runtime only; no Scheduler/Cron/Claude changes.
- Verification: exact passing commands and results.
- Safety: `/goal stop` and 50-turn cap.

Do not claim the feature is released; report the PR URL and review/CI state.

## Execution stop conditions

Stop and report `blocked` if the source branch changes unexpectedly, the fork credentials are unavailable, the PR target is ambiguous, or tests/build reveal a failure that needs a design change. Do not broaden scope silently.
