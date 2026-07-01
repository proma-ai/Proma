---
name: proma-cloud-sdk
description: Proma Cloud LLM API 调用指南。当 Agent 需要批量调用 LLM 处理任务（批量抽取、翻译、分类、打标签、OCR、长文档摘要、检索）、用便宜模型代替自己直接回答、或使用专用模型（Gemini 长上下文、Qwen 中文、DeepSeek 代码）时触发。提供 Anthropic Messages、OpenAI ChatCompletions、Embeddings 三套接口的完整调用模板、模型 preset 归类、错误处理。凭据通过 mcp__proma-cloud__get_credentials 获取。
version: 1.2.0
---

# Proma Cloud LLM 调用 SDK

通过 Proma Cloud（Inner Key 鉴权）调用全套 LLM 能力。本 Skill 是 **Agent 自用** — 让你写脚本、做批处理、调专用模型；不是给用户生成应用（那是 proma-build-ai-app）。

## 何时使用 vs 何时不用

### ✅ 使用本 Skill 的场景

- **批量处理**（> 10 项同结构任务）：批量抽取 PDF 摘要、批量翻译对话、批量分类文章
- **降本**：用户问简单的"分类 / 抽要点 / 改写"类问题，用 Haiku/Qwen turbo 调用便宜很多
- **专用模型**：
  - 处理 > 50k tokens 长文档 → Gemini 1.5 Pro
  - 中文场景 → Qwen
  - 代码生成 → DeepSeek Coder
- **embeddings 检索**：搜索 / 去重 / 相似度计算

### ❌ 不要使用本 Skill 的场景

- 普通对话 — Agent 自己答更好
- 单次简单调用 — 开销不抵省
- 用户没要求降本时 — 不要擅自切便宜模型导致质量下降
- **不要让生成的脚本反过来调本 Skill**（套娃禁止）

## ⚠️ baseUrl 归一化（务必先读）

拿到 `get_credentials` 的 `baseUrl` 后，**第一步永远先归一化成根域名**：

```javascript
const { apiKey, baseUrl } = creds
const API_ROOT = baseUrl.replace(/\/api\/v1\/?$/, '')   // 幂等：带 /api/v1 则剥掉，已是根域名则不变
```

```bash
API_ROOT="${BASE_URL%/api/v1}"   # bash 等价写法
```

归一化后，平台两类端点都从 `API_ROOT` 拼接，**前缀不同**：

```text
LLM 端点（OpenAI / Anthropic 兼容）：API_ROOT + /v1/...
✅ POST ${API_ROOT}/v1/chat/completions
✅ POST ${API_ROOT}/v1/messages
✅ POST ${API_ROOT}/v1/embeddings
✅ GET  ${API_ROOT}/v1/models

工具 / 多模态 / 管理端点：API_ROOT + /api/v1/...
✅ GET  ${API_ROOT}/api/v1/multimodal-models?type=EMBEDDING   ← embedding 模型发现
✅ GET  ${API_ROOT}/api/v1/models                            ← 含定价/推理元数据的分组结构
✅ POST ${API_ROOT}/api/v1/tools/gpt-image-2/generate        ← 生图（见 proma-gpt-image-2 skill）
```

> 为什么要归一化：`get_credentials` 历史上返回过带 `/api/v1` 后缀的 baseUrl，直接 `${baseUrl}/v1/chat/completions` 会拼成 `/api/v1/v1/...` → 404。归一化到根域名后，LLM 走 `/v1/...`、工具走 `/api/v1/...` 各自带正确前缀，新旧 MCP 返回值都不踩坑（归一化是幂等的）。

## 调用流程

1. **获取凭据**：调 `mcp__proma-cloud__get_credentials` 拿 `{ apiKey, baseUrl }`，按上面规则归一化出 `API_ROOT`
2. **首次列模型**（会话内一次）：`GET ${API_ROOT}/v1/models` 获取可用模型列表，按规则归类到 preset
3. **按场景调用**：chat/completions / messages / embeddings
4. **处理响应 + 成本聚合**

完整模型选择流程见 `references/model-selection.md`。

## 三套接口快速选择

| 任务 | 用哪套 | 接口 |
|---|---|---|
| Claude / glm / deepseek 模型、prompt caching、tool use、thinking | Anthropic Messages | `POST /v1/messages` |
| GPT / Gemini 等模型，或统一 OpenAI 风格 | OpenAI ChatCompletions | `POST /v1/chat/completions` |
| 文本向量化 | OpenAI Embeddings | `POST /v1/embeddings` |

注：

