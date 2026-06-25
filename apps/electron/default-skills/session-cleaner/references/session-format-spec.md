# Proma 会话 JSONL 格式规格

本文件记录 `~/.proma/agent-sessions/<session-id>.jsonl` 中观察到的两种会话格式,
供 `clean_session.py` 维护者参考。

## 目录结构

```
~/.proma/agent-sessions/
└── <session-id>.jsonl       # 每会话一个文件,JSONL(一行一条 JSON)
```

`session-id` 与 Proma 前端的会话 ID 一致,也与当前会话工作目录同名。

## 格式 B:SDK 流式快照(当前默认)

### 行级结构

每行是一个完整 JSON 对象,顶层字段:

```
{
  "type": "user" | "assistant" | "result" | "system",
  "message": { ... },         // Anthropic Messages 协议消息体
  "parent_tool_use_id": str|null,
  "_createdAt": <ms epoch>,
  "session_id": str,          // 仅 assistant/result
  "uuid": str,                // 仅 assistant/result
  "_channelModelId": str      // 模型名
}
```

### 关键行为:assistant 快照碎片化

一个 assistant 回合**会被拆成多行**,这些行**共享同一个 `message.id`**。
每行是该回合当前状态的**完整快照**(不是 delta),内容数组逐步增长:

```
行 2: id=a96c691b  content=[{thinking: ""}]
行 3: id=a96c691b  content=[{thinking: "...完成思考..."}, {text: "好的..."}]
行 4: id=a96c691b  content=[thinking, text, {tool_use: Read}]
行 5: id=a96c691b  content=[thinking, text, {tool_use: Read}, {tool_use: Grep}]
```

- 早先的 `text` / `thinking` / `tool_use` 块在后续快照中被**反复重发** → 冗余文本来源
- 逐字/逐块流式产生的近似前缀文本 → 拼接单字来源
- 最后一行通常是该回合的最完整快照

### message.content 块类型

| type | 字段 | 清洗处理 |
|------|------|---------|
| `text` | `text: str` | 保留原文 |
| `thinking` | `thinking: str, signature: str` | **丢弃**(chain-of-thought) |
| `tool_use` | `id, name, input: {...}` | 压缩为 `> [工具: name args]` 摘要 |
| `image` | 图片相关 | 保留为标记(当前少见) |

### user 行的 content 数组

```
"message": {
  "content": [
    {"type": "text", "text": "用户消息"},
    {"type": "tool_result", "tool_use_id": "...", "content": "..."}
  ]
}
```

- `text` 块:真用户发言,**保留**
- `tool_result` 块:工具回包,**丢弃**
- 若 user 行只有 tool_result 没有 text → 整个条目丢弃(不是真实用户发言)

### `type: "result"` 行
回合结果元数据(成功/失败、is_error),**整行丢弃**。

### `type: "system"` 行
系统提示,罕见,**整行丢弃**。

## 格式 A:旧扁平 chat

每行结构更简单:

```
{
  "id": "<ts>-<rand>",
  "role": "user" | "assistant",
  "content": "<string>",
  "createdAt": <ms epoch>
}
```

### 冗余表现

- `role: "assistant", content: ""` 空行 → **丢弃**
- 相邻两行 `role: "user"` 且 content 完全相同(用户重复发送)→ **去重**
- assistant 正文有时被拼接成多段叙述的一长串 → 保留原文(无法自动拆)
- 此格式无工具信息,无法产出工具摘要

## 清洗规则总结

| 步骤 | 规则 |
|------|------|
| 1. 格式探测 | 首行有 `type`+`message` → B;有 `role`+字符串 `content` → A |
| 2. 损坏行 | JSON 解析失败跳过,不中断 |
| 3. B 回合归并 | assistant 按 `message.id` 分组,取最后一行 content 作为最终 |
| 4. B 块过滤 | thinking 丢,tool_use 压缩,text 保留,tool_result 丢 |
| 5. A 去重 | 相邻相同 user 合并,空 assistant 丢 |
| 6. 排序 | 按文件出现顺序(已按时间) |
| 7. 渲染 | `## 用户` / `## 助手` 分段,工具行以 `>` 引用 |

## 工具调用摘要生成规则

`_summarize_tool_input(name, input)`:
- 遍历 input 字典,跳过空值
- 每个参数格式化为 `key=value`,value 超过 80 字符截断
- 示例: `Read file=C:/path/to/file.py limit=50`

## 已知边缘情况

- 极少数情况下最后一行快照缺失某 tool_use 块:脚本会从早期快照补回
- 同一回合的 text 块在不同快照中长度不一:取最后一行的最长版本
- 损坏行(截断的 JSON):静默跳过,不报错
