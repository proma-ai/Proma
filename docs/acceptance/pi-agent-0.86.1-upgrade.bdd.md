# Pi Agent 0.86.1 升级：手工 BDD 验收

**目标分支：** `agent/pi-0.86.1-upgrade`
**Worktree：** `/Users/erlich/Workspace/Project/Agent/Proma-Comm/PromaCommercial-pi-0.86.1-upgrade`
**范围：** Pi 运行时从 0.85.1 升级到 0.86.1，以及 Proma 对 transcript、工具结果 JSON 契约和重试策略的适配。

## 验收前准备

1. 从该 worktree 启动开发版 Proma，不要使用主工作目录构建的应用。
2. 准备至少一个可用的官方或第三方 Agent 渠道；Copilot 和 Codex 场景仅在对应 OAuth 已登录时执行。
3. 在测试记录中保存：时间、模型、渠道、会话 ID、失败时的 Agent 日志和截图。
4. 除“受控网络中断”场景外，不要在生产会话或生产渠道上做故障注入。

---

## Feature: Pi 0.86.1 运行时可正常启动

### Scenario: 新建 Agent 会话并完成基础工具调用

**Given** 我运行的是本 worktree 构建的 Proma 开发版
**And** 已选择一个可正常响应的 Agent 模型
**When** 我创建新 Agent 会话并请求“列出当前项目根目录下的前十个文件，然后用一句话说明项目用途”
**Then** Agent 应完成文件读取并给出最终回答
**And** 工具调用、工具结果和最终消息均应正常显示
**And** 日志中不应出现 `AgentContext.systemPrompt`、`ProviderStreams` 或 `StreamFunction` 的运行时错误

### Scenario: 正常多轮续接不会丢失上下文

**Given** 我已完成上述基础会话
**When** 我继续追问“从刚才列出的文件中，指出最可能的应用入口，并说明依据”
**Then** Agent 应引用上一轮已经读取的文件信息
**And** 不应重新执行无必要的全部目录扫描
**And** 不应出现 transcript 格式或工具结果解析错误

---

## Feature: Pi 0.86 transcript 下的动态项目指令

### Scenario: 进入嵌套目录时加载该目录的 AGENTS.md

**Given** 一个测试项目具有根目录 `AGENTS.md`
**And** `packages/demo/AGENTS.md` 包含一条可观察的规则，例如“修改此目录内容前必须先说明 `DEMO_SCOPE_ACTIVE`”
**And** 当前 Agent 会话从测试项目根目录开始
**When** 我要求 Agent 读取或修改 `packages/demo/` 内的文件
**Then** 初次文件工具调用应因需要激活可信项目指令而被安全阻止并自动续接
**And** 后续 Agent 行为应遵循 `packages/demo/AGENTS.md` 的规则
**And** 会话不能因为动态注入项目指令而报错或中断

### Scenario: 不相关路径不会触发猜测式指令加载

**Given** 同一测试项目存在嵌套 `AGENTS.md`
**When** 我要求 Agent 处理项目外的路径，或仅讨论一条 Bash 命令但不执行文件工具
**Then** Agent 不应声称已加载该嵌套目录的项目指令
**And** 不应出现误拦截的工具调用

---

## Feature: 工具结果满足 JSON-only 契约

### Scenario: MCP 或 Skill 返回结构化结果

**Given** 已配置一个会返回对象或数组的 MCP / Skill 工具
**When** 我要求 Agent 调用该工具，并在随后一轮要求它引用工具返回结果中的至少两个字段
**Then** 工具结果应完整显示或以产品既有截断策略显示
**And** Agent 应能在下一轮引用结果中的字段
**And** 不应出现 `details`、`BigInt`、`circular`、`JSON.stringify` 或“not JSON serializable”相关错误

### Scenario: 内置 Proma 工具的结果可继续被模型消费

