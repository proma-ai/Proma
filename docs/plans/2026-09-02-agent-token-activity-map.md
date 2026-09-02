# Agent Token Activity Map Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 12-month daily Token activity map to the commercial billing page, calculated only from `ApiKeyUsageLog`.

**Architecture:** The API will aggregate per-user Agent/API-key logs by UTC calendar day and return input, output, cache, and total Token counts. The Electron cloud API/IPC chain will expose that compact result to a new billing component, positioned between current subscriptions and commercial quota purchase cards.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, React, TypeScript, Jotai, Tailwind CSS, Electron IPC.

---

### Task 1: Add the API contract and failing aggregation test

**Files:**
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/proma-api/app/schemas/usage.py`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/proma-api/tests/test_combined_usage.py`

**Step 1: Write the failing test**

Add `test_agent_token_activity_aggregates_only_agent_logs_by_day`. Seed one user with two `ApiKeyUsageLog` rows on the same day and one row on the next day, plus a `UsageLog` and another user's `ApiKeyUsageLog`. Assert that only the caller's Agent rows contribute and that totals include input, output, cache creation, and cache read tokens.

**Step 2: Run test to verify it fails**

Run: `pytest tests/test_combined_usage.py::test_agent_token_activity_aggregates_only_agent_logs_by_day -v`

Expected: FAIL because `get_my_agent_token_activity` does not exist.

**Step 3: Define response schemas**

Add `AgentTokenActivityItem` with `date`, `inputTokens`, `outputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, and `totalTokens`; add `AgentTokenActivityResponse` with `items`, `startDate`, and `endDate`.

### Task 2: Implement and validate the FastAPI endpoint

**Files:**
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/proma-api/app/routers/me.py`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/proma-api/tests/test_combined_usage.py`

**Step 1: Implement the minimal query**

Add `GET /me/agent-token-activity`. Accept optional ISO `start_date` and `end_date`; default to the inclusive latest 365 UTC days. Query only `ApiKeyUsageLog` for the current user; aggregate by `DATE(createdAt)` and return ascending dates. Reject inverted date ranges with HTTP 422.

**Step 2: Run focused tests**

Run: `pytest tests/test_combined_usage.py -v`

Expected: PASS.

### Task 3: Wire the type-safe cloud API and Electron IPC

**Files:**
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/packages/shared/src/types/cloud.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/packages/cloud/src/api/usage.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/main/lib/cloud-usage-service.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/main/cloud-ipc.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/preload/index.ts`

**Step 1: Add shared TS response types and an IPC channel constant**

Add `AgentTokenActivityItem` / `AgentTokenActivityResponse` types and `GET_AGENT_TOKEN_ACTIVITY`.

**Step 2: Add cloud API, service, main-process handler, preload declaration and preload method**

Expose `window.electronAPI.cloudUsage.getAgentTokenActivity()` with the established `BillingIpcResponse<T>` envelope.

**Step 3: Run type-check**

Run: `npx tsc --noEmit`

Expected: PASS.

### Task 4: Build and position the activity-map component

**Files:**
- Create: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/renderer/components/billing/AgentTokenActivity.tsx`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/renderer/components/billing/BillingSettings.tsx`

**Step 1: Implement the map**

Render the last 365 local calendar days in a seven-row contribution grid. Fetch only the Agent activity endpoint, handle loading/error/empty states, and use native title tooltips containing the date, total Tokens, and input/output/cache breakdown. Format display values as `亿`, `百万`, `万`, or raw Tokens, while retaining exact locale-formatted quantities in the tooltip.

**Step 2: Place it in the approved order**

Keep the existing balance card first. `SubscriptionTab` continues to render the current subscription before its purchase cards; insert the activity component after the subscription section and before purchase cards by exposing a narrow composition prop or splitting the current subscription/purchase sections if needed. Preserve the official API explainer and billing notes at the bottom.

**Step 3: Verify quality and build**

Run: `npx tsc --noEmit` and relevant Electron component tests if present. Inspect the diff for tabular numbers, accessible hover information, responsive overflow, and no `transition-all` additions.

### Task 5: Daily cache reconciliation

**Files:**
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/proma-api/app/routers/me.py`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/proma-api/tests/test_combined_usage.py`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/packages/shared/src/types/cloud.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/packages/cloud/src/api/usage.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/main/lib/cloud-usage-service.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/main/cloud-ipc.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/preload/index.ts`
- Modify: `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial/apps/electron/src/renderer/components/billing/AgentTokenActivity.tsx`

**Step 1: Add the failing Beijing-date aggregation test**

Seed records on both sides of Beijing midnight (UTC 16:00) and assert that `GET /me/agent-token-activity` reports them under separate China calendar dates.

**Step 2: Make date ranges and aggregation use UTC+8**

Interpret `start_date` / `end_date` as inclusive Beijing calendar dates, translate range bounds to UTC for the indexed `createdAt` filter, and group by the UTC+8 calendar date. Preserve the default 365-day response.

**Step 3: Split cached history from fresh today data**

Extend the cloud API with optional date bounds. In the Electron main process, cache the preceding 364 Beijing days only until the Beijing calendar date changes, and fetch the single current Beijing day on every billing-page entry. Merge the two responses before exposing the unchanged renderer contract. Do not expose a renderer force-refresh API.

**Step 4: Verify**

Run `pytest tests/test_combined_usage.py -v`, Electron main/preload/renderer builds, and `git diff --check`.

### Task 6: Final verification

**Files:**
- Verify: all modified files

**Step 1: Run backend focused tests**

Run: `pytest tests/test_combined_usage.py -v`

Expected: PASS.

**Step 2: Run commercial type check**

Run: `npx tsc --noEmit`

Expected: PASS.

**Step 3: Review diff**

Run: `git diff --check` in each affected repository.

**Step 4: Commit**

Do not create a commit unless the user asks for one. If requested, use a descriptive message ending with `Made-with: Proma`.
