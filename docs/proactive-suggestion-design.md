# Proma Proactive Suggestion 设计文档

> 版本：1.0（MVP）
> 日期：2026-08-03
> 关联：`docs/proactive-memory-design.md`（主动记忆，本设计的姊妹能力）
> 参考：ProactiveAgent（ICLR 2025，误报控制 / P9 时机学习 / P12 轻量三态）、Proactive Center 蓝图 §7

## 1. 背景与目标

Proactive Agent 的完整公式：**主动记忆（记得住）+ 主动建议（对的时候提对的建议）+ 反馈闭环（越用越好用）**。

主动记忆已交付（自动提取/召回/persona/反馈回流）。本设计补齐第二半——**主动建议**：在 Agent 会话过程中主动识别值得建议的时机，提出轻量、可解释、可反馈的建议，并让建议频率随用户反馈自我调节。

核心信条（ProactiveAgent ICLR 2025）：**所有模型 Recall 98%+ 但误报率 51~65%，"该沉默时沉默"也是能力。主动性 = 用户接受率，不是建议次数。**

## 2. 架构

```
信号层 Signals（复用已有资产，只读）
  · 会话消息（纠正词/时间词/周期词/未完成词/重复意图）
  · memory corrections + SOP 候选（去重来源 + skill 触发）
  · automation 标题（去重：已有任务不重复推荐）
        ▼
候选层 Rules（第一阶段 deterministic，不依赖 LLM）
  · correction / followup / automation / skill / todo 五类规则
        ▼
决策层 Engine（误报控制 + 频率学习）
  · rawConfidence × typeWeight ≥ threshold 才建议
  · 去重：duplicateKey + 同会话抑制 + 用户永久屏蔽
  · 预算：单次最多 1 条、同会话最多 2 条
        ▼
表达层 Delivery（Agent 会话内 SuggestionBanner）
  · 三态交互：接受 / 忽略 / 不再建议这类
        ▼
反馈层 Feedback（越用越好用）
  · accepted → 类型权重 ×1.2（上限 2.0）
  · ignored → ×0.8（下限 0.2）
  · never → 该 duplicateKey 永久屏蔽 + 类型 ×0.5
  · 连续忽略 3 次 → 类型自动静默
```

## 3. 模块

```
apps/electron/src/main/lib/suggest/
  types.ts       # 内部类型（RuleContext / SuggestionsIndex / 权重）
  signals.ts     # 信号提取：纠正/跟进/周期/未完成/重复意图
  rules.ts       # 规则：信号 → 建议候选（含 SOP 阈值）
  engine.ts      # 决策：评分/去重/预算/频率加权
  feedback.ts    # 反馈持久化：suggestions.json + 权重调节
  service.ts     # 编排：会话结束钩子 + IPC 操作
```

### 3.1 五类规则（第一阶段）

| 规则 | 触发信号 | 建议 | 动作 |
|---|---|---|---|
| correction | "以后不要 X / 下次记得 X / 我更喜欢 X" | 记住这个纠正 | memory_correction（接受 → 写入 pending correction → persona 回流） |
| followup | "明天继续 / 稍后提醒我" | 创建跟进提醒 | open_automation_create |
| automation | "每天自动 / 帮我盯状态" | 开启定时任务 | open_automation_create |
| repeat | 同一意图词出现 ≥2 次 | 把重复操作变定时任务 | open_automation_create |
| skill | SOP 候选 ≥ 3 | 沉淀为 Skill | open_skill_creator |
| todo | "还没做完 / 待会再" | 把未完成任务记下来 | open_memory_board |

### 3.2 误报控制（论文 P3 落地）

- **明确拒绝门**：最后一条用户消息含"不用/算了/别管"等 → 本轮不触发
- **频率门槛**：`effective = rawConfidence × typeWeight`，< 0.6 不注入
- **预算**：单次最多 1 条；同会话最多 2 条
- **去重**：duplicateKey（kind+核心实体）、同会话去重、已有 automation/correction 去重、用户 never 屏蔽
- **证据透明**：每条建议带 title/reason/evidence（哪句话触发）

### 3.3 频率学习（越用越好用）

```ts
accepted → weight = min(2.0, weight × 1.2)
ignored  → weight = max(0.2, weight × 0.8)
never    → 该 duplicateKey 永久屏蔽 + weight × 0.5
连续忽略 3 次 → 类型自动静默（isTypeSilenced）
```

## 4. 接线

| 接线点 | 文件 | 说明 |
|---|---|---|
| 会话结束钩子 | `agent-orchestrator.ts` | completeRun/failRun 后 fire-and-forget 调 `evaluateSessionSuggestions` |
| 存储路径 | `config-paths.ts` | `getSuggestionsPath()` → `~/.proma/suggestions.json` |
| IPC | `ipc.ts` + `preload/index.ts` | `listSuggestions` / `actOnSuggestion` / `getSuggestionStats` |
| 渲染层 | `SuggestionBanner.tsx` | AgentView 中展示三态建议横幅 |
| 类型 | `packages/shared/src/types/suggestion.ts` | SuggestionKind / Candidate / Record / Stats |

## 5. 验证

- **单测**：signals/rules/engine/feedback 42 个（含频率学习收敛断言、never 屏蔽、该沉默测试）
- **端到端冒烟**（`scripts/smoke-suggest.ts`）：
  - 纠正信号 → 建议 → 忽略 → 权重下降；连续忽略 → 自动静默；never → 永久屏蔽
- **真实调用**：accepted correction 建议 → 写入 memory pending correction（rule 已规范化去引导词）
- 全量 596 pass / 3 fail（3 个既有 Electron 环境问题，基线一致）；6 包 typecheck 全绿
- main/preload/renderer 构建成功

## 6. 后续（Phase B）

- 建议聚合到 Proactive Center / Today（蓝图 §5.1 Recommended）
- 低频 headless LLM 分析器：工作模式发现（蓝图 §7.4 第二阶段）
- 建议类型与 persona 交互协议联动（用户拒绝的建议类型 → "不要主动推荐定时任务"）
- followup 建议一键转成真实 automation（当前为打开创建确认）

## 7. 参考

- ProactiveAgent（ICLR 2025）：误报控制、统一接受率目标、P9 时机学习、P12 轻量三态交互
- Proactive Center 蓝图 §7（Recommendation 结构 / duplicateKey / 降噪机制）
- `docs/proactive-memory-design.md`（记忆系统，本设计的信号源与反馈目标）
