---
name: agent-collaboration
description: Proma 协作子 Agent Skill。当需要并行探索多个方向（多样性探索）、对抗性审查验证已有方案、或多个长耗时独立任务需要真实可见的子会话时触发。用于判断是否以及如何调用 Proma 内置 collaboration 工具创建协作子会话。简单搜索、短调研、单文件修改、一次性代码审查优先使用 SDK SubAgent。
group: proma
version: “1.1.0”
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

- 多个独立方向可以并行推进，例如”一个读后端、一个读前端、一个查测试”。
- 子任务会明显耗时，且用户希望看到实时进展。
- 子任务需要完整保留上下文和结果，后续可能单独打开追溯。
- **对抗式编排**：一个子会话负责实现/分析，另一个子会话以独立视角做对抗性审查验证（只提建议不改文件）。
- **多样性编排**：方向不唯一时并行派多个子 Agent，每个探索一个独立方向，最后父 Agent 汇总对比。
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

### 对抗式协作模式

**流程**：
1. 父 Agent 完成方案（实现、设计或分析），方案复杂度达到一定程度时考虑对抗式审查
2. 创建子 Agent，**不透露自己方案的具体内部实现思路**，只说明审查目标和产出
3. 子 Agent 以独立视角审查：挑战假设、寻找盲区、评估风险和边缘情况
4. 子 Agent 只返回审查报告，**不修改文件**
5. 父 Agent 逐条评估审查结论，决定采纳、调整还是忽略

**触发条件**：
- 方案涉及核心算法、安全机制、数据一致性等高正确性要求场景
- 父 Agent 对某些假设或决策不确定性较高
- 方案有一定复杂度，目测可能有未覆盖的边缘情况

**约束**：
- 子 Agent 只审查不修改——所有文件变更由父 Agent 执行
- 对抗式审查子 Agent 的建议级别：子 Agent 提出具体修改建议，父 Agent 判断是否采用
- 简单代码风格/格式问题不需要对抗式审查，用 `/code-review` 或 `/simplify` 即可

### 多样性探索模式

**流程**：
1. 父 Agent 识别出 2-3 个合理方向（不同架构、算法或技术路径）
2. 为每个方向派一个子 Agent，各自独立深度探索——方向少用 `delegate_agent`，方向清晰时用 `delegate_agents` 批量创建
3. 方向之间不相互干扰，每个子 Agent 聚焦自己的路径
4. 子 Agent 只调研不修改——产出方案报告（优缺点、风险、实施路径、推荐与否）
5. 父 Agent 汇总所有方向结果，做对比分析呈现给用户

**触发条件**：
- 解决方案的架构选型不确定
- 有多种合理的技术路径，且利弊权衡不直观
- 父 Agent 意识到自己的初始偏好可能影响客观判断

**注意**：
- 多样性探索是"调研驱动"，不是"实现竞争"——子 Agent 只做分析
- 收到所有方向结果后，父 Agent 先对比分析，再向用户呈现选项供决策

## 推荐工作流

1. 判断是否真的需要真实子会话；不需要时按 Workflow / Skill 工作流、SDK SubAgent 或普通工具推进。
2. 判断是否需要**对抗式**或**多样性**协作模式：
   - 方案已定但需要验证 → 考虑对抗式协作（先实现再派审查子 Agent）
   - 方向不唯一 → 考虑多样性探索（并行派多个调研子 Agent）
   - 纯并行独立任务 → 按方向直接拆分派发
3. 为每个独立方向调用 `collaboration.delegate_agent`；方向已清晰时用 `collaboration.delegate_agents` 批量创建。
4. 根据任务关系决定父会话下一步：
   - 如果父会话后续工作强依赖子会话结果，调用 `collaboration.wait_for_delegations` 等待必要结果。
   - 如果父会话还有独立主线可推进，先继续处理自己的工作，不要因为已经派发子会话就空等。
   - 如果需要快速校准方向，用 `mode=any` / `minCompleted` 先收敛一部分结果，再决定父会话继续做什么。
5. 调用 `collaboration.wait_for_delegations` 收敛结果；几十个并行任务可以先用 `mode=any` 等一部分完成，再决定是否继续等待或停止剩余任务。非阻塞推进时，可以先 `list_delegations`，再用 `get_delegation_results` 按 ID 拉取结果。
6. 整合子会话发现，明确哪些结论来自哪个子会话。
7. 如某个子会话或一批子会话卡住、重复或方向错误，用 `collaboration.stop_delegation` / `collaboration.stop_delegations` 停止。

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

### Scenario 6：对抗式协作——子 Agent 审查父 Agent 方案

Given 父 Agent 完成了核心算法模块的实现，涉及多线程安全和数据一致性。

When 父 Agent 判断方案复杂度较高、对正确性要求严格。

Then 父 Agent 调用 `collaboration.delegate_agent` 创建对抗性子 Agent。

And 在 task 描述中说明审查目标、范围和输出格式，不透露具体实现思路。

And 子 Agent 返回审查报告（风险点、假设挑战、边缘情况、改进建议），不修改文件。

And 父 Agent 逐条评估审查结论。

### Scenario 7：多样性探索——并行探索多个架构方向

Given 用户需要实现一个数据同步功能，有 Event-driven、Polling、WebSocket 三种可行方案。

When 父 Agent 识别到三种方案各有优劣、方向不唯一。

Then 父 Agent 调用 `collaboration.delegate_agents` 创建三个子 Agent。

And 每个子 Agent 独立探索一个方向，产出方案报告（优缺点、风险、实施路径）。

And 父 Agent 等待所有方向完成后，做对比分析呈现给用户。

And 子 Agent 不做代码修改，只产出分析报告。

### Scenario 8：对抗式审查发现盲区，父 Agent 决断

Given 对抗性子 Agent 审查父 Agent 方案时发现了一个边界条件未被覆盖。

When 子 Agent 在审查报告中指出该问题并提出具体修改建议。

Then 父 Agent 评估该建议的必要性和影响。

And 父 Agent 决定是否采纳建议，并由自己执行修改（子 Agent 不直接修改文件）。

And 父 Agent 向用户说明采纳了什么以及原因。
