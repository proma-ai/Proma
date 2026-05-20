---
name: proma-generate-image
description: 备选生图工具（仅在用户明确指定时触发）。当用户消息中明确提到 "Nano Banana"、"Gemini"、"Google 生图"、"Flash 模型"、"Pro 模型"、"便宜模式"、"省积分"、"快速生图"、"thoughtSignature" 等关键词时使用此 Skill。基于 Google Gemini Image Generation，提供 Flash（便宜快、Nano Banana 2）和 Pro（高质量、Nano Banana Pro）两个模型，支持参考图、多种宽高比、1K/2K/4K 分辨率。普通生图场景（用户没指定模型）请用 proma-gpt-image-2。版本 1.1.0。
version: 1.1.0
---

# Nano Banana 生图（备选）

通过 Proma Cloud 调用 Nano Banana（Google Gemini Image Generation）生成或编辑图片。

> ⚠️ **这不是默认生图 Skill**。Proma Agent 默认用 `proma-gpt-image-2`（GPT Image 2）。
> 只有用户**明确**要求 Nano Banana / Gemini / Flash 模型 / "便宜模式" / "省积分" 时才使用本 Skill。

## 何时使用本 Skill

仅在以下情况触发：

- 用户消息明确出现关键词："Nano Banana"、"Gemini"、"Google 生图"、"Flash"、"Pro 模型"
- 用户明确说"用便宜的模型"、"省积分"、"快速生图"
- 用户在前一轮用过 Nano Banana 后说"继续用同一个模型"
- 多轮快速迭代场景下用户主动要求降本

其他所有生图场景（用户没指定模型）一律用 **proma-gpt-image-2**（GPT Image 2，默认生图工具）。

## 何时**不要**用本 Skill

- 用户只说"画一张图 / 生成图片 / P 图"，没指定模型 → 用 proma-gpt-image-2
- 用户需要 mask 精确编辑 → 用 proma-gpt-image-2（本 Skill 不支持 mask）
- 用户明确说"用 GPT / OpenAI" → 用 proma-gpt-image-2

## 调用流程

1. **获取凭据**：调用 MCP 工具 `mcp__proma-cloud__get_credentials`，得到 JSON 文本 `{ "apiKey": "pk_...", "baseUrl": "https://..." }`
2. **选择模型**（参考 `references/pricing.md`）：
   - 默认 `gemini-3.1-flash-image-preview`（便宜、速度快、Nano Banana 2）
   - 用户明确说"要高质量 / 用 Pro / 更好的"时切到 `gemini-3-pro-image-preview`
3. **构造请求体**（Gemini 原生格式，见 `references/api-spec.md`）
4. **调用接口**：`POST ${baseUrl}/api/v1/tools/generate-image`，header `Authorization: Bearer ${apiKey}`
5. **解析响应**：从 `candidates[0].content.parts[].inlineData` 提取 base64 图片
6. **保存图片**：写到 `${cwd}/generated-images/<timestamp>-<random>.png`
7. **回显用户**：用 Markdown 图片语法 `![](./generated-images/xxx.png)`

完整 curl 示例见：
- 纯文生图：`examples/text-to-image.md`
- 带参考图编辑：`examples/edit-with-reference.md`
- 多轮编辑（**重要**）：`examples/multi-turn-editing.md`

## 关键约束（写错会失败）

1. **`numberOfImages` 只能放在请求顶层**，不要塞进 `generationConfig.imageConfig`（上游 Gemini API 会返回 400 INVALID_REQUEST_BODY）
2. **参考图必须通过 `contents[0].parts[].inlineData` 传**，最多 10 张，累计 base64 解码后 ≤ 50MB（避免请求体过大被服务端 413/502）
3. **多轮编辑时只传上一张图作为参考**，不要保留 `contents` 历史（保留历史会让请求体每轮翻倍累积，最终超限）
4. **prompt 用英文效果最好**，Gemini 对英文 prompt 的理解和遵循度显著高于中文
5. **图片保存目录使用相对路径** `./generated-images/`，配合 Markdown 引用即可被客户端正确渲染

## 错误码处理

详见 `references/error-codes.md`。常见：

- `401 Unauthorized` → API Key 失效，提示用户重新登录或重启应用
- `402 Payment Required` → 余额不足，告知用户充值或减少 `numberOfImages`
- `413 Payload Too Large` → 请求体超 50MB，减少参考图或压缩
- `502 Bad Gateway` → 上游 Gemini 异常，重试 1-2 次仍失败则告知用户

## 详细参考

- `references/api-spec.md`：完整请求/响应 schema、所有字段、所有枚举值
- `references/pricing.md`：模型 × 分辨率定价矩阵（与 GPT Image 2 的成本对比）
- `references/error-codes.md`：所有错误码 + 用户友好提示文案
- `examples/`：完整可执行的 curl/bash 示例
