# Anthropic Messages API（首选）

Proma Cloud 透传 Anthropic Messages 协议，凭据走 `Authorization: Bearer pk_xxx`。**Claude 系列模型首选这个接口**——支持 prompt caching、thinking、tool use 等高级特性。

## Endpoint

```
POST {baseUrl}/v1/messages
Headers:
  Authorization: Bearer {apiKey}
  Content-Type: application/json
  anthropic-version: 2023-06-01
```

## 最小请求

```bash
curl -X POST "${BASE_URL}/v1/messages" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-haiku-4-5",
    "max_tokens": 1024,
    "messages": [
      { "role": "user", "content": "Summarize this in one sentence: ..." }
    ]
  }'
```

响应：
```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "..." }],
  "model": "claude-haiku-4-5",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 23,
    "output_tokens": 17,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

## System Prompt + Prompt Caching（批处理省钱关键）

批量任务的 system prompt 通常一样。**用 cache_control 标记后，重复调用只收 10% 输入费**：

```json
{
  "model": "claude-haiku-4-5",
  "max_tokens": 1024,
  "system": [
    {
      "type": "text",
      "text": "你是一个文章分类器。返回 JSON: {category, confidence}...",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [
    { "role": "user", "content": "<本次要分类的文章>" }
  ]
}
```

第一次调用：`cache_creation_input_tokens` 增加（多花 25% 费用建立缓存）
后续调用（5 分钟内）：`cache_read_input_tokens` 增加（只花 10% 输入费）

**批量场景中，N > 3 时 prompt caching 必开。**

## 流式响应

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 4096,
  "stream": true,
  "messages": [...]
}
```

返回 SSE 流，每行：
```
event: message_start
data: { "type": "message_start", ... }

event: content_block_delta
data: { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "..." } }

event: message_stop
data: { "type": "message_stop" }
```

批处理脚本通常**不用流式**（不需要边到边显示），用非流式响应更简单。

## Tool Use（让 LLM 调用工具）

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current weather for a city",
      "input_schema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ],
  "messages": [{ "role": "user", "content": "What's the weather in Tokyo?" }]
}
```

响应里会出现 `content` 包含 `tool_use` 块：
```json
{
  "content": [
    { "type": "tool_use", "id": "toolu_...", "name": "get_weather", "input": { "city": "Tokyo" } }
  ],
  "stop_reason": "tool_use"
}
```

你执行工具后，把结果 append 回去：
```json
{
  "messages": [
    { "role": "user", "content": "What's the weather in Tokyo?" },
    { "role": "assistant", "content": [{ "type": "tool_use", ... }] },
    { "role": "user", "content": [
      { "type": "tool_result", "tool_use_id": "toolu_...", "content": "22°C, sunny" }
    ]}
  ]
}
```

## Thinking（推理模式，仅部分模型）

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 2048,
  "thinking": { "type": "enabled", "budget_tokens": 8000 },
  "messages": [...]
}
```

适合需要深度推理的复杂任务。会消耗 thinking tokens（按输出价计费）。

## Vision（图片输入）

```json
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "<base64>" } },
      { "type": "text", "text": "What's in this image?" }
    ]
  }]
}
```

也支持 `"type": "url"` 直接传公开 URL。

## Token 计数（成本预估）

```bash
curl -X POST "${BASE_URL}/v1/messages/count_tokens" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-haiku-4-5",
    "messages": [...]
  }'
```

返回 `{ "input_tokens": 1234 }`。批处理前调一次估算总成本（见 `cost-awareness.md`）。

## JSON 输出（结构化提取）

Anthropic 不像 OpenAI 有 `response_format: json_object`，**通过 prompt 引导**：

```json
{
  "system": "Reply with valid JSON only. No prose, no markdown fences.",
  "messages": [{
    "role": "user",
    "content": "Extract from: ...\n\nSchema: { sentiment: 'positive'|'negative'|'neutral', confidence: 0-1 }"
  }]
}
```

更可靠的做法：让 LLM 用 `tool_use` 返回结构化结果（定义一个 fake tool 把数据填进去）。

## 常用参数速查

| 参数 | 默认 | 说明 |
|---|---|---|
| `max_tokens` | — | 必传。输出 token 上限。批处理任务建议 256-512 即可 |
| `temperature` | 1.0 | 创造性。结构化任务用 0.0-0.3 |
| `top_p` | 0.999 | nucleus sampling |
| `stop_sequences` | — | 自定义停止符 |
| `metadata.user_id` | — | 用户 ID（追踪用，但 Proma 已通过 API Key 记账） |

## 错误处理

详见 `error-handling.md`。

- 401 → key 失效
- 402 → 余额不足（Proma 层）
- 429 → 速率限制，退避重试
- 500/502/529 → 上游异常，退避重试
- 400 → 参数错（如 prompt 过长、model 不存在）
