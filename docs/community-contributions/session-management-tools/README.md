# 时间线的剪枝者 —— 给 Proma 装上 Agent 会话管理能力

> 每一轮 Agent 对话都是一条时间线。Fork 就是时间线上长出的分支。剪枝就是放弃失败的探索路径，回退到上一个成功点重新来。我们让 Agent 自己成为了时间线的园丁。

---

## 一、缘起：为什么 Agent 需要管理自己的会话？

2026 年 2 月，我在使用 AI 编程助手时写下了一段笔记：

> "AI 编程或许像一个时间线游戏。每一轮对话都是一次时间线的分叉，我们可以使用平行时间线进行并行试错，也可以回滚一些深度上的递归。这有点像深度搜索和广度搜索优先算法——把一次对话看成一个分支，那么怎么快速高效地剪枝，可能就是解决问题的关键。"

这个想法后来演变成了"**时间线的剪枝者**"——一个完整的概念体系。它的核心隐喻是：

- **每一个 Agent 会话是一条时间线**。Fork 就是这条时间线上长出的分支。
- **广度探索**：把一个大任务拆成 N 个子任务，每个 Fork 一条时间线，并行探索。
- **深度跟进**：从成功的检查点继续 Fork，深入下一层。
- **剪枝**：失败的分支直接丢弃，回退到上一个成功点重新来。
- **竹节交接**：当上下文接近模型甜点区上限时，主动 Fork + 压缩上下文，让同一枝杈持续生长。

这在 Proma 中本该是非常自然的操作——Proma 本身就支持 Fork 会话。但缺了一个关键的东西：**Agent 自己无法操作这些能力**。Agent 被困在自己的会话里，不能创建新会话、不能 Fork 自己、不能给其他会话发消息。

**我们做的事情：给 Agent 装上了管理会话的双手。**

---

## 二、我们构建了什么

### 2.1 10 个 MCP 工具——Agent 的会话管理工具箱

通过在 Proma 商业版 `main.cjs` 上打补丁（不重编译，保留闭源模块），我们注入了一套插件系统，暴露了 10 个 MCP 工具：

| 工具 | 类型 | 用途 |
|---|---|---|
| `get_my_session_id` | 自指 | Agent 获取自己的会话 ID |
| `list_channels` | 只读 | 列出所有 AI 渠道及可用模型 |
| `list_workspaces` | 只读 | 列出所有工作区 |
| `list_sessions` | 只读 | 列出所有会话（支持工作区过滤） |
| `get_session_info` | 只读 | 查询任意会话详情 |
| `get_session_context` | 只读 | 查询会话 token 用量（上下文窗口/使用率） |
| `list_messages` | 只读 | 列出会话消息历史（UUID/角色/文本/分页） |
| `create_session` | 写入 | 创建新会话（指定渠道/模型/标题/工作区） |
| `fork_session` | 写入 | Fork 会话（支持 up_to_message_uuid 精确截断） |
| `send_message` | 写入 | 向目标会话发消息（reply 字段返回 Agent 输出） |

### 2.2 外部 MCP 服务——让任何工具都能调用

不仅如此，我们还把这 10 个工具暴露为独立的 **stdio MCP server**。外部工具（Claude Code、脚本、其他 Agent 框架）只需要一行配置就能调用：

```json
{
  "mcpServers": {
    "proma-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs"]
    }
  }
}
```

### 2.3 三种调用模式

```
模式1: 同步等待
  send_message(target, wait=true) → 阻塞等待 → 返回 reply 字段（Agent 实际输出）

模式2: 异步通知（内部 Agent 间）
  send_message(target, wait=false, notify=true) → 立即返回 → 完成后通知源会话

模式3: Fire-and-forget + 轮询回收（外部工具）
  send_message(target, wait=false) → 立即返回 "started"
  轮询 get_session_context(target) → token 稳定 → 完成
  list_messages(target) → 取结果
```

---

## 三、验证：老板-小弟-子小弟 三层联动

我们用 DeepSeek V4 Pro 作为"老板"，通过 MCP 工具创建"小弟"会话，小弟再创建"子小弟"——三层 Agent 协同工作：

