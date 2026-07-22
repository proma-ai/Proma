# Pi 原生 `/goal` 持续模式设计

- 日期：2026-07-22
- 状态：设计已获用户批准，待实现
- 范围：Proma Electron 的 Pi Agent Runtime

## 1. 背景与问题

Proma 已经通过 `PiAgentAdapter` 使用 `@earendil-works/pi-coding-agent`，但当前 `DefaultResourceLoader` 没有加载 Goal extension。因此，用户在 Agent 输入框中输入 `/goal <任务>` 时，命令不会被 Pi 的 extension command 路径处理。

Pi SDK 原生提供 `extensionFactories`、`registerCommand`、`before_agent_start`、`agent_end`、`session_start`、`session_tree`、`sendUserMessage` 和 `appendEntry`，足以实现一个不依赖新数据库、不绕过 Pi 生命周期的持续 Goal 模式。

## 2. 目标

实现以下行为：

1. 用户输入 `/goal <任务>` 后，当前 Pi session 建立一个活动 Goal。
2. Goal 状态持久化到 Pi session transcript，session resume 或 tree 切换后可以恢复。
3. 每一轮 Agent 开始时，活动 Goal 自动注入上下文。
4. 当前一轮结束但 Goal 尚未完成时，Pi 自动排队下一轮继续执行。
5. Agent 通过内部 `goal_complete` 工具明确报告完成后，停止自动续跑。
6. 用户输入 `/goal stop` 后，清除活动 Goal，后续不再自动续跑。
7. Goal 循环有固定安全上限，避免异常模型或错误状态造成无限执行。

## 3. 非目标

本次不做：

- Claude Runtime 的 `/goal` 实现。
- 跨 session、跨 workspace 或跨设备的后台 Goal 调度。
- Proactive Scheduler、Cron、Monitor 或云端常驻 Agent。
- 新增数据库或新的持久化服务。
- Goal 状态 UI、独立 Goal 面板或复杂命令补全。
- 改动 Proma 现有 Stop 按钮、权限系统和 Pi retry/compaction 语义。

## 4. 架构方案

### 4.1 Inline Extension

新增一个内联 Pi extension factory，放在 `apps/electron/src/main/lib/adapters/pi-goal-extension.ts`。`PiAgentAdapter` 创建 `DefaultResourceLoader` 时，将该 factory 与现有 Codex request settings extension 合并传入 `extensionFactories`。

extension 内部维护本 session 的短状态：

```ts
interface PromaGoalState {
  id: string
  task: string
  status: 'active' | 'completed' | 'stopped' | 'max_turns'
  turnCount: number
  createdAt: string
  updatedAt: string
}
```

状态变化使用 `pi.appendEntry('proma-goal-state', state)` 追加到 Pi transcript。通过 `session_start` 和 `session_tree` 扫描当前 branch 的最新状态恢复内存状态；不写额外 JSON 文件。

### 4.2 命令

- `/goal <任务>`：创建新 Goal。若已有活动 Goal，则原子替换为新 Goal；命令本身触发首轮用户消息。
- `/goal stop`：将活动 Goal 标为 `stopped` 并持久化；不再触发 follow-up。
- 空参数或未知子命令：返回可见的用法错误，不启动模型调用。

命令通过 Pi `registerCommand('goal', ...)` 注册，避免在 Proma 外层复制 Pi 的 slash-command 解析逻辑。

### 4.3 每轮上下文与续跑

`before_agent_start` 在活动状态下追加隐藏的 Goal context，内容包括：当前任务、Goal ID、当前轮次、完成条件和停止条件。首轮命令消息也会要求 Agent：

- 继续执行直到任务真正完成；
- 需要结束时调用 `goal_complete`；
- 遇到无法安全继续的情况说明阻塞原因，不伪造完成。

