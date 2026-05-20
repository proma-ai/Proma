# Example: Text-to-Image

纯文生图，无参考图。

## 完整流程

### 步骤 1：获取凭据

调用 MCP 工具：

```
mcp__proma-cloud__get_credentials
```

返回（JSON 文本）：
```json
{ "apiKey": "pk_xxx", "baseUrl": "https://api.proma.cool" }
```

### 步骤 2：构造并发送请求

```bash
# 假设已从 get_credentials 提取出 API_KEY 和 BASE_URL
API_KEY="pk_xxx"
BASE_URL="https://api.proma.cool"

curl -X POST "${BASE_URL}/api/v1/tools/generate-image" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.1-flash-image-preview",
    "image_size": "1K",
    "numberOfImages": 1,
    "contents": [
      {
        "role": "user",
        "parts": [
          { "text": "A cute orange tabby cat sitting on a windowsill, soft morning light streaming through, photorealistic, shallow depth of field" }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"],
      "imageConfig": { "aspectRatio": "16:9" }
    }
  }' \
  --output response.json
```

### 步骤 3：解析响应并保存图片

```bash
# 提取 base64 图片数据并解码到文件
mkdir -p generated-images
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RANDOM_SUFFIX=$(openssl rand -hex 3)
OUTPUT_PATH="generated-images/${TIMESTAMP}-${RANDOM_SUFFIX}.png"

# 使用 jq + base64 解码
jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' response.json \
  | base64 -d > "${OUTPUT_PATH}"

echo "Image saved to: ${OUTPUT_PATH}"
```

### 步骤 4：在回复里展示给用户

```markdown
我已经生成了你想要的猫咪图：

![Cat on windowsill](./generated-images/20260520-150234-a3f1c0.png)

本次消耗 0.78 积分。
```

## Node.js / TypeScript 版本

如果你更习惯用 Bash 工具运行 `node -e`：

```javascript
const fs = require('fs');
const path = require('path');

async function generate() {
  // 假设 apiKey, baseUrl 已通过 get_credentials 获取
  const res = await fetch(`${baseUrl}/api/v1/tools/generate-image`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gemini-3.1-flash-image-preview',
      image_size: '1K',
      numberOfImages: 1,
      contents: [{
        role: 'user',
        parts: [{ text: 'A cute orange tabby cat ...' }],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9' },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`API error ${res.status}: ${err.detail}`);
  }

  const data = await res.json();
  const part = data.candidates[0].content.parts.find(p => p.inlineData);
  if (!part) throw new Error('No image in response');

  const outDir = './generated-images';
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filepath = path.join(outDir, `${ts}-${Math.random().toString(36).slice(2, 8)}.png`);
  fs.writeFileSync(filepath, Buffer.from(part.inlineData.data, 'base64'));

  console.log(`Saved: ${filepath}`);
  return filepath;
}

generate().catch(console.error);
```

## 关键注意点

- ✅ `numberOfImages` 在请求**顶层**，不要塞进 `generationConfig.imageConfig`
- ✅ prompt 用英文（中文也能用，但效果差）
- ✅ `responseModalities` 固定填 `["TEXT", "IMAGE"]`
- ✅ 输出目录用相对路径 `./generated-images/`，方便 Markdown 引用
