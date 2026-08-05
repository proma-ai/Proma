---
name: memory-daily
description: Proma 主动记忆的每日整理 Skill。当用户要求"每天整理我的记忆/会话""定期沉淀长期记忆""开启每日记忆整理""memory-daily"、"把今天的对话变成记忆"、或希望 Proactive Memory 自动持续运行时触发。也适合"以后记得帮我整理"“每天晚上总结今天聊了什么”等定期沉淀意图。本 Skill 指导 Agent 用内置 memory 工具整理当天记忆，并建议用户开启 Proma 定时任务（Automation）让整理无人值守地每天运行。纯一次性整理、不需要定期执行时不建议创建定时任务，直接整理即可。
group: proma
version: "1.0.0"
---

# Memory Daily

帮助用户把当天的对话/工作沉淀为长期记忆，并可开启每日自动整理。

## 背景

Proma 内置了 Proactive Memory（主动记忆）能力：
- **自动捕获**：Agent 会话结束后自动从对话提取 L1 原子记忆（fact / preference / correction / sop / todo_context）
- **主动回忆**：新会话时自动召回相关记忆注入 `<memory_context>`；persona（用户画像）稳定注入系统提示
- **记忆工具**：`mcp__memory__memory_search` / `memory_capture` / `memory_stats` / `memory_corrections` 等

memory-daily 是"定期深度整理"：把当天多个会话产生的记忆做一次汇总、去重、生成 persona 更新，确保长期记忆质量。

## 工作流

### 1. 判断用户意图

- 用户说"每天/定期整理记忆" → 整理 + 建议创建每日定时任务
- 用户只说"现在整理一下记忆" → 只整理一次，不创建定时任务
- 用户说"以后记得帮我整理" → 整理 + 建议创建定时任务

### 2. 整理当天记忆

用内置 memory 工具完成：

1. `mcp__memory__memory_stats` → 查看当前记忆统计
2. `mcp__memory__memory_corrections` → 列出待确认纠正（如有 pending，提示用户确认/拒绝）
3. 检查记忆质量：
   - 是否有明显重复条目（可向用户确认后由用户决定是否清理）
   - 是否有过时/冲突信息（报告给用户）
   - 待确认纠正是否积压（引导用户处理）
4. 输出整理报告：
   ```
   今日记忆整理报告
   - 记忆总量: N 条 (fact X / preference Y / correction Z / sop W)
   - 待确认纠正: M 条
   - 用户画像: 已更新/待更新
   - 建议: ...
   ```

### 3. 开启每日自动整理（可选）

如果用户希望每天自动整理，使用 `automation` 工具创建定时任务：

```
mcp__automation__create_automation
  name: 每日记忆整理
  prompt: 运行 memory-daily，整理今天的对话与记忆，报告新增记忆与待确认纠正。
  scheduleType: daily
  timeOfDay: "23:30"
  active: true
```

创建前先 `mcp__automation__list_automations` 检查是否已有同类任务（避免重复）。

### 4. 质量与安全

- 只整理记忆库中已有内容，不要凭记忆编造当天对话
- 不要删除用户记忆（清理需用户确认）
- 待确认纠正必须由用户确认后才生效（`memory_confirm_correction`）
- 定时任务会无人值守运行，写入行为默认受限；涉及删除/大改需用户主会话确认

## 完成定义

- [ ] 已查看记忆统计与待确认纠正
- [ ] 输出今日整理报告
- [ ] （如用户要求）已创建/确认每日定时任务
- [ ] 报告了任何质量问题和用户待办事项