- **Messages 接口有模型白名单**。只有 `enabledForMessages=true` 的模型能走 `/v1/messages`（实测：Claude 系列、`glm-5.2`、`deepseek-v4-*`）。GPT / Gemini 系列走 messages 会返回 `400 Model is not available`，**只能用 chat/completions**。模型的 `enabledForMessages` 字段在 `GET /api/v1/models` 的元数据里。
- Messages 是 Claude 系模型的首选——支持 prompt caching（重复 system prompt 大幅省成本）、thinking、tool use 表达力最强。
- **没有 `count_tokens` 端点**（`/v1/messages/count_tokens` 返回 404）。要预估成本，先用小 `max_tokens` 跑一条样本看 `usage`，再按比例推算批量总量。

## 模型 Preset（首次启动时动态归类）

会话内首次需要本 Skill 时调一次 `GET ${API_ROOT}/v1/models`，按命名规则把所有模型归类成 preset，缓存到 `${cwd}/.proma-models.json`：

| Preset | 用途 | 典型候选（以实际清单为准，会随平台变） |
|---|---|---|
| `fast` | 简单任务、批处理 | Haiku / gpt-5-mini / gemini-flash / deepseek-v4-flash |
| `smart` | 复杂推理、生成 | Sonnet / gpt-5.4 / deepseek-v4-pro |
| `smartest` | 最高质量 | Opus / gpt-5.5 |
| `long-context` | 长文档 (>50k tokens) | gemini-*-pro / Sonnet / deepseek-v4-*（1M 上下文）|
| `chinese` | 中文优势 | glm-5.2 / deepseek-v4-* / Qwen（若上线）|
| `code` | 代码生成 | deepseek-v4-pro / Sonnet |

> ⚠️ 上表只是命名约定示例，**绝不要硬编码**。模型清单会随平台迭代（实测当前有 claude-opus-4-8 / claude-sonnet-5 / claude-haiku-4-5-20251001 / glm-5.2 / gpt-5.4 / gpt-5.5 / gpt-5-mini / gemini-3.1-pro-preview / gemini-3-flash-preview / deepseek-v4-pro / deepseek-v4-flash 等，命名与旧版完全不同）。每次都现查 `/v1/models`。
>
> **embedding 模型不在 `/v1/models` 里**——它们在 multimodal-models 端点，见 `references/embeddings.md`。

具体归类脚本见 `references/model-selection.md`。

## 关键约束

1. **先用小样本估成本**：没有 `count_tokens` 端点。批量前先用小 `max_tokens` 跑 1-2 条样本，看 `usage` 实际消耗，再按比例推算总量
2. **批量场景必须并发限制**（≤ 10 并发，避免 429）
3. **错误重试**：429 / 502 用指数退避（1s, 3s, 9s），其他 4xx 不重试
4. **不要硬编码模型 ID**：会跟着平台版本变。每次启动新任务先查 `/v1/models`
5. **推理模型留足 max_tokens**：平台模型几乎全是推理模型，思考链会占用输出预算，简单任务 `max_tokens` 也要 ≥ 512，否则思考没结束就被截断（见 `references/chat-completions.md` 推理模型章节）
6. **不要无谓递归调用**：脚本只调 Proma API，不要让脚本再反过来调本 Skill

## 成本意识（自行判断）

LLM 调用对用户敏感。判断三件事：

1. **任务匹配模型**：分类 / 抽取这种简单任务用便宜模型（Haiku / deepseek-v4-flash），别拿 Opus / gpt-5.5 当锤子
2. **批量场景务必开 prompt caching**：system prompt 标 `cache_control: ephemeral`，N > 3 时省 50%+（仅 messages 接口 + Claude 系模型支持）
3. **大成本前告知用户**：依照场景判断阈值，宁可多说一句也别让用户被扣到飞起

API 响应里都带 `usage` 字段。**注意推理模型下 `output_tokens` 可能为 0**，算成本要用 `completion_tokens`（chat/completions）或 messages 接口的 `output_tokens`（准确，含 thinking）。完成后聚合汇报实际消耗。

具体定价从 `/api/v1/models` 元数据（`inputPricePer1M` / `outputPricePer1M`）拿，**不要硬编码定价**（会跟着平台调整失效）。

## 详细参考

- `references/messages.md` — Anthropic Messages（含 tool use / thinking / prompt caching / vision）
- `references/chat-completions.md` — OpenAI 兼容接口完整参数（流式 / function calling / response_format）
- `references/embeddings.md` — 向量接口（模型选择、batch、维度）
- `references/model-selection.md` — 动态查询 + preset 归类（含可执行脚本）
- `references/error-handling.md` — 错误码处理、重试退避策略

**没有 examples** — 实际场景千差万别，Agent 自己判断怎么写脚本最合适。把上面 references 看一遍，结合任务上下文写就好。
