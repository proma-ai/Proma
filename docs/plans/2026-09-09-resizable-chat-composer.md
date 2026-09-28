# Resizable Chat Composer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** Give both Agent and Chat composers a WeChat-style top-edge drag resize with a compact minimum height, without a one-click expansion control.

**Architecture:** Keep TipTap document state untouched and resize only the visual editor region through one shared `useComposerResize` hook. Agent and Chat keep their existing markup and add only the hook refs, handle, and fixed-height style. The initial state remains content-driven; drag gestures set a clamped fixed height. The total maximum is the smaller of the real-layout allowance and 60% of the conversation viewport. One `ResizeObserver` watches the layout boundaries, while pointer moves write height directly to the DOM so dragging does not render React every frame. `RichTextInput.fillHeight` explicitly makes `EditorContent` and `.ProseMirror` fill the resized region.

**Tech Stack:** React 18, TypeScript, Jotai-based renderer architecture, Tailwind CSS, TipTap v3, Bun test runner.

---

### Task 1: Add deterministic composer sizing helpers

**Files:**
- Create: `apps/electron/src/renderer/components/ai-elements/composer-resize.ts`
- Test: `apps/electron/src/renderer/components/ai-elements/composer-resize.test.ts`

**Steps:**
1. Write failing tests for the compact minimum, the 60%-of-viewport maximum, and upward/downward drag deltas.
2. Run `bun test apps/electron/src/renderer/components/ai-elements/composer-resize.test.ts` and confirm the tests fail because helpers do not exist.
3. Implement pure functions that calculate editor height from measured frame/editor heights, with a 101px minimum editor region and a viewport-relative maximum.
4. Re-run the focused test and confirm all sizing cases pass.

### Task 2: Build the shared resize hook

**Files:**
- Create: `apps/electron/src/renderer/components/ai-elements/resizable-composer.tsx`

**Steps:**
1. Add a hook that owns frame/editor refs, starts from natural height, and exposes `onResizePointerDown` plus the persisted fixed height.
2. During pointer drag, use pointer capture and direct DOM height writes, disable text selection, show `row-resize`, temporarily disable backdrop blur/transition, and clean listeners on pointer-up, pointer-cancel, lost capture, window blur, and unmount.
3. Persist by Agent session ID or Chat conversation ID, reject invalid storage values, and re-clamp restored values before paint.
4. Cap frame height at the smaller of the real layout allowance and 60% of the conversation viewport; allow the chrome region to shrink and scroll before sacrificing the normal 101px editor minimum.
5. Use one observer for the composer viewport, message region, frame, editor, and footer so banners, attachments, queues, and window changes re-clamp without parallel state machines.

### Task 3: Integrate Agent and Chat composers

**Files:**
- Modify: `apps/electron/src/renderer/components/chat/ChatInput.tsx`
- Modify: `apps/electron/src/renderer/components/agent/AgentView.tsx`
- Modify: `apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx`

**Steps:**
1. Add frame and editor-region refs to both composer containers.
2. Render the shared top-edge drag target in both modes.
3. When a manual/fixed height is active, let `RichTextInput` fill the editor region and scroll internally; in natural mode preserve the existing auto-grow behavior.
4. Stop enabling the legacy long-content-only bottom-right collapse button in Agent mode to avoid duplicate controls; retain the generic prop for compatibility unless no call sites remain.
5. Increment `@proma/electron` patch version from `0.19.37` to `0.19.38`.

### Task 4: Verify behavior and regressions

**Files:**
- Verify all files above.

**Steps:**
1. Run the focused sizing tests.
2. Run `bun run --cwd apps/electron typecheck`.
3. Run `bun run --cwd apps/electron build:renderer`.
4. Run `git diff --check`.
5. Review the final diff for duplicated resize logic, leaked listeners, hard-coded colors, duplicate expansion controls, and accidental changes outside the composer feature.
6. Report the worktree path, changed files, exact validation results, and remaining runtime-only checks. Do not commit or open a PR until the user explicitly requests it.
