# Unified OAuth Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route every Pi OAuth back-channel request through Proma’s request-scoped application proxy while preserving external-browser OAuth and providing Codex device-code fallback.

**Architecture:** Reuse the existing AsyncLocalStorage dispatcher router for a short-lived OAuth scope rather than copying provider OAuth protocols. The main process resolves the app proxy once per OAuth operation, scopes `ModelRuntime.login()` / `getAuth()` to it, and always closes the dispatcher. Browser authorization remains external; Codex device-code exposes a QR-capable fallback for browsers that cannot use the app proxy.

**Tech Stack:** Electron main/preload/renderer, TypeScript, Bun tests, undici, Pi `ModelRuntime`, qrcode.

---

### Task 1: Add a managed OAuth proxy scope

**Files:**
- Modify: `apps/electron/src/main/lib/adapters/pi-request-proxy.ts`
- Create: `apps/electron/src/main/lib/oauth-proxy-scope.ts`
- Test: `apps/electron/src/main/lib/oauth-proxy-scope.test.ts`

**Step 1:** Write tests that verify the scope resolves the configured proxy, appends loopback hosts to `NO_PROXY`, executes in the Pi scope, and closes on both success and failure.

**Step 2:** Add `runWithPiRequestProxyScope()` around the existing dispatcher lifecycle.

**Step 3:** Add `runWithOAuthProxyScope()` that reads `getEffectiveProxyUrl()`, merges process `NO_PROXY` with `localhost,127.0.0.1,[::1]` (the bracketed IPv6 form required by Undici), and delegates to the managed Pi scope.

**Step 4:** Run `bun test apps/electron/src/main/lib/oauth-proxy-scope.test.ts`.

### Task 2: Route Codex and xAI SDK OAuth through the scope

**Files:**
- Modify: `apps/electron/src/main/lib/codex-oauth-service.ts`
- Modify: `apps/electron/src/main/lib/xai-oauth-service.ts`

**Step 1:** Wrap each provider’s `ModelRuntime.login()` and `getAuth()` operation in `runWithOAuthProxyScope()`.

**Step 2:** Preserve the Pi SDK as the OAuth protocol implementation; do not copy device-code, polling, or refresh logic into Proma.

**Step 3:** Add a `device_code` method to Codex login selection and forward its device-code event to a caller callback; retain browser as default.

**Step 4:** Run targeted typecheck/tests.

### Task 3: Surface Codex device-code fallback securely

**Files:**
- Modify: `packages/shared/src/types/channel.ts`
- Modify: `apps/electron/src/main/ipc.ts`
- Modify: `apps/electron/src/preload/index.ts`
- Modify: `apps/electron/src/renderer/components/settings/ChannelForm.tsx`

**Step 1:** Add typed Codex OAuth method and device-code IPC contracts.

**Step 2:** Let IPC generate a QR data URL only from the device verification URI and send it to the initiating renderer.

**Step 3:** Add a secondary Codex “use device code” action, display short code/URL/QR while polling, and allow cancellation.

**Step 4:** Update wording so users know system-browser connectivity is separate from Proma’s Node proxy.

### Task 4: Verify and review

**Files:**
- Test: `apps/electron/src/main/lib/oauth-proxy-scope.test.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-agent-proxy.test.ts`

**Step 1:** Run targeted Bun tests and `bun run typecheck` from `apps/electron`.

**Step 2:** Inspect diff for secret logging, process-wide dispatcher changes, and browser callback proxying.

**Step 3:** Review the final change against the OAuth proxy architecture document and report any remaining browser-network limitation explicitly.
