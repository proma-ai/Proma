## Proactive Memory: 主动记忆 + 主动回忆能力

为 Proma 增加官方级 **Proactive Memory（主动记忆）** 能力：Agent 会话结束后自动提取结构化长期记忆，新会话/新消息时自动召回相关记忆注入上下文，并稳定注入用户画像（persona）。

### 解决什么问题

Proma 现有的 Auto Memory（`.claude/memory/MEMORY.md`）依赖 Agent 在 prompt 引导下自觉维护，缺少两个关键能力：

1. **主动记忆**：会话结束自动提取（fact / preference / correction / sop / todo_context），去重沉淀
2. **主动回忆**：跨会话自动召回相关记忆注入 `<memory_context>`，新会话也能"记得你是谁"

参考 TencentDB-Agent-Memory 的 L0→L3 分层模型与 ProactiveAgent（ICLR 2025）的误报控制原则。

### 能力清单

| 能力 | 说明 |
|---|---|
| **L1 原子记忆** | 会话结束钩子自动 LLM 提取（OpenAI 兼容端点，兼容 reasoning 模型），fingerprint 去重 |
| **误报控制** | 归一化评分阈值 + 停用词过滤 + 同义词扩展 + 回忆意图降级（ProactiveAgent 论文："该沉默时沉默"） |
| **L3 Persona** | LLM 生成/增量更新用户画像，Markdown 白盒可审计 |
| **反馈回流** | 用户确认/拒绝纠正后自动更新 Persona 交互协议 |
| **内置 MCP 工具** | `memory_search` / `memory_capture` / `memory_stats` / `memory_corrections` 等（Claude + Pi 双 runtime） |
| **UI 看板** | 记忆统计、待确认纠正审批、记忆搜索、persona 预览（Agent 能力中心 → 记忆 Tab） |
| **memory-daily Skill** | 指导每日记忆整理 + 建议创建 daily automation |
| **LLM 配置** | 本地 `.env`（`MEMORY_LLM_API_KEY/BASE_URL/MODEL`），key 永不进对话/仓库 |

### 验证

- 全量 typecheck 6 包全绿
- 全量测试 534 pass / 3 fail（3 fail 为既有 Electron 环境问题，与本次无关；新增 37 个 memory 测试）
- 真实 LLM 提取 + 跨会话召回 + persona 生成 + 反馈回流均已端到端验证
- UI 实测通过（统计/审批/搜索/画像）

### 文件概览（31 个文件，+3273 行）

- `packages/shared/src/types/memory.ts`：记忆类型
- `apps/electron/src/main/lib/memory/`：store / recall / extractor / persona / service / agent-tools + 测试
- `agent-prompt-builder.ts`：`<memory_context>` + `<persona_profile>` 注入
- `agent-orchestrator.ts`：会话结束记忆捕获钩子
- `builtin-mcp`：memory 内置 MCP 注册（Claude + Pi）
- `ProactiveMemoryPanel.tsx`：记忆看板 UI
- `default-skills/memory-daily/`：每日整理 Skill
- `docs/proactive-memory-design.md`：设计文档

### 设计文档

`docs/proactive-memory-design.md`（架构、分层模型、模块、接线、验证、后续方向）
