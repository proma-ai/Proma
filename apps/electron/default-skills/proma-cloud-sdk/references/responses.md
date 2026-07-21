# OpenAI Responses API（GPT-5.6 系列）

Proma Cloud 提供原生 OpenAI Responses API：

```text
POST {API_ROOT}/v1/responses
```

## 何时使用

以下 GPT-5.6 模型必须使用 Responses，**不要**请求 `/v1/chat/completions`：

- `gpt-5.6-terra`
- `gpt-5.6-sol`
- `gpt-5.6-luna`

Responses 原生支持推理事件、function tools、工具结果续传和 SSE 生命周期事件。使用前仍先调用 `GET {API_ROOT}/v1/models`，确认模型当前可用；模型清单会变化，不能依赖本文的静态列表。

## 认证与 Base URL

先通过 `mcp__proma_cloud__get_credentials` 获取 `{ apiKey, baseUrl }`，并归一化根地址：

```javascript
const { apiKey, baseUrl } = await getCredentials()
const API_ROOT = baseUrl.replace(/\/api\/v1\/?$/, '')
```

请求统一使用：

```http
Authorization: Bearer <apiKey>
Content-Type: application/json
```

Proma 会在响应头返回 `X-Proma-Trace-ID`。遇到问题时保留该值，用于支持与计费排查；不要把 API key、完整 prompt 或工具参数写进日志。

## 最小非流式请求

### curl

```bash
curl "${API_ROOT}/v1/responses" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.6-terra",
    "input": "Reply with exactly: OK",
    "max_output_tokens": 1024
  }'
```

### JavaScript（fetch）

```javascript
async function callResponses(prompt, {
  model = 'gpt-5.6-terra',
  maxOutputTokens = 1024,
} = {}) {
  const response = await fetch(`${API_ROOT}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: maxOutputTokens,
    }),
  })

  const traceId = response.headers.get('X-Proma-Trace-ID')
  if (!response.ok) {
    throw new Error(`Responses HTTP ${response.status} (trace: ${traceId ?? 'n/a'}): ${await response.text()}`)
  }

  const data = await response.json()
  return {
    data,
    traceId,
    usage: data.usage,
  }
}
```

### Python（httpx）

```python
import httpx

response = httpx.post(
    f"{api_root}/v1/responses",
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    },
    json={
        "model": "gpt-5.6-terra",
        "input": "Reply with exactly: OK",
        "max_output_tokens": 1024,
    },
    timeout=120,
)
response.raise_for_status()
data = response.json()
print("trace:", response.headers.get("X-Proma-Trace-ID"))
print("usage:", data.get("usage"))
```

## `input` 不是 Chat Completions 的 `messages`

简单文本可以直接传字符串：

```json
{
  "model": "gpt-5.6-terra",
  "input": "Summarize this text"
}
```

需要角色、上下文或工具结果时，使用 Responses input items：

```json
{
  "model": "gpt-5.6-terra",
  "input": [
    {"role": "developer", "content": "Answer concisely."},
    {"role": "user", "content": "Explain prompt caching."}
  ]
}
```

不要把 Chat Completions 风格的 `messages` 字段直接发送到 `/v1/responses`。

## 流式 SSE

请求中加入 `"stream": true`。SSE 的终态不是 `[DONE]`，请等待 `response.completed`、`response.incomplete` 或 `response.failed`。

```javascript
async function* streamResponses(prompt, { model = 'gpt-5.6-terra' } = {}) {
  const response = await fetch(`${API_ROOT}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 1024,
      stream: true,
    }),
  })

  const traceId = response.headers.get('X-Proma-Trace-ID')
  if (!response.ok || !response.body) {
    throw new Error(`Responses stream HTTP ${response.status} (trace: ${traceId ?? 'n/a'}): ${await response.text()}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const rawEvent of events) {
      const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      const event = JSON.parse(dataLine.slice(6))

      if (event.type === 'response.output_text.delta' && event.delta) {
        yield { type: 'text', delta: event.delta, traceId }
      }
      if (event.type === 'response.completed') {
        yield { type: 'completed', usage: event.response?.usage, traceId }
      }
      if (event.type === 'response.incomplete' || event.type === 'response.failed' || event.type === 'error') {
        throw new Error(`Responses ${event.type} (trace: ${traceId ?? 'n/a'})`)
      }
    }
  }
}
```

## Usage 与缓存 token

非流式响应的 `usage` 位于顶层；流式响应最终从 `response.completed.response.usage` 读取。关注：

```json
{
  "input_tokens": 4391,
  "input_tokens_details": {"cached_tokens": 3840},
  "output_tokens": 5,
  "total_tokens": 4396
}
```

- 普通输入 token：`input_tokens - cached_tokens`
- 缓存读取 token：`input_tokens_details.cached_tokens`
- 输出 token：`output_tokens`

Proma 会按模型配置自动计费并记录 usage。批量任务仍应先用小样本观察真实 usage；不要硬编码单价。

## Function tools 与工具结果

在顶层传入 Responses function tools：

```json
{
  "model": "gpt-5.6-terra",
  "input": "What is the weather in Beijing?",
  "tools": [
    {
      "type": "function",
      "name": "get_weather",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
        "additionalProperties": false
      },
      "strict": false
    }
  ]
}
```

当模型输出 `function_call` 后，执行本地工具，再将 `function_call_output` 作为后续 input item 传回。保留模型给出的 `call_id`，不要自行生成或修改：

```json
{
  "model": "gpt-5.6-terra",
  "input": [
    {
      "type": "function_call_output",
      "call_id": "call_abc",
      "output": "{\"temperature_c\": 26, \"condition\": \"sunny\"}"
    }
  ]
}
```

复杂多轮 tool loop 应保留上轮 Response 的必要 output/function-call items，按 OpenAI Responses 的原生协议续传。

## 常见错误

| 现象 | 处理 |
|---|---|
| GPT-5.6 调 `/v1/chat/completions` 失败 | 改为 `/v1/responses`，请求体从 `messages` 改为 `input`。 |
| `400 Model is not available` | 先查 `/v1/models`，确认模型当前开放；不要把 Chat 或 Messages 的模型可用性假设套到 Responses。 |
| `401` | 重新获取 Proma Cloud credentials；不要使用上游 provider key。 |
| `402` | 当前 API key 或账户余额/订阅额度不足。 |
| `429` / `502` / `503` / `504` | 对幂等批任务使用指数退避（1s、3s、9s），限制并发不超过 10。 |
| 流没有 `[DONE]` | 正常：Responses 用 `response.completed` 等终态事件。 |
