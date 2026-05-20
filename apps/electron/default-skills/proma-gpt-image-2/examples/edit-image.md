# Example: Edit Image (GPT Image 2)

编辑模式：基于已有图片做修改，可选 mask 指定编辑区域。

## 关键点

- 传 `image` 字段（base64 data URL 或公开 URL） → 自动触发 edit 模式
- 上游只支持 3 种 size：`1024x1024` / `1024x1536` / `1536x1024`
- 服务端会自动降级不支持的 size 和 high quality（无需 Agent 干预）
- mask 字段（可选）：指定编辑区域

## 完整流程

### 步骤 1：获取凭据

调 `mcp__proma-cloud__get_credentials`。

### 步骤 2：把参考图编码为 data URL

```bash
REF_PATH="./generated-images/20260520-143000-abc.png"

# 检测 MIME 类型
case "${REF_PATH##*.}" in
  png) MIME="image/png" ;;
  jpg|jpeg) MIME="image/jpeg" ;;
  webp) MIME="image/webp" ;;
  *) MIME="image/png" ;;
esac

# 转 data URL
REF_BASE64=$(base64 -i "${REF_PATH}" | tr -d '\n')
REF_DATA_URL="data:${MIME};base64,${REF_BASE64}"
```

### 步骤 3：发送编辑请求

```bash
API_KEY="pk_xxx"
BASE_URL="https://api.proma.cool"

curl -X POST "${BASE_URL}/api/v1/tools/gpt-image-2/generate" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "prompt": "Add stylish sunglasses to the person",
  "image": "${REF_DATA_URL}",
  "n": 1,
  "size": "1024x1024",
  "quality": "medium"
}
EOF
)" \
  --output response.json
```

### 步骤 4：下载并保存

同 text-to-image，从 `response.json` 的 `images[]` 取 URL 下载。

## 使用 Mask 指定编辑区域

mask 是一张与原图同尺寸的图片，**透明区域**代表"要编辑的部分"，不透明区域保留原样。

```bash
# mask 也是 data URL
MASK_BASE64=$(base64 -i "./mask.png" | tr -d '\n')
MASK_DATA_URL="data:image/png;base64,${MASK_BASE64}"

curl -X POST "${BASE_URL}/api/v1/tools/gpt-image-2/generate" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"prompt\": \"Replace the background with a beach scene\",
    \"image\": \"${REF_DATA_URL}\",
    \"mask\": \"${MASK_DATA_URL}\",
    \"size\": \"1024x1024\"
  }"
```

mask 制作方法（简单情况）：用 Node.js 生成纯色矩形：

```javascript
// 创建一个 1024x1024 的 mask，中心 500x500 区域透明
const { createCanvas } = require('canvas');
const canvas = createCanvas(1024, 1024);
const ctx = canvas.getContext('2d');
ctx.fillStyle = 'black';
ctx.fillRect(0, 0, 1024, 1024);
ctx.clearRect(262, 262, 500, 500);  // 中心区域透明
fs.writeFileSync('mask.png', canvas.toBuffer('image/png'));
```

## 多张参考图

```json
{
  "prompt": "Combine these characters into one scene",
  "image": [
    "data:image/png;base64,xxx",
    "data:image/png;base64,yyy"
  ],
  "size": "1536x1024"
}
```

## 高分辨率 / 高质量场景的预期行为

用户说：「编辑这张图，4K 高质量」

```json
// 你发送的请求
{
  "prompt": "...",
  "image": "data:image/png;base64,xxx",
  "size": "3840x2160",
  "quality": "high"
}
```

```
// 服务端实际转发上游的（自动降级）
{
  "prompt": "...",
  "image": "...",
  "size": "1536x1024",      // 从 3840x2160 降下来
  "quality": "medium"        // 从 high 降下来
}
```

**回复用户时主动告知**：
> "已编辑完成。注：OpenAI 编辑模式上游只支持 1024×1024 / 1024×1536 / 1536×1024 三种尺寸，high quality 也不可用。本次实际生成 1536×1024 medium，计费 0.64 积分。如需 4K 高质量结果，建议先用 Nano Banana 生成 4K 原图再用本 Skill 局部编辑。"

## 关键注意点

- ✅ `image` 字段格式必须是 **完整的 data URL**（含 `data:image/png;base64,` 前缀），与 Nano Banana 的纯 base64 不同
- ✅ 多张参考图传数组，单张参考图也可以传字符串
- ✅ mask 与 image 同尺寸，透明区域代表编辑区
- ✅ size/quality 服务端会降级，不用提前处理但要告知用户
- ✅ 响应仍是 URL 数组，需要再下载
