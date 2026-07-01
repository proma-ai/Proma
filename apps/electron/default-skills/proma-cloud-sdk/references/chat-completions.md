# OpenAI ChatCompletions API（多厂商通用入口）

Proma Cloud 透传 OpenAI ChatCompletions 协议。GPT / Gemini 系列**只能**走这里；Claude / glm / deepseek 也能走这里（但走 messages 表达力更强）。

## Endpoint

```
POST {API_ROOT}/v1/chat/completions
Headers:
  Authorization: Bearer {apiKey}
  Content-Type: application/json
```

> `API_ROOT = baseUrl.replace(/\/api\/v1\/?$/, '')` —— 把 `get_credentials` 的 baseUrl 幂等归一化成根域名。baseUrl 若形如 `https://api.proma.cool/api/v1` → `API_ROOT = https://api.proma.cool`，完整 URL = `https://api.proma.cool/v1/chat/completions`。详见 SKILL.md「baseUrl 归一化」。

## 最小请求

```bash
curl -X POST "${API_ROOT}/v1/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "max_tokens": 512,
    "messages": [
      { "role": "user", "content": "用一句话总结：..." }
    ]
  }'
```

> ⚠️ 模型 ID 用 `/v1/models` 现查，不要照抄示例。平台模型几乎都是推理模型，`max_tokens` 务必 ≥ 512（见下方「推理模型」章节）。

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
  "model": "deepseek-v4-flash",
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

Gemini / DeepSeek 不全支持，先用 `json_object` 兜底。

## Function Calling

```json
{
  "model": "gpt-5-mini",
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

## 推理模型（重要 — 平台模型几乎全是推理模型）

Proma 平台上几乎所有模型 `supportsReasoning=true`。推理模型在 chat/completions 下的行为和普通模型不同：

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "正面",                          // 最终答案
      "reasoning_content": "这条评论表达了..."     // 思考链（额外字段）
    },
    "finish_reason": "stop"
  }]
}
```

**关键坑**：`max_tokens` 同时覆盖「思考链 + 最终输出」。如果设太小，思考还没结束 token 就用光了：

```json
{
  "message": { "content": "", "reasoning_content": "我们被要求..." },  // content 空！
  "finish_reason": "length"                                          // 被截断
}
```

实测 `deepseek-v4-flash` 做情感分类，`max_tokens=16` 时 `content` 全空，`max_tokens=512` 才正常输出。

**规则**：

1. 即使是分类/抽取这种「答案很短」的任务，`max_tokens` 也要 ≥ 512，复杂任务 2048~4096
2. 解析时取 `message.content` 作为答案；`reasoning_content` 是思考过程，一般丢弃
3. 看到 `content` 为空 + `finish_reason: "length"`，就是 max_tokens 不够，加大重试
4. 部分模型支持 `reasoning: {"enabled": false}` 关闭思考（实测 deepseek 接受该参数，但行为因模型而异，不要依赖）

## Usage 字段解析（算成本用这些）

chat/completions 的 `usage` 字段在 Proma 平台上较「丰富」，但有坑：

```json
{
  "usage": {
    "prompt_tokens": 89,        // ✅ 输入 token，算成本用这个
    "completion_tokens": 32,    // ✅ 输出 token（含 reasoning），算成本用这个
    "total_tokens": 121,
    "input_tokens": 89,         // 冗余字段
    "output_tokens": 0,         // ⚠️ 推理模型下可能为 0，不要用它算成本！
    "usage_semantic": "openai",
    "usage_source": "anthropic"
  }
}
```

**成本计算统一用 `prompt_tokens` + `completion_tokens`**，不要用 `input_tokens` / `output_tokens`（推理模型下 `output_tokens` 实测为 0，会严重低估成本）。

## 模型选择对照

| 场景 | 推荐（以 `/v1/models` 实际清单为准）|
|---|---|
| 通用聊天 / 写作 | claude-sonnet-5 / gpt-5.4 |
| 便宜批处理 | deepseek-v4-flash / gpt-5-mini / gemini-3-flash-preview |
| 中文 | glm-5.2 / deepseek-v4-* |
| 代码生成 | deepseek-v4-pro / claude-sonnet-5 |
| 长文档 | gemini-3.1-pro-preview / deepseek-v4-*（1M 上下文）|
| 最高质量 | claude-opus-4-8 / gpt-5.5 |

> ⚠️ 模型 ID 会随平台变，**每次现查 `/v1/models`**，不要硬编码上表。

## 错误处理

详见 `error-handling.md`。常见：

- 400 → 参数错（model 不存在、context 超限）
- 401 → key 失效
- 402 → 余额不足
- 429 → 速率限制
- 5xx → 上游异常
