# Example: Text-to-Image (GPT Image 2)

纯文生图模式（不传 `image` 字段）。

## 完整流程

### 步骤 1：获取凭据

调 MCP 工具 `mcp__proma-cloud__get_credentials`，提取 `apiKey` 和 `baseUrl`。

### 步骤 2：（建议）估算成本并告知用户

根据 size + quality + n，查 `references/size-quality-pricing.md` 算积分：

例：n=2, size=1024x1024, quality=medium → 0.83 × 2 = 1.66 积分

如果超过 5 积分，主动告知用户。

### 步骤 3：发送请求

```bash
API_KEY="pk_xxx"
BASE_URL="https://api.proma.cool"

curl -X POST "${BASE_URL}/api/v1/tools/gpt-image-2/generate" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A futuristic cyberpunk city at sunset, neon lights reflecting on wet streets, highly detailed, cinematic lighting",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium"
  }' \
  --output response.json
```

### 步骤 4：响应是 URL，需要下载

```bash
mkdir -p generated-images
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RANDOM_SUFFIX=$(openssl rand -hex 3)

# 提取所有 URL 并下载
URLS=$(jq -r '.images[]' response.json)
INDEX=0
echo "${URLS}" | while read url; do
  curl -sL "${url}" -o "generated-images/${TIMESTAMP}-${RANDOM_SUFFIX}-${INDEX}.png"
  INDEX=$((INDEX+1))
done

ls generated-images/${TIMESTAMP}-*
```

### 步骤 5：Markdown 回显

```markdown
已为你用 GPT Image 2 生成图片：

![Cyberpunk city](./generated-images/20260520-150234-a3f1c0-0.png)

本次消耗 0.83 积分。
```

## Node.js 完整版

```javascript
const fs = require('fs');
const path = require('path');

async function generate() {
  // 假设 apiKey, baseUrl 已从 get_credentials 拿到
  const res = await fetch(`${baseUrl}/api/v1/tools/gpt-image-2/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: 'A futuristic cyberpunk city at sunset...',
      n: 1,
      size: '1024x1024',
      quality: 'medium',
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`API error ${res.status}: ${err.detail}`);
  }

  const data = await res.json();
  if (!data.images || data.images.length === 0) {
    throw new Error('No images in response');
  }

  const outDir = './generated-images';
  fs.mkdirSync(outDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const saved = [];

  for (let i = 0; i < data.images.length; i++) {
    const url = data.images[i];
    const imgRes = await fetch(url);
    const buf = Buffer.from(await imgRes.arrayBuffer());

    // 根据 content-type 判断扩展名
    const ct = imgRes.headers.get('content-type') || 'image/png';
    const ext = ct.includes('webp') ? '.webp' : ct.includes('jpeg') ? '.jpg' : '.png';

    const filepath = path.join(outDir, `${ts}-${i}${ext}`);
    fs.writeFileSync(filepath, buf);
    saved.push(filepath);
    console.log(`Saved: ${filepath}`);
  }

  return saved;
}

generate().catch(console.error);
```

## 多张生成

```bash
# 一次生成 4 张
curl ... -d '{
  "prompt": "...",
  "n": 4,
  "size": "1024x1024",
  "quality": "medium"
}'
```

响应 `images[]` 会有 4 个 URL。**积分会按 n 倍扣**，记得告知用户。

## 关键注意点

- ✅ 不传 `image` 字段（或显式传 `null`）→ 走 text-to-image
- ✅ 响应是 URL 数组，**必须再下载一次**
- ✅ 估算成本，超过 5 积分主动询问用户
- ✅ 文本 prompt 用英文，描述越具体效果越好
