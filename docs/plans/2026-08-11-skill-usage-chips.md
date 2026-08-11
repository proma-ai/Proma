# Skill Usage Chips Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist successful Skill activations per Agent turn and render them as compact chips in the completed turn footer alongside file-change chips.

**Architecture:** Treat Skill activation as turn metadata rather than a new conversational message. Explicit `/skill:<name>` prompt expansion reports successful `SKILL.md` loads from the Pi adapter; ordinary `Read` calls targeting `skills/<slug>/SKILL.md` are detected from SDK messages. The orchestrator deduplicates both sources and attaches the result to the terminal SDK result message, so live and reloaded history use the same data contract. The renderer reads that metadata and displays a footer summary without changing process-group collapse behavior.

**Tech Stack:** Electron main process, Pi Agent adapter, React 18, Jotai, TypeScript, Vitest, Tailwind/shadcn primitives.

---

### Task 1: Define and test Skill activation metadata

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/utils/index.ts`
- Create: `packages/shared/src/utils/skill-usage.ts`
- Create: `packages/shared/src/utils/skill-usage.test.ts`
- Modify: `packages/shared/package.json` (patch version)

**Steps:**
1. Add a small `SkillActivation` contract with stable `slug`, display `name`, and source (`explicit` or `read`). Add optional `skill_activations` metadata to `SDKResultMessage`.
2. Add shared helpers to extract a Skill slug from a normalized `skills/<slug>/SKILL.md` path and merge/deduplicate activations without exposing absolute paths.
3. Write tests for POSIX/Windows paths, invalid paths, deduplication, and source merging.
4. Run the shared utility test before implementation and then after implementation.

### Task 2: Capture activations in the Pi adapter and orchestrator

**Files:**
- Modify: `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`
- Modify: `apps/electron/src/main/lib/agent-orchestrator.ts`
- Modify: `apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts` or the nearest existing adapter test location

**Steps:**
1. Add an optional adapter callback for successful explicit Skill expansion. Invoke it only after the Skill file has been read and formatted successfully.
2. In the orchestrator, collect callback activations for the current run and detect successful Skill reads from assistant `tool_use` blocks before the terminal result arrives.
3. Attach the deduplicated activation list to the terminal result message before it is emitted and accumulated for persistence. Keep failures and unresolved mentions out of the success list.
4. Preserve metadata through normal completion, error results, and the existing partial persistence/recovery path.
5. Add focused tests for explicit expansion reporting and read-path extraction/aggregation.

### Task 3: Render the completed turn Skill summary

**Files:**
- Create: `apps/electron/src/renderer/components/agent/TurnSkillUsageSummary.tsx`
- Modify: `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx`
- Modify: `apps/electron/src/renderer/components/ai-elements/message.tsx` or add a small reusable Skill chip primitive if needed
- Create or modify: focused renderer test for Skill summary aggregation

**Steps:**
1. Build a footer component that extracts `skill_activations` from the turn result messages, falls back to successful Skill `Read` blocks for older history, and deduplicates by slug.
2. Render a `Sparkles`-based Skill chip with the existing Skill mention color language and a tooltip explaining that the Skill was loaded into the turn context.
3. Place the summary next to the existing `TurnFileChangesSummary`, only after streaming completes; do not add a second conversational message or prevent process collapse.
4. Cover empty, duplicate, mixed-source, and historical Read-only cases in tests.

### Task 4: Version and validate

**Files:**
- Modify: `apps/electron/package.json` (patch version if main/renderer code changes require it)
- Modify: `packages/shared/package.json` (patch version)

**Steps:**
1. Run formatting/typecheck and the focused shared, adapter, and renderer tests using Bun scripts defined by the repository.
2. Inspect the final diff for unrelated changes and verify the feature worktree remains clean apart from the intended implementation.
3. Report the exact worktree path, tests run, and any environment-limited checks.