`agent_end` 在 Goal 仍为 `active` 且未达到安全上限时，使用 `pi.sendUserMessage(..., { deliverAs: 'followUp' })` 触发下一轮。每次续跑前递增并持久化 `turnCount`，确保 resume 后不会丢失预算。若上一轮的最终 assistant message 是 `aborted` 或 `error`，不自动续跑，避免中止、重试和失败路径被 Goal 循环放大。

Proma 直接调用 Pi `AgentSession`，没有 Pi TUI/RPC mode 替 extension command 等待嵌套 turn。因此 adapter 在完成 `/goal <任务>` command prompt 后等待该嵌套 Goal turn 的 `waitForIdle()`，保证 session 不会在首轮刚排队时被清理。

达到安全上限时，将状态设为 `max_turns`，追加一条可见结果说明并停止续跑。默认上限为 50 轮，并集中定义为常量，后续可在社区反馈后调整。Pi custom message 中 `display: true` 的 Goal 状态消息会在兼容层转换为 Proma 可渲染的 assistant 状态消息；隐藏 Goal context 不进入 UI 消息流。

### 4.4 完成工具

extension 注册一个仅供 Agent 使用的 `goal_complete` custom tool。工具执行时：

1. 若没有活动 Goal，返回明确错误；
2. 将状态更新为 `completed` 并追加 transcript entry；
3. 返回完成确认，允许当前 turn 正常结束；
4. `agent_end` 发现状态已完成后不再排队下一轮。

工具参数只包含完成摘要，避免让 Agent 通过任意参数修改 Goal 状态。

## 5. 数据流

```text
用户 /goal <任务>
  → Pi session.prompt
  → registerCommand('goal')
  → appendEntry(active state)
  → sendUserMessage(initial goal instruction)
  → Agent turn
  → goal_complete 或未完成
  → agent_end
      ├─ completed/stopped/max_turns：结束
      └─ active：followUp → 下一轮 Agent turn
```

Session resume/tree switch 时：

```text
session_start/session_tree
  → scan current branch
  → restore latest proma-goal-state
  → before_agent_start 注入活动 Goal
```

## 6. 错误与安全边界

- Goal 命令在没有任务文本时不得触发模型调用。
- `/goal stop` 必须是幂等操作。
- `goal_complete` 在没有活动 Goal 时不得改变状态。
- 续跑只在 `ctx.isIdle()` 对应的 agent lifecycle 已结束后触发，使用 Pi 原生 follow-up 机制，不创建第二个 AgentSession。
- 不修改 Pi 的 abort、retry、compaction 处理；若用户通过 Proma Stop 中止当前 turn，Goal 状态保留为 active，用户可以继续发送普通消息让 Goal 在后续 turn 中恢复，或输入 `/goal stop` 清除。
- 固定 50 轮上限是无限循环的最后防线；任何未完成 Goal 都必须以可见状态结束。
- 不把用户输入、API key 或完整模型输出复制到额外日志中。

## 7. 测试策略

采用 Bun test 与 BDD 风格，先写失败测试，再实现：

1. Goal 状态 reducer/恢复：最新 transcript entry 正确决定状态。
2. `/goal <任务>`：创建 active state、首轮指令和 turn count。
3. `/goal stop`：停止并持久化，重复执行安全。
4. `goal_complete`：完成活动 Goal；无活动 Goal 返回错误。
5. `agent_end`：active Goal 触发 follow-up；completed/stopped/max_turns 不触发。
6. 达到 50 轮上限后停止并写入 `max_turns`。
7. `PiAgentAdapter` 将 Goal extension 与已有 extension factory 一起加载，不覆盖 Codex request settings extension。

验证顺序：相关 Bun 测试 → `bun run typecheck` → Pi adapter 构建 → 必要时 Electron 主进程构建。

## 8. 社区 PR 范围

PR 只包含 Pi Goal extension、adapter 接线、测试和必要的文档/版本 patch，不修改 Claude Runtime、不引入依赖、不包含 Proactive Center 或 Scheduler。PR 描述将明确说明：这是 session-scoped persistent goal，不是跨 session 的后台自动化。
