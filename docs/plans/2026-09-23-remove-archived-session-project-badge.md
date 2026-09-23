# Remove Archived Session Row Project Badge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the legacy workspace-name badge from archived Agent-session rows while preserving the local-project status badge on archived project group headers.

**Architecture:** Archived Agent sessions are grouped by workspace in `LeftSidebar.tsx` through `groupArchivedAgentSessionsByProject`. Each archived session row is rendered by `AgentSessionItem`, which can show a `workspaceName` badge for cross-project or synthetic lists. In the archived project-group view that badge duplicates the group header's project name and is a leftover from the pre-grouped archive layout. Remove only the archived-row `workspaceName` props and restore/retain the header's `LocalProjectBadge`; active and automation views keep their existing behavior.

**Tech Stack:** Electron, React, TypeScript, Tailwind CSS, Bun workspace.

---

### Task 1: Correct the archived-session badge scope

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`
- Test: `bun build apps/electron/scripts/rebuild-node-pty.ts --target bun --outdir <temporary-dir>`
- Test: `git diff --check`

**Step 1: Confirm the scoped render paths**

Verify that `agentArchivedVirtualRows` renders the archived Agent-session project header and its session rows, while `AgentSessionItem` renders the legacy `workspaceName` badge.

Run:

```bash
grep -n -A12 -B8 'agent-archived-project' apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
grep -n -A15 -B8 'workspaceName &&' apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
```

**Step 2: Restore the archived project-header badge**

Keep `LocalProjectBadge` beside the archived project group label so the local-project status indicator remains available at the project level.

**Step 3: Remove only legacy archived-row workspace badges**

In `agentArchivedVirtualRows`, stop passing `workspaceName` to the archived parent `AgentSessionItem` and archived `DelegatedChildSessionItem`. Do not alter the active project rows or the synthetic automation group, where the badge still communicates the session's source workspace.

**Step 4: Run focused static validation**

Run:

```bash
bun build apps/electron/scripts/rebuild-node-pty.ts --target bun --outdir <temporary-dir>
git diff --check
```

Expected: The script bundles successfully and the focused UI diff has no whitespace errors.

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx docs/plans/2026-09-23-remove-archived-session-project-badge.md
git commit -m "fix: remove archived session workspace badge" \
  -m "Made-with: Proma"
```

This corrective commit intentionally follows the earlier mistaken commit so the branch history remains auditable; it restores the project-header badge and removes only the badge shown on archived session rows.