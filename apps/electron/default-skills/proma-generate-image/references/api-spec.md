# Nano Banana API Spec

完整的请求/响应 schema 与所有字段定义。以 Proma Cloud `/api/v1/tools/generate-image` 实际实现为准。

## Endpoint

```
POST {API_ROOT}/api/v1/tools/generate-image
Headers:
  Authorization: Bearer {apiKey}     # 从 mcp__proma-cloud__get_credentials 获取
  Content-Type: application/json
```

`apiKey` 从 `get_credentials` 工具返回值中读取，不要硬编码。`API_ROOT = baseUrl.replace(/\/api\/v1\/?$/, '')` —— 先把 baseUrl 幂等归一化成根域名再拼路径，否则若 baseUrl 带 `/api/v1` 后缀会拼成 `/api/v1/api/v1/tools/...` → 404。

## 请求体（Gemini 原生格式）

```json
{
  "model": "gemini-3.1-flash-image-preview",
  "image_size": "1K",
  "numberOfImages": 1,
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "<English prompt>" },
        { "inlineData": { "mimeType": "image/png", "data": "<base64>" } }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9",
      "imageSize": "1K"
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|---|---|---|---|---|
| `model` | string | 是 | — | 见下方"支持的模型" |
| `image_size` | string | 否 | `"auto"` | `auto` / `1K` / `2K` / `4K`。**顶层**字段，用于服务端计费定价 |
| `numberOfImages` | int | 否 | `1` | 1-4。**仅用于计费乘数，不转发上游**。塞进 `generationConfig` 会导致上游 400 |
| `contents` | array | 是 | — | Gemini 原生对话历史，至少包含一条 user 消息 |
| `generationConfig` | object | 是 | — | Gemini 原生 generationConfig |

### `contents[].parts[]` 的 part 类型

```typescript
// 文本 part
{ "text": "Add sunglasses to the cat" }

// 内嵌图片 part（参考图，base64 编码原始字节）
{
  "inlineData": {
    "mimeType": "image/png" | "image/jpeg" | "image/webp" | "image/gif",
    "data": "<base64 string>"
  }
}
```

### `generationConfig` 字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `responseModalities` | string[] | 是 | 固定填 `["TEXT", "IMAGE"]` |
| `imageConfig.aspectRatio` | string | 否 | `1:1` / `16:9` / `4:3` / `9:16` / `3:4` |
| `imageConfig.imageSize` | string | 否 | `auto` / `1K` / `2K` / `4K`（与顶层同义，可不重复传） |

## 支持的模型

| Model ID | 别名 | 用途 |
|---|---|---|
| `gemini-3.1-flash-image-preview` | Nano Banana 2 / Flash | 通用，便宜，速度快（默认选择） |
| `gemini-3-pro-image-preview` | Nano Banana Pro | 更高质量，更贵，速度稍慢 |

定价见 `pricing.md`。

## 响应体（Gemini 原生格式）

成功时返回 HTTP 200，body 为上游 Gemini API 原始 JSON：

```json
{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [
          { "text": "Here's the image you requested..." },
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "<base64 of generated image>"
            },
            "thoughtSignature": "..."
          }
        ]
      },
      "finishReason": "STOP"
    }
  ]
}
```

### 解析图片

```python
import base64

for candidate in response["candidates"]:
    for part in candidate["content"]["parts"]:
        if "inlineData" in part:
            mime = part["inlineData"]["mimeType"]
            data = base64.b64decode(part["inlineData"]["data"])
            # 写入文件...
        elif "text" in part:
            print(part["text"])
```

### 多张图片
当 `numberOfImages > 1` 时，**仍只返回一个 candidate**（这是上游 API 的限制），但 `parts[]` 内会包含多个 `inlineData` 项。

## 错误响应

非 200 时返回：

```json
{ "detail": "<error message>" }
```

具体状态码与含义见 `error-codes.md`。

## 上游超时

服务端硬编码 360 秒。Pro 模型 + 4K 可能逼近上限，注意预留客户端超时余量。
