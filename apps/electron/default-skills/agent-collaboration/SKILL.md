---
name: agent-collaboration
description: Proma 协作子 Agent Skill。用户任务复杂、可并行、长耗时、需要多个独立方向同时推进、需要真实可见进展、需要保留完整子任务记录，或用户明确说“开几个 Agent/多会话/一起协作/并行处理/spawn 子 Agent”时触发。用于判断是否调用 Proma 内置 collaboration 工具创建真实子会话。简单搜索、短调研、单文件修改、一次性代码审查优先使用 SDK 内置 SubAgent，不要创建真实 Proma 子会话。
group: proma
version: "1.0.1"
---

# Proma Agent Collaboration

你负责判断何时把复杂任务交给 Workflow、SDK SubAgent，或拆给真实可见的 Proma 协作子 Agent 会话。

Proma 已提供内置 `collaboration` MCP 工具。你必须通过这些工具创建、等待、查看和停止协作子会话，不要用 Bash、脚本或直接修改 `~/.proma/agent-sessions.json` 的方式创建会话。

可用工具：

- `collaboration.list_available_agent_models`：查看父会话当前渠道下可用于协作子 Agent 的模型。
- `collaboration.delegate_agent`：创建单个真实子会话。
- `collaboration.delegate_agents`：批量创建真实子会话，适合已经明确分片的大型并行任务。
- `collaboration.wait_for_delegations`：等待子会话，支持 `mode=all` 等全部，或 `mode=any` 先收敛一部分完成结果。
- `collaboration.list_delegations`：查看当前父会话创建的子会话状态。
- `collaboration.get_delegation_results`：按委派 ID 读取一个或多个子会话结果摘要。
- `collaboration.stop_delegation` / `collaboration.stop_delegations`：停止一个或一批子会话。

## 先判断用哪种能力

优先按下面顺序判断，不要把所有复杂任务都拆成子会话。

### 用 Workflow / Skill 工作流

适合主 Agent 自己按固定流程推进，不创建真实子会话：

- 步骤确定、强顺序依赖，后一阶段必须依赖前一阶段结果。
- 任务是可复用 SOP，例如发布检查、会议纪要整理、表格导入、固定诊断流程。
- 用户希望按阶段确认、暂停、审批或沿着一个计划线性推进。
- 核心价值是流程正确性和可重复性，而不是并行速度。

### 用 SDK SubAgent

适合轻量临时分工，不创建 Proma 会话：

- 简单搜索、短调研、局部代码审查、一次性定位文件或函数。
- 只需要快速返回结论，不需要前端实时可见或长期追溯。
- 子任务可以在几分钟内完成，且结果只服务于父会话当前决策。

### 用 Proma 协作编排

适合调用 `collaboration.delegate_agent` 创建真实可见子会话：

- 多个独立方向可以并行推进，例如“一个读后端、一个读前端、一个查测试”。
- 子任务会明显耗时，且用户希望看到实时进展。
- 子任务需要完整保留上下文和结果，后续可能单独打开追溯。
- 父 Agent 需要让一个子会话持续实现，另一个子会话审查或验证。
- 用户明确要求多 Agent、多会话、一起协作、并行处理或 spawn 子 Agent。

## 不适合创建真实子会话

- 简单搜索、单文件阅读、一次性定位函数。
- 只需要一个短结论，用 SDK 内置 SubAgent 更轻量。
- 子任务之间强依赖，必须串行决策。
- 任务本身还没定义清楚，应该先向用户澄清。

## 拆分原则

- 单个父会话最多允许 50 个运行中的协作子会话。
- 不要把“最多 50 个”当成默认值；只有任务天然可分片、每片都有独立产出、成本和权限可控时，才扩到几十个。
- 小型并行任务优先拆 2-8 个子会话；大型扫描、批量审查、跨模块调研可以使用 `delegate_agents` 批量创建。
- 每个子任务必须独立、自包含、可完成。
- 委派说明里写清楚目标、范围、禁止事项、预期输出。
- 如需让不同子会话使用同一渠道下的不同模型，先调用 `list_available_agent_models` 查看可用模型，再为 `delegate_agent` 或 `delegate_agents.items[]` 传 `modelId`；不传则继承父会话当前模型。
- 权限模式不要高于父会话；高风险修改优先让子会话只调研或审查。
- 子会话不能继续创建子会话。

## 推荐工作流