```
老板 (DeepSeek V4 Pro)
  ├─ create_session → 小弟 (DeepSeek V4 Flash)
  │   ├─ send_message("自我检查") → 小弟调用 get_my_session_id ✅
  │   ├─ send_message("探索全局") → 小弟调用 list_channels + list_sessions ✅
  │   ├─ send_message("创建子小弟") → 小弟调用 create_session + send_message ✅
  │   │   └─ 子小弟回复: "收到，子小弟就位" ✅
  │   ├─ send_message("Fork自己") → 小弟调用 fork_session(up_to_message_uuid) ✅
  │   └─ 最终上下文: 160K tokens (16.0% of 1M 窗口)
  └─ 老板查看小弟消息历史: 76 条消息, 7 轮对话
```

3 个小弟并行调度 + 轮询回收：

```
Worker A (DS-Flash): Python, JavaScript, Rust, Go, TypeScript    (8秒)
Worker B (GLM-Air):  苹果、香蕉、橙子、草莓、葡萄                 (12秒)
Worker C (DS-Flash): 狗、猫、大象、老鹰、海豚                     (8秒)
                     全部 fire-and-forget, 轮询 4 次后全部回收
```

---

## 四、为什么这样做——从"手工作坊"到"工程流水线"

### 4.1 设计是搜索的艺术

Herbert Simon 在《人工科学》中论述：**设计本质上是一种搜索优化的过程**。我们很难获取绝对的全局最优解，但不同的搜索策略能让我们快速找到满意的局部最优解。

如果设计是搜索，那么：
- **Fork = 搜索树的分叉**
- **并行 Agent = 广度优先搜索**
- **竹节交接 = 深度优先搜索的上下文延续**
- **剪枝 = 放弃无效搜索路径**

这就是"时间线的剪枝者"——把 Agent 会话管理变成**搜索策略的执行器**。

### 4.2 上下文腐化与竹节交接

人脑也会"上下文腐化"——熬夜久了注意力不集中。人在睡觉时进行记忆的压缩和整理。

Agent 会话同样面临这个问题。每个模型都有一个**甜点区**（上下文最佳推理范围，通常为标称窗口的 30%-60%）。超出甜点区后，长尾信息遗漏概率升高，复杂推理退化。

**解决方案：竹节式自动交接。** 不是换一个分支，而是同一分支"被劈了一截，继续延长"。旧会话保留为竹节节点，新会话从同一检查点继续生长。

### 4.3 人-Agent 复合系统的效率边界

在未来的人-Agent 协作中，**人的审查能力边界，决定了整个复合系统的效率边界**。

人如果放弃或提高审查层级，就要把自己的位置提高一级——从员工到经理，从经理到组织构建者。每一次提层级，下属 Agent 都会变多。但 Agent 本身是概率性产出成功结果的，如果组织体系全部是 Agent，方向漂移就会成为重大问题。

**解决方式：嵌入靠谱的人类钉子，把组织工作的过程锚定在正确的方向。** 这套会话管理工具，就是让人更高效地进行这种"锚定"——快速创建 Agent Teams、派发任务、监控进度、审查产出、剪枝重试。

### 4.4 Agent 作为放大器

"每次对干活 Agent 的对话指导，都要在其他对话 Agent 和 SOTA 模型进行互动讨论——让 SOTA 做师爷为你参画。在这里，慢就是快。"

这套工具体系让这种工作流成为可能：一个"师爷"会话用 SOTA 模型分析问题、制定策略，然后把任务分派给多个"干活"会话用便宜模型执行。结果回收后，师爷再汇总审计。每个工程实践的总结和积累产生复利效应，越用越强。

---

## 五、技术实现

### 5.1 核心约束

不能从开源源码重构建 `main.cjs`——商业版含有 cloudAuth 等 15 个闭源模块。实际做法：

```
商业版 main.cjs (从 D:\Proma\resources\app.asar 提取)
    + 5 个 sed 补丁系列（B/B2/B3/A/C）
    + proma-dev-patches.cjs 插件文件 (710+ 行)
    + proma-mcp-server.cjs 外部桥接 (230+ 行)
    + 2 个 renderer 补丁（D/E）
    → D:\Proma-dev\resources\app\dist\
```

