## Proactive Agent: 主动记忆 + 主动建议 + 主动中心

为 Proma 增加完整的 **Proactive Agent** 能力集——让 Agent 从"被动等用户发起"进化到"记得住、会建议、越用越好用"。

完整公式：**主动记忆（记得住）+ 主动建议（对的时候提对的建议）+ 反馈闭环（越用越好用）**

### 解决什么问题

Proma 现有的 Auto Memory 依赖 Agent 在 prompt 引导下自觉维护，且 Agent 只能"被动回答"，缺少三个关键能力：

1. **主动记忆**：会话结束自动提取结构化长期记忆，跨会话自动召回
2. **主动建议**：Agent 使用过程中识别值得建议的时机，主动提出轻量、可解释、可反馈的建议
3. **工作模式发现**：低频 LLM 分析，发现用户从未明说但反复出现的隐含工作模式

参考 ProactiveAgent（ICLR 2025）的核心发现：所有模型 Recall 98%+ 但误报率 51-65%，**"该沉默时沉默"也是能力**——主动性 = 用户接受率，不是建议次数。本实现全程贯彻误报控制。

---

### 能力一：主动记忆（Proactive Memory）

| 能力 | 说明 |
|---|---|
| **L1 原子记忆** | 会话结束钩子自动 LLM 提取（fact / preference / correction / sop / todo_context），fingerprint 去重 |
| **混合召回** | keyword 精确 + LLM 查询改写 + embedding 语义 + 规则加权，多源融合 + 绝对分阈值 |
| **误报控制** | 归一化评分阈值 + 停用词过滤 + 同义词扩展 + 回忆意图降级 |
| **L3 Persona** | LLM 生成/增量更新用户画像，Markdown 白盒可审计 |
| **反馈回流** | 确认/拒绝纠正后自动更新 Persona 交互协议 |
| **内置 MCP 工具** | `memory_search/capture/stats/corrections/confirm/reject`（Claude + Pi 双 runtime） |
| **UI 看板** | 记忆统计、纠正审批、记忆搜索、persona 预览（Agent 能力中心 → 记忆 Tab） |
| **memory-daily Skill** | 指导每日记忆整理 + 建议创建 daily automation |

### 能力二：主动建议（Proactive Suggestion）

| 能力 | 说明 |
|---|---|
| **5 类确定性规则** | correction（记住纠正）/ followup（跟进提醒）/ automation（定时任务）/ skill（SOP 沉淀）/ todo（待办记录） |
| **信号提取** | 纠正词 / 时间词 / 周期词 / 未完成词 / 重复意图 + 延后语义/弱意图过滤 |
| **误报控制** | 明确拒绝门 + 频率门槛（raw×weight≥0.6）+ 预算（单次≤1、同会话≤2）+ duplicateKey 去重 |
| **频率学习** | accepted×1.2 / ignored×0.8 / never 屏蔽 + 连续忽略 3 次自动静默（"越用越好用"） |
| **会话内横幅** | `SuggestionBanner`：Agent 输入框上方三态卡片（接受/忽略/不再建议这类） |
| **实时推送** | 新建议生成后 IPC 事件广播，当前会话立即显示 |

### 能力三：主动中心 + 工作模式分析（Phase B）

| 能力 | 说明 |
|---|---|
| **Proactive Today** | PlanningView「主动」tab：建议卡 / 主动任务 / 待确认审批 / 用户画像 / 统计 |
| **工作模式分析器** | 低频 LLM 分析近期记忆，发现隐含模式（周期任务 / SOP / 待固化偏好） |
| **schema 严格校验** | LLM 只能产出候选（类型白名单/字段完整/动作匹配），不能直接创建任务 |
| **suggestion_analyze 工具** | Pi/Claude 双 runtime 内置工具，定时任务可调 |
| **suggestion-daily Skill** | 指导建立每日工作模式分析 automation |

---

### 质量保障（子代理驱动验证）

召回与建议系统经 **5 轮 collaboration 子代理独立审查/体验**迭代打磨：

| 轮次 | 发现 | 结果 |
|---|---|---|
| 记忆召回 3 轮审查 | kw 硬截断丢正确答案 / 归一化放大弱命中 / 无关注入 | 多源融合 + 绝对分阈值 + 无关 gate，12 问矩阵 12/12 |
| 建议引擎审查 | 8 个边界误报 + todo 死锁 + 测试污染 | 全部修复，42+9 单测 |
| **UI 实测** | **P0**：SDKMessage 格式不匹配，引擎从不执行 | sdk-messages.ts 修复 |
| 401 实测 | dev 模式 .env 路径缺口 | findDotEnvUpwards 修复 |
| **体验评测** | **P0**：规则语义反转 / 两步确认 / 横幅不实时 | 3 项全修 |

子代理独立实测发现了自测盲区（"功能看似正常但真实链路从不执行"），这是代码审查和单测发现不了的。

### 验证

- 全量 typecheck 6 包全绿
- 全量测试 640+ pass / 4 fail（4 fail 为既有 Electron/planning 环境问题，与本次无关；新增 120+ 测试）
- 真实 LLM 端到端：提取/召回/persona/建议/分析全部真实验证
- 真实 UI 实测（CDP 连接真实窗口）：横幅渲染、三态交互、主动中心、分析按钮全部通过
- 真实记忆工作模式分析：92 条记忆 → 发现「ShopGo 促销前压测提醒」（automation）
- 401 修复：DeepSeek 渠道预设自动填充 .env 凭证，开箱即用

### 文件概览（74 个文件，+9208 行）

- `packages/shared/src/types/memory.ts` + `suggestion.ts`：类型
- `apps/electron/src/main/lib/memory/`：store / recall / extractor / persona / service + 测试
- `apps/electron/src/main/lib/suggest/`：signals / rules / engine / feedback / service / analyst / sdk-messages + 测试
- `apps/electron/src/main/lib/agent-orchestrator.ts`：会话结束记忆捕获 + 建议评估钩子
- `apps/electron/src/main/lib/channel-manager.ts`：DeepSeek 预设渠道自动填充 .env 凭证
- `agent-prompt-builder.ts`：`<memory_context>` + `<persona_profile>` + `<working_memory>` 注入
- `builtin-mcp`：memory / suggestion 内置 MCP 注册（Claude + Pi）
- `ProactiveMemoryPanel.tsx` + `ProactiveTodayView.tsx` + `SuggestionBanner.tsx`：UI
- `default-skills/memory-daily/` + `suggestion-daily/`：内置 Skill
- `docs/proactive-memory-design.md` + `proactive-suggestion-design.md`：设计文档
- `scripts/`：smoke / verify / demo / stress 脚本

### 设计文档

- `docs/proactive-memory-design.md`：记忆系统（架构/分层/模块/接线/验证）
- `docs/proactive-suggestion-design.md`：建议系统 + 主动中心 + 分析器

Made with [Proma](https://proma.cool) · [GitHub](https://github.com/proma-ai/Proma)
