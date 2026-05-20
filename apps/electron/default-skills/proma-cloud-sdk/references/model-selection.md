# 模型动态选择

Proma Cloud 上的模型清单会随平台迭代变化。**会话内首次需要本 Skill 时执行一次发现 + 归类，缓存到 `${cwd}/.proma-models.json`，后续直接读缓存。**

## 步骤 1：列出可用模型

`/v1/models` 是公开端点，**不需要 API Key**：

```bash
BASE_URL=$(echo "$CREDS" | jq -r .baseUrl)  # 从 get_credentials 拿到的
curl -s "${BASE_URL}/v1/models" > /tmp/proma-models-raw.json
jq -r '.data[].id' /tmp/proma-models-raw.json | sort
```

返回类似（实际清单以服务端为准）：

```
claude-haiku-4-5
claude-opus-4-7
claude-sonnet-4-6
deepseek-chat
deepseek-coder
gemini-1.5-pro
gpt-4o
gpt-4o-mini
o1
qwen-max
qwen-turbo
text-embedding-3-small
...
```

## 步骤 2：按规则归类到 preset

下面是可直接执行的 bash + jq 脚本，跑完得到 `.proma-models.json` 缓存：

```bash
#!/bin/bash
# build-model-presets.sh

BASE_URL="$1"          # 从 get_credentials 拿
OUT_FILE="${2:-.proma-models.json}"

# 1. 拉模型列表
MODELS_JSON=$(curl -s "${BASE_URL}/v1/models")
ALL_IDS=$(echo "$MODELS_JSON" | jq -r '.data[].id')

# 2. 关键词归类
match() { echo "$ALL_IDS" | grep -iE "$1" | head -3 | jq -R . | jq -s .; }

cat > "$OUT_FILE" <<EOF
{
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "baseUrl": "${BASE_URL}",
  "models": $(echo "$MODELS_JSON" | jq '.data'),
  "presets": {
    "fast":         $(match 'haiku|mini|turbo|flash|nano'),
    "smart":        $(match 'sonnet|gpt-4o(?!-mini)|deepseek-chat|gpt-5(?!.*mini)'),
    "smartest":     $(match 'opus|^o1|^o3'),
    "long-context": $(match 'gemini.*pro|sonnet'),
    "chinese":      $(match 'qwen|glm|moonshot|baichuan|deepseek-v3'),
    "code":         $(match 'coder|deepseek'),
    "embedding":    $(match 'embedding|bge')
  }
}
EOF

echo "Model presets written to: $OUT_FILE"
```

## 步骤 3：选 preset 时按需读缓存

```bash
# 想用便宜模型
MODEL=$(jq -r '.presets.fast[0]' .proma-models.json)
# 或 long-context
MODEL=$(jq -r '.presets["long-context"][0]' .proma-models.json)
```

## 何时重新发现

- ✅ 会话内首次需要 LLM 调用时 — 跑一次发现
- ✅ 用户明确说"用最新模型 / 重新查模型列表" — 强制重跑
- ❌ 每次 API 调用前都跑 — 开销大，没必要
- ✅ 缓存文件不存在 — 跑一次

## 归类规则备注

下面这些 preset 关键词是按当前主流模型命名约定写的，会随未来模型上线/改名失效。如果发现归类不对（如 `fast` preset 落空、`smartest` 拿到的不是最强模型），手动覆盖即可：

```bash
# 比如手动指定某个 preset
jq '.presets.smartest = ["claude-opus-4-7"]' .proma-models.json > tmp && mv tmp .proma-models.json
```

## Preset → 实际模型 ID 的回退顺序

每个 preset 的 array 是按优先级排的。调用时按顺序尝试，遇到 4xx 错误（模型不存在）自动回退到下一个：

```bash
for MODEL in $(jq -r '.presets.smart[]' .proma-models.json); do
  RES=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${API_KEY}" \
    -d '{"model":"'$MODEL'","messages":[...]}')
  STATUS=$(echo "$RES" | tail -1)
  if [ "$STATUS" = "200" ]; then
    echo "Used model: $MODEL"
    echo "$RES" | head -n -1
    break
  fi
done
```

## 不要做的事

- ❌ 硬编码模型 ID 在脚本里
- ❌ 把 `.proma-models.json` 提交到 git（应该在 `.gitignore`，本地缓存）
- ❌ 跨工作区共享缓存（不同工作区可能挂在不同环境）