### 5.2 插件架构

```
main.cjs
  ├─ 补丁 A: MCP 钩子（检查 global.__proma_getMcpServers__）
  ├─ 补丁 B: API 桥接（global.__proma__ 12 函数）+ require 插件
  ├─ 补丁 C: 频道/模型元数据覆盖
  └─ proma-dev-patches.cjs
       ├─ createToolHandlers(sourceSessionId) → 10 个 handler
       ├─ createSessionMcpServer() → 内部 Agent 可见
       ├─ createExternalHttpBridge() → localhost HTTP (端口 19876-19895)
       └─ global.__proma_getMcpServers__ 注册

proma-mcp-server.cjs
  └─ 零依赖 MCP JSON-RPC stdio 桥接 → HTTP 转发
```

### 5.3 外部 MCP 架构

```
外部工具 (Claude Code / 脚本)
    │ stdio (MCP JSON-RPC)
    ▼
proma-mcp-server.cjs          ← 纯 Node.js，零外部依赖
    │ HTTP POST /:tool_name
    ▼
proma-dev-patches.cjs         ← Electron 主进程内
  localhost:19876-19895       ← 20 端口自动选择
```

### 5.4 关键技术点

- **Handler 共享**：内部 MCP server 和外部 HTTP bridge 共用同一套 handler 函数
- **端口发现**：HTTP bridge 启动时写入 `~/.proma-dev/mcp-bridge-port.json`，外部 MCP server 启动时读取
- **send_message 结果回传**：`wait=true` 完成后通过 `getAgentSessionSDKMessages` 读取最后一条 assistant 消息文本
- **轮询判定**：`get_session_context` 连续两次 token 计数不变且非零 → 认为任务完成

---

## 六、快速开始

### 6.1 创建 Dev 版 Proma

```bash
# 1. 复制正式版
cp -r D:/Proma D:/Proma-dev

# 2. 解包 ASAR
cd D:/Proma-dev/resources
npx asar extract app.asar app
mv app.asar app.asar.disabled

# 3. 合并原生模块
cp -r app.asar.unpacked/node_modules/* app/node_modules/
```

### 6.2 打补丁

详细 sed 命令见 [setup-guide.md](./setup-guide.md)。

### 6.3 配置外部 MCP

在 Claude Code 的 `.claude/mcp.json` 中：

```json
{
  "mcpServers": {
    "proma-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs"]
    }
  }
}
```

---

## 七、版本演进

| 版本 | 日期 | 里程碑 |
|---|---|---|
| v0.6 | 2026-06-15 | 插件化 MCP 工具系统，5 个会话管理工具 |
| v0.7 | 2026-06-15 | 渲染器模型同步修复 |
| v0.8 | 2026-06-15 | `get_session_context` 上下文甜点区监控 |
| v0.9 | 2026-06-16 | 外部 MCP 服务（stdio），7 工具外部可用 |
| v0.10 | 2026-06-16 | 多工作区 + 消息列表 + send_message 结果回传 |
| v0.10.1 | 2026-06-16 | `get_my_session_id` 自指工具 + 内部 Agent 间调用验证 |

---

## 八、致谢与展望

这套工具是"时间线的剪枝者"概念的第一步基础设施。当下的 10 个工具让 Agent 能够：

1. **感知自己**（`get_my_session_id`, `get_session_context`）
2. **感知环境**（`list_channels`, `list_workspaces`, `list_sessions`）
3. **操作环境**（`create_session`, `fork_session`, `send_message`）
4. **审查结果**（`list_messages`, `get_session_info`）

下一步的"时间线剪枝者"Layer 2——树形任务编排、竹节自动交接、并行槽位管理、果实审计——将建立在这套基础设施之上。

> 几百年前，机器替代了手工业者。现在，脑力劳动也面临着同样的境遇。工程学和管理学，都将因为 AI Agent 与自然人的不同，而迎来新的范式。我们正在做的，就是在这个过程中递上一块砖。

---

*作者：周星星 + Proma Agent (Claude)*
*日期：2026-06-16*
*仓库：[orphiczhou/Proma](https://github.com/orphiczhou/Proma)*