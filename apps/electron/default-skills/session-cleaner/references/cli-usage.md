# session-cleaner CLI 参考

本技能是 `proma` CLI 的薄封装。本文件给维护者解释**底层格式**与**CLI 行为**，便于排查问题。
真正的解析逻辑在 `@proma/session-core`（仓库内唯一真源），不要在技能里重抄。

## 会话存储

```
~/.proma/agent-sessions.json        会话索引（{ version, sessions: AgentSessionMeta[] }）
~/.proma/agent-sessions/<id>.jsonl   单会话消息，JSONL（一行一条 JSON）
```

开发模式（`PROMA_DEV=1` 或 Proma 未打包）数据在 `~/.proma-dev/`。CLI 用 `--dev` 或 `--config-dir` 切换。

## 两种会话格式（CLI 自动识别，无需关心）

`@proma/session-core` 的 `readSessionMessages` 在读取时统一归一，下游不需要区分：

- **格式 B（SDK 流式，当前默认）**：每行 `{ type, message, _createdAt, ... }`。同一 assistant 回合被拆成**多行完整快照**，共享同一 `message.id`，内容数组逐步增长——这是"拼接单字 / 重复段落"的来源。core 的 `toTranscript` 按 `message.id` 取最完整快照消除冗余。
- **格式 A（旧扁平 chat）**：每行 `{ id, role, content: string, createdAt }`。core 的 `convertLegacyMessage` 把它转成近似 SDKMessage。

## 清洗规则（core 实现，CLI 透传）

| 块类型 | 处理 |
|--------|------|
| `text` | 保留原文 |
| `thinking` | 丢弃（chain-of-thought 不进转录） |
| `tool_use` | 压缩为 `> [工具: name args]`，连续相同折叠 `×N` |
| `tool_result`（user 行内） | 丢弃（工具回包，非用户发言） |
| 纯 tool_result 的 user 行 | 整条丢弃，不算用户 turn |

损坏行（截断 JSON）静默跳过，不中断。

## turn 下标稳定性

`outline` / `search` / `export --turns` 共享同一套 0 基下标 —— 即 `groupIntoTurns` 输出顺序。`search` 返回的 `index` 可直接用于 `export --turns index-index`。

## export 护栏逻辑

```
未指定窗口(--turns/--head/--tail/--offset/--limit) 且 渲染字节 > --max-bytes(默认 51200)
  → 不写 stdout，落盘到 <id>.clean.md，回执 { guarded: true, written, hint }
否则
  → 正常 stdout（或 --out 指定路径落盘）
```

`--stdout` 强制绕过护栏；`--out` 显式落盘不受护栏限制。

## 退出码

- `0` 成功
- `1` 运行期错误（找不到会话等）
- `2` 用法错误（参数非法）

## 与 core 的关系（维护者须知）

```
@proma/session-core   解析 / 快照去重 / outline / search / select / render —— 真源
  └─ /node 子入口      readSessionMessages（文件 IO，含 node:fs）
apps/cli (proma)      命令路由薄壳，调用 core
default-skills/session-cleaner  本技能，教 Agent 调 CLI
```

改 bug / 改格式 → 改 `@proma/session-core`。CLI 和技能都不应包含解析逻辑。
