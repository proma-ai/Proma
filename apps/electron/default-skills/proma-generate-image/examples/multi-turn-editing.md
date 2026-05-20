# Multi-Turn Editing —— 多轮编辑的正确做法

这是本 Skill **最重要**的一节，写错会导致请求体每轮翻倍、最终超限失败。

## 错误做法 ❌

**保留 `contents` 历史，让它跨轮累积**：

```
第 1 轮：
  contents = [{role:'user', parts:[{text:'一只猫'}]}]
  ← 服务端返回 cat.png

第 2 轮：
  contents = [
    {role:'user', parts:[{text:'一只猫'}]},
    {role:'model', parts:[{text:'...', inlineData:{...cat.png...}}]},   ← 上一轮的图被 base64 内嵌
    {role:'user', parts:[{text:'戴上墨镜'}]}
  ]

第 3 轮：
  contents 又多了一对，里面又内嵌了 round2 的图 base64
  ...

第 N 轮：
  contents 包含 N-1 张 base64 图片，请求体几百 MB → 服务端 413 / 502
```

线上已经因为这个问题在 51 轮时单次请求达 343MB，触发了 502。**永远不要这么做。**

## 正确做法 ✅

**每一轮都构造独立的 `contents` 请求，只把上一张图作为参考图重新传入**：

```
第 1 轮（文生图）：
  contents = [{ role:'user', parts:[{ text:'一只猫' }] }]
  ← 保存到 ./generated-images/round1.png

第 2 轮（"戴上墨镜"）：
  contents = [{
    role: 'user',
    parts: [
      { text: 'Add sunglasses to the cat' },
      { inlineData: { mimeType:'image/png', data: <round1.png 的 base64> } }
    ]
  }]
  ← 保存到 ./generated-images/round2.png

第 3 轮（"改成卡通风格"）：
  contents = [{
    role: 'user',
    parts: [
      { text: 'Convert to cartoon style, keep the sunglasses' },
      { inlineData: { mimeType:'image/png', data: <round2.png 的 base64> } }
      // ❗ 注意：这里只传 round2.png，不要带 round1.png
    ]
  }]
  ← 保存到 ./generated-images/round3.png
```

每轮的请求体只包含**一张**参考图，体积稳定。

## 实现示例（伪代码）

```bash
# 用户消息：「再改成卡通风格」

# 1. 找到上一轮生成的图片（最新的 round*.png）
LAST_IMG=$(ls -t ./generated-images/round*.png | head -1)

# 2. 获取凭据（每轮都要刷新一次，避免缓存过期）
# 调 mcp__proma-cloud__get_credentials

# 3. 构造请求 —— contents 里只有这一轮的 prompt + 上一轮的图
LAST_B64=$(base64 -i "${LAST_IMG}" | tr -d '\n')
curl ... -d "{
  \"model\":\"gemini-3.1-flash-image-preview\",
  \"contents\":[{
    \"role\":\"user\",
    \"parts\":[
      {\"text\":\"Convert to cartoon style\"},
      {\"inlineData\":{\"mimeType\":\"image/png\",\"data\":\"${LAST_B64}\"}}
    ]
  }],
  \"generationConfig\":{\"responseModalities\":[\"TEXT\",\"IMAGE\"]}
}"

# 4. 保存到 round{N+1}.png
```

## 例外：用户明确要求"基于早期某轮"

如果用户说「基于刚开始那张戴墨镜的猫，改成水彩风格」，找到那张特定的图作为参考图即可：

```
contents = [{ role:'user', parts:[
  { text:'Convert to watercolor style' },
  { inlineData:{ ..., data:<round2.png 的 base64> } }
]}]
```

依然是单轮独立请求，只是参考图换成了用户指的那张。

## 为什么不用 `thoughtSignature` 多轮链？

Gemini 原生支持通过 `thoughtSignature` 在多轮 `contents` 中维护编辑链。
**但 Skill 不使用这个机制**，原因：

1. signature 链要求保留 model 响应的 parts，里面有 inlineData → 必然累积膨胀
2. signature 验证可以用 `skip_thought_signature_validator` 占位绕过，但还是要保留 parts 结构
3. "上一张图作为参考图" 在效果上等价于 signature 链，且请求体可控

如果你在文档里看到 `thoughtSignature` 相关内容，**忽略它**，本 Skill 不需要。
