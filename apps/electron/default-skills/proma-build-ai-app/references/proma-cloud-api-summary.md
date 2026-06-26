# Proma Cloud API 速查（应用内调用）

应用里的 LLM 调用代码模板。完整细节见姐妹 Skill `proma-cloud-sdk` 的 references。

## Endpoint 速查

| 用途 | 接口 |
|---|---|
| Claude 系列文本（首选） | `POST {baseUrl}/v1/messages` |
| 其他模型文本 | `POST {baseUrl}/v1/chat/completions` |
| Embeddings | `POST {baseUrl}/v1/embeddings` |
| 生图 (Nano Banana) | `POST {baseUrl}/api/v1/tools/generate-image` |
| 生图 (GPT Image 2) | `POST {baseUrl}/api/v1/tools/gpt-image-2/generate` |

凭据：`Authorization: Bearer ${apiKey}` header。

## CORS 已开

`allow_origins=["*"]` — 浏览器（HTML 工具）可直接 fetch，不需要代理。

## HTML / Browser fetch — Anthropic Messages

```html
<script>
  const PROMA_API_KEY = 'pk_xxx';       // 由 Agent 注入
  const PROMA_API_BASE = 'https://api.proma.cool';
  const MODEL = '{{MODEL}}';            // Agent 生成时填真实模型 ID（先查 /v1/models，勿硬编码）

  async function callClaude(prompt, { system = '', maxTokens = 1024 } = {}) {
    const body = {
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (system) body.system = system;

    const r = await fetch(`${PROMA_API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PROMA_API_KEY}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const data = await r.json();
    return { text: data.content[0].text, usage: data.usage };
  }
</script>
```

## HTML / Browser fetch — OpenAI ChatCompletions（用 GPT / DeepSeek / Gemini 等非 Claude 模型）

```javascript
async function callChat(prompt, { system = '', model = MODEL } = {}) {   // MODEL 由 Agent 生成时填真实 ID
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const r = await fetch(`${PROMA_API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PROMA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return { text: data.choices[0].message.content, usage: data.usage };
}
```

## 流式输出（Anthropic SSE）

```javascript
async function* streamClaude(prompt, { system = '', model = MODEL } = {}) {
  const r = await fetch(`${PROMA_API_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PROMA_API_KEY}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      stream: true,
      ...(system && { system }),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          yield evt.delta.text;
        }
      } catch {}
    }
  }
}

// 用法
for await (const chunk of streamClaude("Tell me a story")) {
  resultEl.textContent += chunk;
}
```

## 错误处理

```javascript
async function callWithRetry(fn, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      // 重试条件：429 / 5xx / 网络错误
      const status = parseInt((e.message.match(/HTTP (\d+)/) || [])[1]);
      const retryable = !status || [429, 500, 502, 503, 504, 529].includes(status);
      if (retryable && i < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * 3 ** i));
        continue;
      }
      throw e;
    }
  }
}
```

## 其他形态（CLI 等）

按用户场景直接写，不预设模板。核心要点：

- 凭据从环境变量（`process.env` / `os.environ`）读
- 用 `.env` + `python-dotenv` / `dotenv` 加载
- `.gitignore` 必须含 `.env`
- 加最小重试和 token 数打印

## 想要更复杂的能力

如果应用需要 prompt caching / tool use / vision / 批量并发，让 Agent 读 `proma-cloud-sdk` 的 references：

- `proma-cloud-sdk/references/messages.md` — Anthropic 完整能力
- `proma-cloud-sdk/references/chat-completions.md` — OpenAI 兼容完整能力
- `proma-cloud-sdk/references/embeddings.md`
- `proma-cloud-sdk/references/error-handling.md`
- `proma-cloud-sdk/references/model-selection.md`

本文件只给应用生成最常用的代码模板。
