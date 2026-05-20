# OpenAI ChatCompletions API（多厂商通用入口）

Proma Cloud 透传 OpenAI ChatCompletions 协议。**Claude 之外的所有模型走这里**：GPT 系列、Gemini、Qwen、DeepSeek、Moonshot、智谱、百川……统一 OpenAI 风格。

## Endpoint

```
POST {baseUrl}/v1/chat/completions
Headers:
  Authorization: Bearer {apiKey}
  Content-Type: application/json
```

## 最小请求

```bash
curl -X POST "${BASE_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-turbo",
    "messages": [
      { "role": "user", "content": "用一句话总结：..." }
    ]
  }'
```

响应：
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1747654000,
  "model": "qwen-turbo",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "..." },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 23,
    "completion_tokens": 17,
    "total_tokens": 40
  }
}
```

## 通用参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `model` | string | 必传。模型 ID（从 `/v1/models` 查到） |
| `messages` | array | 必传。会话消息数组 |
| `max_tokens` | int | 输出 token 上限 |
| `temperature` | 0-2 | 创造性，默认 1.0；结构化任务用 0-0.3 |
| `top_p` | 0-1 | nucleus sampling |
| `n` | int | 生成几条回复（很少用） |
| `stream` | bool | SSE 流式输出 |
| `stop` | string \| array | 自定义停止符 |
| `presence_penalty` | -2 to 2 | 重复惩罚 |
| `frequency_penalty` | -2 to 2 | 频率惩罚 |
| `response_format` | object | 见下 — JSON 模式 |
| `tools` | array | function calling |
| `tool_choice` | string \| object | 工具选择策略 |

## Messages 结构

```json
[
  { "role": "system", "content": "You are a JSON-only classifier..." },
  { "role": "user", "content": "Article: ..." },
  { "role": "assistant", "content": "..." },  // 多轮对话时的历史
  { "role": "user", "content": "Now categorize this..." }
]
```

支持多模态（部分模型）：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What's in this image?" },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}
```

## JSON 模式（结构化输出）

```json
{
  "model": "qwen-turbo",
  "messages": [
    { "role": "system", "content": "Reply with JSON: { sentiment, confidence }" },
    { "role": "user", "content": "..." }
  ],
  "response_format": { "type": "json_object" }
}
```

注：`json_object` 模式下 prompt 里必须出现 "json" 字样，否则部分实现会报 400。

## JSON Schema 强约束（GPT-4o / 部分模型）

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "classification",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "sentiment": { "enum": ["positive", "negative", "neutral"] },
          "confidence": { "type": "number" }
        },
        "required": ["sentiment", "confidence"]
      }
    }
  }
}
```

Qwen / DeepSeek / Gemini 不全支持，先用 `json_object` 兜底。

## Function Calling

```json
{
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "Tokyo weather?" }],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "parameters": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  }]
}
```

响应：
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_...",
        "type": "function",
        "function": { "name": "get_weather", "arguments": "{\"city\":\"Tokyo\"}" }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

执行工具后回传：
```json
{
  "messages": [
    { "role": "user", "content": "Tokyo weather?" },
    { "role": "assistant", "tool_calls": [...] },
    { "role": "tool", "tool_call_id": "call_...", "content": "22°C, sunny" }
  ]
}
```

## 流式响应

```json
{ "model": "...", "messages": [...], "stream": true }
```

SSE：
```
data: {"choices":[{"delta":{"content":"H"}}]}

data: {"choices":[{"delta":{"content":"i"}}]}

data: [DONE]
```

## 模型选择对照

| 场景 | 推荐 |
|---|---|
| 通用聊天 / 写作 | gpt-4o / qwen-max |
| 便宜批处理 | gpt-4o-mini / qwen-turbo |
| 中文文学 | qwen-max |
| 代码生成 | deepseek-coder |
| 长文档 | gemini-1.5-pro |
| 数学推理 | o1 / o1-mini |

具体可用模型用 `/v1/models` 查。

## 错误处理

详见 `error-handling.md`。常见：

- 400 → 参数错（model 不存在、context 超限）
- 401 → key 失效
- 402 → 余额不足
- 429 → 速率限制
- 5xx → 上游异常