1. 判断是否真的需要真实子会话；不需要时按 Workflow / Skill 工作流、SDK SubAgent 或普通工具推进。
2. 为每个独立方向调用 `collaboration.delegate_agent`；如果已经有清晰任务列表，用 `collaboration.delegate_agents` 批量创建。
3. 根据任务关系决定父会话下一步：
   - 如果父会话后续工作强依赖子会话结果，调用 `collaboration.wait_for_delegations` 等待必要结果。
   - 如果父会话还有独立主线可推进，先继续处理自己的工作，不要因为已经派发子会话就空等。
   - 如果需要快速校准方向，用 `mode=any` / `minCompleted` 先收敛一部分结果，再决定父会话继续做什么。
4. 调用 `collaboration.wait_for_delegations` 收敛结果；几十个并行任务可以先用 `mode=any` 等一部分完成，再决定是否继续等待或停止剩余任务。非阻塞推进时，可以先 `list_delegations`，再用 `get_delegation_results` 按 ID 拉取结果。
5. 整合子会话发现，明确哪些结论来自哪个子会话。
6. 如某个子会话或一批子会话卡住、重复或方向错误，用 `collaboration.stop_delegation` / `collaboration.stop_delegations` 停止。

## 委派 task 写法

高质量 task 应包含：

- 背景：父任务是什么，当前子任务为什么存在。
- 范围：读哪些目录、文件、模块、链接或数据源。
- 目标：要产出什么判断或改动。
- 约束：不要做什么，是否允许写文件，是否只读。
- 输出：最终回复的结构。

示例：

```text
父任务：实现 Proma 协作子 Agent 能力。
子任务：只调研当前前端如何展示自动任务来源会话，找出最小 UI 复用点。
范围：apps/electron/src/renderer/components/app-shell、components/tabs、atoms/agent-atoms。
约束：不要修改文件，只返回建议。
输出：列出相关文件、现有模式、推荐最小改动和风险。
```

## 回复方式

- 创建子会话后，不要只告诉用户“已创建”，还要说明每个子会话负责什么。
- 等待结果后，整合关键发现，不要把多个子会话结果原样堆给用户。
- 如果不建议创建子会话，直接说明原因，并使用更轻量的 SubAgent 或普通工具完成。

## 简单 BDD 手动测试

### Scenario 1：线性流程应使用 Workflow

Given 用户说：“按发布检查流程一步步来，每完成一阶段先停下来等我确认。”

When Agent 判断任务步骤强依赖、需要阶段确认。

Then Agent 应使用 Workflow / Skill 工作流或普通计划推进，不调用 `collaboration.delegate_agent`。

### Scenario 2：独立并行任务应使用 Proma 协作编排

Given 用户说：“帮我并行开几个 Agent，一个看主进程实现，一个看前端展示，一个看测试缺口，最后汇总。”

When Agent 判断多个方向互相独立、可以并行、用户需要看到子会话。

Then Agent 应调用 `collaboration.delegate_agents` 或多次调用 `collaboration.delegate_agent` 创建真实子会话，并在合适时机调用 `collaboration.wait_for_delegations` 汇总结果。

### Scenario 3：短调研应使用 SDK SubAgent

Given 用户说：“快速帮我找一下创建 Agent 会话的函数在哪里。”

When Agent 判断任务是短搜索、只需要一个结论。

Then Agent 应使用 SDK SubAgent 或普通搜索工具，不创建真实 Proma 子会话。

### Scenario 4：大批量分片应批量创建并部分收敛

Given 用户说：“把 30 个模块并行分给 Agent 做只读风险扫描，先返回最早完成的 5 个结果。”

When Agent 判断任务已经天然分片，且每片可以独立完成。

Then Agent 应调用 `collaboration.delegate_agents` 批量创建子会话，并用 `collaboration.wait_for_delegations` 的 `mode=any`、`minCompleted=5` 先收敛一部分结果。

### Scenario 5：父会话派发后应继续独立主线

Given 用户说：“一个 Agent 查历史回归原因，你继续把当前修复做完，最后合并判断。”

When Agent 判断子会话调研和父会话实现可以并行推进。

Then Agent 应先调用 `collaboration.delegate_agent` 创建调研子会话。

And 父会话不应立即空等全部结果。

And 父会话应继续推进可独立完成的实现或验证。

And 到需要调研结论做决策时，再调用 `collaboration.wait_for_delegations` 或 `collaboration.get_delegation_results` 收敛结果。
