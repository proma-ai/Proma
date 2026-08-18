# Windows First-Login Black Flash Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent the commercial Electron app from briefly rendering a black/invalid main window after a new Cloud user logs in on Windows.

**Architecture:** Treat the pre-login and post-login renderer settings loads as versioned snapshots so an older asynchronous response cannot overwrite the authenticated account's official channel and Agent defaults. Reset the Agent settings readiness barrier whenever the Cloud user changes, and provide stable document/window background colors so a compositor frame never falls back to Chromium black during the transition.

**Tech Stack:** Electron 43, React 18, Jotai, TypeScript, Vite, Bun tests.

---

### Task 1: Close the first-login settings race

**Files:**
- Modify: `apps/electron/src/renderer/main.tsx` in `AgentSettingsInitializer`
- Test: existing Electron renderer tests plus a focused static/type verification

**Steps:**
1. Add a monotonically increasing load version ref and ignore stale `listChannels`, `getSettings`, and `listAgentWorkspaces` responses.
2. Reset `agentSettingsReadyAtom` to `false` when the authenticated Cloud user changes, so the next settings snapshot cannot be treated as ready.
3. Keep the existing channel/model resolution behavior unchanged for the latest snapshot.
4. Run the focused test/type checks.

### Task 2: Remove compositor black fallback

**Files:**
- Modify: `apps/electron/src/main/index.ts` in the main `BrowserWindow` options
- Modify: `apps/electron/src/renderer/styles/globals.css` for `html`, `body`, and `#root` base sizing/background

**Steps:**
1. Set an explicit dark default `backgroundColor` on the main window, matching the default cached theme and preventing transparent/black Chromium fallback frames.
2. Make the document and root fill the viewport and use the theme background token as a CSS fallback.
3. Ensure authentication layout and the existing theme class still override the fallback correctly.
4. Run the renderer build and typecheck.

### Task 3: Verify the regression surface

**Files:**
- No new production files unless verification exposes a missing contract.

**Steps:**
1. Run focused tests around renderer recovery/auth-related behavior.
2. Run `bun run typecheck` and `bun run build:renderer` from `apps/electron`.
3. Inspect the final diff and confirm no unrelated user changes were touched.
