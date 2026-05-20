# Example: Edit with Reference Image

带参考图的编辑：基于已有图片做修改 / 风格转换 / 元素添加。

## 完整流程

### 步骤 1：获取凭据

同 `text-to-image.md`，调 `mcp__proma-cloud__get_credentials`。

### 步骤 2：把参考图编码为 base64

参考图来源有 3 种：

1. **用户上传的图片**：用户消息附件中的本地路径（如 `<attached_files>` 标记的路径）
2. **本次 Skill 之前轮已生成的图片**：在 `./generated-images/` 目录下
3. **用户在消息中通过 `@file:` 引用的图片**

```bash
REF_PATH="./generated-images/20260520-143000-abc123.png"
# 或：REF_PATH="/Users/xxx/Desktop/my-photo.jpg"

REF_BASE64=$(base64 -i "${REF_PATH}" | tr -d '\n')

# 根据扩展名判断 mimeType
case "${REF_PATH##*.}" in
  png) MIME="image/png" ;;
  jpg|jpeg) MIME="image/jpeg" ;;
  webp) MIME="image/webp" ;;
  gif) MIME="image/gif" ;;
  *) MIME="image/png" ;;
esac
```

### 步骤 3：构造带参考图的请求

参考图通过 `contents[0].parts[].inlineData` 传入，**文本 part 在前，图片 part 在后**（这是 Gemini 推荐顺序）：

```bash
API_KEY="pk_xxx"
BASE_URL="https://api.proma.cool"

curl -X POST "${BASE_URL}/api/v1/tools/generate-image" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "model": "gemini-3.1-flash-image-preview",
  "image_size": "1K",
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "Add stylish sunglasses to the cat, keep the same lighting and background" },
        { "inlineData": { "mimeType": "${MIME}", "data": "${REF_BASE64}" } }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
EOF
)" \
  --output response.json
```

### 步骤 4：解析响应、保存、回显

同 `text-to-image.md`。

## 多张参考图（合成场景）

最多 10 张，累计 base64 解码后 ≤ 50MB。把多个 `inlineData` part 追加到 `parts[]`：

```json
{
  "contents": [{
    "role": "user",
    "parts": [
      { "text": "Combine these two characters into one scene, both standing in a forest at sunset" },
      { "inlineData": { "mimeType": "image/png", "data": "<base64 of char1>" } },
      { "inlineData": { "mimeType": "image/png", "data": "<base64 of char2>" } }
    ]
  }],
  "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
}
```

## 体积控制建议

参考图过大会让请求体超出 50MB 服务端硬限。控制方法：

- 优先用 `image/jpeg` 而非 `image/png`（同尺寸下小 5-10 倍）
- 单张参考图建议 < 2MB（base64 后约 2.7MB）
- 10 张参考图的极端场景需要每张 ≤ 4MB

如果 base64 后接近 50MB，先用 `node -e` 或 Bash 工具压缩图片再传。

## 关键注意点

- ✅ 文本 part 放前，图片 part 放后（Gemini 推荐）
- ✅ 多张参考图分别独立成 part，**不要**合并到一个 inlineData
- ✅ mimeType 与实际文件格式一致（否则上游 400）
- ✅ base64 字符串**不能**带 `data:image/png;base64,` 前缀，只传纯 base64
