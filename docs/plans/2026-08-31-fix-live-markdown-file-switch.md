# LiveMarkdown File Switch Rendering Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure project Markdown files fully enter Live Preview immediately after switching files, without requiring a click, and render authorized relative local images.

**Architecture:** Treat CodeMirror syntax-tree identity changes as decoration invalidations, so heading metadata and hidden Markdown markers rebuild when background parsing advances. Resolve local Markdown image paths relative to the displayed Markdown file, then reuse the existing token-gated `resolveFilePath` IPC boundary.

**Tech Stack:** React 18, CodeMirror 6, ink-mde, Bun test, Electron preload IPC.

---

### Task 1: Encode decoration invalidation policy

**Files:**
- Create: `apps/electron/src/renderer/components/markdown/live-markdown-lifecycle.ts`
- Test: `apps/electron/src/renderer/components/markdown/live-markdown-lifecycle.test.ts`
- Modify: `apps/electron/src/renderer/components/markdown/LiveMarkdownEditor.tsx`

**Step 1: Write the failing test**

Add BDD cases proving a syntax-tree change invalidates decorations even when the document, selection, and focus are unchanged, while a fully unchanged transaction remains cached.

**Step 2: Run test to verify it fails**

Run: `bun test apps/electron/src/renderer/components/markdown/live-markdown-lifecycle.test.ts`
Expected: FAIL because the invalidation helper does not exist.

**Step 3: Write minimal implementation**

Add a small pure invalidation helper and update both `markdownHeadingMarkers` and `markdownSyntaxVisibilityField` to compare `syntaxTree(transaction.startState)` with `syntaxTree(transaction.state)`. Rebuild when that identity changes.

**Step 4: Run test to verify it passes**

Run: `bun test apps/electron/src/renderer/components/markdown/live-markdown-lifecycle.test.ts`
Expected: PASS.

### Task 2: Resolve relative project Markdown images

**Files:**
- Create: `apps/electron/src/renderer/components/markdown/live-markdown-media.ts`
- Test: `apps/electron/src/renderer/components/markdown/live-markdown-media.test.ts`
- Modify: `apps/electron/src/renderer/components/diff/DiffTabContent.tsx`

**Step 1: Write the failing test**

Cover POSIX absolute Markdown paths, nested relative Markdown paths, Windows paths, URI-decoded media names, candidate fallback, and null when no candidate resolves.

**Step 2: Run test to verify it fails**

Run: `bun test apps/electron/src/renderer/components/markdown/live-markdown-media.test.ts`
Expected: FAIL because the resolver helper does not exist.

**Step 3: Write minimal implementation**

Build media candidates relative to the current Markdown document and call a supplied async resolver in order. In `DiffTabContent`, adapt that helper to `window.electronAPI.resolveFilePath(candidate, fileAccess)` and pass it as `resolveImageSrc` to `LiveMarkdownEditor`.

**Step 4: Run test to verify it passes**

Run: `bun test apps/electron/src/renderer/components/markdown/live-markdown-media.test.ts`
Expected: PASS.

### Task 3: Version and validate

**Files:**
- Modify: `apps/electron/package.json`

**Step 1: Bump package patch version**

Change `@proma/electron` from `0.19.6` to `0.19.7` per repository policy.

**Step 2: Run focused tests**

Run: `bun test apps/electron/src/renderer/components/markdown/live-markdown-lifecycle.test.ts apps/electron/src/renderer/components/markdown/live-markdown-media.test.ts`
Expected: all PASS.

**Step 3: Run typecheck**

Run: `bun run --cwd apps/electron typecheck`
Expected: exit 0.

**Step 4: Review diff**

Run: `git status --short && git diff --check && git diff --stat && git diff`
Expected: only the planned files change; no whitespace errors.
