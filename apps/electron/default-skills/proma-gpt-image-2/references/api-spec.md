# GPT Image 2 API Spec

完整的请求/响应 schema。以 Proma Cloud `/api/v1/tools/gpt-image-2/generate` 实际实现为准。

## Endpoint

```
POST {API_ROOT}/api/v1/tools/gpt-image-2/generate
Headers:
  Authorization: Bearer {apiKey}    # 从 mcp__proma-cloud__get_credentials 获取
  Content-Type: application/json
```

> ⚠️ `API_ROOT = baseUrl.replace(/\/api\/v1\/?$/, '')` —— 先把 `get_credentials` 的 baseUrl 幂等归一化成根域名再拼路径。否则若 baseUrl 带 `/api/v1` 后缀，`${baseUrl}/api/v1/tools/...` 会拼成 `/api/v1/api/v1/tools/...` → 404。

## 请求体

```json
{
  "prompt": "...",
  "image": null,
  "mask": null,
  "n": 1,
  "size": "1024x1024",
  "quality": "medium",
  "background": null,
  "moderation": null,
  "output_format": null,
  "output_compression": null
}
```

### 字段说明

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|---|---|---|---|---|
| `prompt` | string | 是 | — | 英文 prompt，描述要生成/编辑的图像 |
| `image` | string \| string[] \| null | 否 | `null` | **存在则触发 edit 模式**。可传 URL（`https://...`）或 data URL（`data:image/png;base64,xxx`）。多张参考图传数组 |
| `mask` | string \| null | 否 | `null` | 蒙版图（仅 edit 模式）。data URL 或公开 URL |
| `n` | int | 否 | `1` | 生成张数，1-10 |
| `size` | string | 否 | `"1024x1024"` | 见下方枚举 |
| `quality` | string | 否 | `"medium"` | `low` / `medium` / `high` |
| `background` | string \| null | 否 | `null` | 背景设置（如 `transparent`） |
| `moderation` | string \| null | 否 | `null` | 仅 text-to-image 转发 |
| `output_format` | string \| null | 否 | `null` | 输出格式 `png` / `webp` 等 |
| `output_compression` | int \| null | 否 | `null` | 压缩率（仅 text-to-image） |

### `size` 全部允许值

```
"auto", "1024x1024", "1024x1536", "1536x1024",
"2048x2048", "2048x1152", "3840x2160", "2160x3840"
```

> Edit 模式上游仅支持 `1024x1024` / `1024x1536` / `1536x1024`，其他值会在服务端**自动降级**（见 `edit-mode-fallback.md`），调用方无需关心。

### `quality` 全部允许值

```
"low", "medium", "high"
```

> Edit 模式下 `high` 会被服务端自动降级为 `medium`（上游 high + edit 必定超时）。

### `image` 字段格式

服务端通过该字段是否为 `null` 区分两种上游接口：
- `null` → 上游 `/v3/gpt-image-2-text-to-image`（纯文生图）
- `非 null` → 上游 `/v3/gpt-image-2-edit`（编辑模式）

格式示例：

```javascript
// 单张参考图（data URL，推荐）
"image": "data:image/png;base64,iVBORw0KGgo..."

// 单张参考图（公开 URL，需 OpenAI 上游可访问）
"image": "https://example.com/photo.jpg"

// 多张参考图
"image": [
  "data:image/png;base64,xxx",
  "data:image/png;base64,yyy"
]
```

## 响应体

成功时返回 HTTP 200：

```json
{
  "images": [
    "https://upstream.example.com/generated/xxx.png",
    "https://upstream.example.com/generated/yyy.png"
  ]
}
```

`images[]` 元素是**上游生成的图片 URL**（不是 base64）。调用方需要：
1. 用 fetch / curl 下载每个 URL
2. 检测 `Content-Type` 判断 mime
3. 保存到本地

### 下载示例（Bash）

```bash
for i in $(seq 0 $((N-1))); do
  url=$(jq -r ".images[$i]" response.json)
  curl -o "generated-images/${TIMESTAMP}-${i}.png" "${url}"
done
```

### 下载示例（Node.js）

```javascript
const fs = require('fs');
const { writeFileSync } = require('fs');
const path = require('path');

for (let i = 0; i < data.images.length; i++) {
  const res = await fetch(data.images[i]);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = res.headers.get('content-type')?.includes('webp') ? '.webp' : '.png';
  writeFileSync(`./generated-images/${ts}-${i}${ext}`, buf);
}
```

## 错误响应

非 200 时：

```json
{ "detail": "<error message>" }
```

详见 `error-codes.md`。

## 上游超时

由 `settings.GPT_IMAGE_2_TIMEOUT` 控制（通常 180-300 秒）。Edit + high quality 时较容易超时，服务端会主动降级 quality 为 medium 缓解。
