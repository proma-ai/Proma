---
name: proma-cloud-sdk
description: Proma Cloud LLM API 调用指南。当 Agent 需要批量调用 LLM 处理任务（批量抽取、翻译、分类、打标签、OCR、长文档摘要、检索）、用便宜模型代替自己直接回答、或使用专用模型（Gemini 长上下文、Qwen 中文、DeepSeek 代码）时触发。提供 Anthropic Messages、OpenAI ChatCompletions、Embeddings 三套接口的完整调用模板、模型 preset 归类、错误处理。凭据通过 mcp__proma-cloud__get_credentials 获取。
version: 1.1.0
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

## 调用流程

1. **获取凭据**：调 `mcp__proma-cloud__get_credentials` 拿 `{ apiKey, baseUrl }`
2. **首次列模型**（会话内一次）：`GET ${baseUrl}/v1/models` 获取可用模型列表，按规则归类到 preset
3. **按场景调用**：chat/completions / messages / embeddings
4. **处理响应 + 成本聚合**

完整模型选择流程见 `references/model-selection.md`。

## 三套接口快速选择

| 任务 | 用哪套 | 接口 |
|---|---|---|
| Claude 模型、prompt caching、tool use、thinking | Anthropic Messages | `POST /v1/messages` |
| 其他厂商模型（GPT / Qwen / DeepSeek / Gemini） | OpenAI ChatCompletions | `POST /v1/chat/completions` |
| 文本向量化 | OpenAI Embeddings | `POST /v1/embeddings` |
| Token 计数（预估成本） | Anthropic | `POST /v1/messages/count_tokens` |

注：Anthropic 的 Messages 是首选——支持 prompt caching（重复 system prompt 大幅省成本）、thinking、tool use 表达力最强。其他模型走 chat/completions 时也都是统一 OpenAI 风格。

## 模型 Preset（首次启动时动态归类）

会话内首次需要本 Skill 时调一次 `/v1/models`，按命名规则把所有模型归类成 preset，缓存到 `${cwd}/.proma-models.json`：

| Preset | 用途 | 典型候选 |
|---|---|---|
| `fast` | 简单任务、批处理 | Haiku / GPT-4o-mini / Qwen turbo |
| `smart` | 复杂推理、生成 | Sonnet / GPT-4o / DeepSeek |
| `smartest` | 最高质量 | Opus / o1 |
| `long-context` | 长文档 (>50k tokens) | Gemini 1.5 Pro / Sonnet |
| `chinese` | 中文优势 | Qwen max / Qwen turbo |
| `code` | 代码生成 | DeepSeek Coder / Sonnet |
| `embedding` | 向量 | text-embedding-3-small / bge-large |

具体归类脚本见 `references/model-selection.md`。

## 关键约束

1. **调用前用 `count_tokens` 预估输入 token**，避免无意义的大调用
2. **批量场景必须并发限制**（≤ 10 并发，避免 429）
3. **错误重试**：429 / 502 用指数退避（1s, 3s, 9s），其他 4xx 不重试
4. **不要硬编码模型 ID**：会跟着平台版本变。每次启动新任务先查 `/v1/models`
5. **不要无谓递归调用**：脚本只调 Proma API，不要让脚本再反过来调本 Skill

## 成本意识（自行判断）

LLM 调用对用户敏感。判断三件事：

1. **任务匹配模型**：分类 / 抽取这种简单任务用便宜模型（Haiku / Qwen turbo），别拿 Opus / GPT-4o 当锤子
2. **批量场景务必开 prompt caching**：system prompt 标 `cache_control: ephemeral`，N > 3 时省 50%+
3. **大成本前告知用户**：依照场景判断阈值，宁可多说一句也别让用户被扣到飞起

API 响应里都带 `usage` 字段（input_tokens / output_tokens / cache_*），完成后聚合汇报实际消耗。

具体定价从 `/v1/models` 元数据或服务端反馈拿，**不要硬编码定价**（会跟着平台调整失效）。

## 详细参考

- `references/messages.md` — Anthropic Messages（含 tool use / thinking / prompt caching / vision）
- `references/chat-completions.md` — OpenAI 兼容接口完整参数（流式 / function calling / response_format）
- `references/embeddings.md` — 向量接口（模型选择、batch、维度）
- `references/model-selection.md` — 动态查询 + preset 归类（含可执行脚本）
- `references/error-handling.md` — 错误码处理、重试退避策略

**没有 examples** — 实际场景千差万别，Agent 自己判断怎么写脚本最合适。把上面 references 看一遍，结合任务上下文写就好。