**Given** 当前 Agent 会话可调用 TaskCreate、TaskUpdate 或其他返回对象的内置工具
**When** 我要求 Agent 创建一个测试任务，再说明该任务的标题和状态
**Then** 测试任务应创建成功
**And** Agent 的后续回答应能正确引用创建结果
**And** 不应因工具 `details` 的序列化而终止会话

> 测试结束后，请按产品正常界面清理该测试任务；不要在生产任务上做删除测试。

---

## Feature: 大工具输出后的压缩与续接

### Scenario: 自动压缩后保留关键上下文

**Given** 一个隔离测试会话和包含较多文本的本地测试文件或可公开读取的长文档
**When** 我要求 Agent 分段读取、摘要并比较多个长内容，使上下文接近或触发自动压缩
**And** 压缩完成后追问“列出此前确认的三个关键结论及其来源”
**Then** 会话应从压缩状态恢复并继续响应
**And** 回答应保留关键结论和正确来源
**And** 不应将完整工具 event 截断为损坏 JSON，不应丢失最终状态或 usage 相关消息

### Scenario: 大 MCP / Skill 输出不会卡死会话

**Given** 一个能够返回较长文本或多条结构化记录的 MCP / Skill
**When** 我要求 Agent 调用它并基于结果继续完成一项简单分析
**Then** UI 应持续展示进度，或按既有产品规则截断展示
**And** Agent 最终应进入 completed 或可解释的 error 状态
**And** 不应无限停留在 running、compacting 或 retrying 状态

---

## Feature: 官方 OAuth 模型兼容性

### Scenario: GitHub Copilot OAuth 会话正常工作（条件场景）

**Given** GitHub Copilot OAuth 已登录且有可用 GPT 模型
**When** 我在新会话中执行一次“读取一个文件 → 总结 → 继续追问”的三步任务
**Then** 每步都应完成
**And** 模型输出、工具调用和后续续接均应正常
**And** 不应出现 provider stream、认证刷新或模型参数兼容性错误

### Scenario: OpenAI Codex OAuth 与 Fast Mode 正常工作（条件场景）

**Given** OpenAI Codex OAuth 已登录并选择支持 Fast Mode 的模型
**And** 我已在会话中启用 Fast Mode
**When** 我执行一次包含至少一个只读工具调用的任务
**Then** 请求应完成且会话状态正常结束
**And** 关闭 Fast Mode 后再次执行同类任务也应完成
**And** 两种模式均不应发生重试循环、重复工具执行或计费错误提示

---

## Feature: 可控的原生重试

### Scenario: 一次短暂网络故障后自动恢复

**Given** 一个隔离测试渠道或本地代理，可安全制造一次短暂的 `Failed to fetch`、连接关闭或不完整 chunked 响应
**When** 我在 Agent 已发出请求后仅中断连接一次，并立即恢复上游可用性
**Then** Agent 应显示可理解的重试进度
**And** 单次等待不应超过约 60 秒
**And** 成功恢复后，原任务应继续完成且已完成的副作用工具不应被重复执行

### Scenario: 用户可取消持续重试

**Given** 测试上游持续不可用且 Agent 正在重试
**When** 我使用界面取消当前 Agent 运行
**Then** 取消应在当前等待周期内生效
**And** 会话应结束为 cancelled / aborted 或产品定义的等价状态
**And** 不应继续后台重试或自动重新执行工具

---

## Release Gate

| 等级 | 验收项 | 通过条件 |
| --- | --- | --- |
| P0 | 基础会话、多轮续接、动态项目指令、结构化工具结果、大输出压缩 | 全部通过；无运行时错误、卡死或重复副作用工具调用 |
| P1 | Copilot OAuth、Codex OAuth/Fast Mode | 对已配置渠道全部通过；未配置渠道标注为未执行 |
| P1 | 受控网络中断与取消 | 自动恢复和用户取消都符合场景预期 |

**结论记录模板：**

```text
版本/构建：
测试人：
测试时间：
通过场景：
未执行场景及原因：
失败场景：
会话 ID / 日志 / 截图位置：
发布建议：通过 / 阻塞
```
