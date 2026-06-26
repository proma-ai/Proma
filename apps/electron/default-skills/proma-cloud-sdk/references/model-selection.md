# 模型动态选择

Proma Cloud 上的模型清单会随平台迭代变化。**会话内首次需要本 Skill 时执行一次发现 + 归类，缓存到 `${cwd}/.proma-models.json`，后续直接读缓存。**

## 步骤 1：列出可用模型

`/v1/models` 是公开端点，**不需要 API Key**（实测裸请求返回 200）。先把 baseUrl 归一化成根域名 `API_ROOT`：

```bash
BASE_URL=$(echo "$CREDS" | jq -r .baseUrl)        # get_credentials 返回的
API_ROOT="${BASE_URL%/api/v1}"                     # 幂等归一化 → https://api.proma.cool
curl -s "${API_ROOT}/v1/models" > /tmp/proma-models-raw.json
jq -r '.data[].id' /tmp/proma-models-raw.json | sort
```

返回 `{object:"list", data:[{id,...}]}`，实际清单类似（**以服务端为准，会随平台变**）：

```
claude-haiku-4-5-20251001
claude-opus-4-6
claude-opus-4-7
claude-opus-4-8
claude-sonnet-4-6
deepseek-v4-flash
deepseek-v4-pro
gemini-2.5-pro
gemini-3-flash-preview
gemini-3.1-pro-preview
glm-5.2
gpt-5-mini
gpt-5.4
gpt-5.5
```

> ⚠️ **embedding 模型不在这个列表里**。它们注册在 MultimodalModel 表，要用 `GET ${API_ROOT}/api/v1/multimodal-models?type=EMBEDDING`（多模态/管理端点带 `/api/v1` 前缀）。见 `references/embeddings.md`。

### 含定价/推理元数据的分组结构

如果需要每个模型的定价、`supportsReasoning`、`enabledForMessages` 等元数据，用管理端点（`/api/v1` 前缀，结构是按 provider 分组的数组）：

```bash
curl -s "${API_ROOT}/api/v1/models" | jq -r '.[].models[] | "\(.id)\tmsgs=\(.enabledForMessages)\treason=\(.supportsReasoning)\t$\(.inputPricePer1M)/$\(.outputPricePer1M)"'
```

## 步骤 2：按规则归类到 preset

下面是可直接执行的 bash + jq 脚本，跑完得到 `.proma-models.json` 缓存：

```bash
#!/bin/bash
# build-model-presets.sh

API_ROOT="$1"          # baseUrl 归一化后的根域名，如 https://api.proma.cool
OUT_FILE="${2:-.proma-models.json}"

# 1. 拉模型列表
MODELS_JSON=$(curl -s "${API_ROOT}/v1/models")
ALL_IDS=$(echo "$MODELS_JSON" | jq -r '.data[].id')

# 2. 关键词归类（关键词按当前命名约定，会失效，归类不对就手动覆盖）
match() { echo "$ALL_IDS" | grep -iE "$1" | head -3 | jq -R . | jq -s .; }

cat > "$OUT_FILE" <<EOF
{
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "apiRoot": "${API_ROOT}",
  "models": $(echo "$MODELS_JSON" | jq '.data'),
  "presets": {
    "fast":         $(match 'haiku|mini|flash|nano|turbo'),
    "smart":        $(match 'sonnet|gpt-5\.4|deepseek-v4-pro'),
    "smartest":     $(match 'opus|gpt-5\.5'),
    "long-context": $(match 'gemini.*pro|sonnet|deepseek-v4'),
    "chinese":      $(match 'glm|deepseek-v4|qwen'),
    "code":         $(match 'deepseek-v4|sonnet|coder')
  }
}
EOF

echo "Model presets written to: $OUT_FILE"
```

> embedding 不进 preset（不在 /v1/models 里）。要用 embedding 直接看 `references/embeddings.md`，当前唯一可用模型是 `text-embedding-3-large`。

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

上面这些 preset 关键词是按当前模型命名约定写的，会随未来模型上线/改名失效。如果发现归类不对（如 `fast` preset 落空、`smartest` 拿到的不是最强模型），手动覆盖即可：

```bash
# 比如手动指定某个 preset
jq '.presets.smartest = ["claude-opus-4-8"]' .proma-models.json > tmp && mv tmp .proma-models.json
```

## Preset → 实际模型 ID 的回退顺序

每个 preset 的 array 是按优先级排的。调用时按顺序尝试，遇到 4xx 错误（模型不存在）自动回退到下一个：

```bash
for MODEL in $(jq -r '.presets.smart[]' .proma-models.json); do
  RES=$(curl -s -w "\n%{http_code}" -X POST "${API_ROOT}/v1/chat/completions" \
    -H "Authorization: Bearer ${API_KEY}" \
    -d '{"model":"'$MODEL'","max_tokens":512,"messages":[...]}')
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
- ❌ 拿到 baseUrl 不归一化就直接拼：`${baseUrl}/v1/...` 在 baseUrl 带 `/api/v1` 时会拼成 `/api/v1/v1/...` → 404。永远先 `API_ROOT="${baseUrl%/api/v1}"`
- ❌ 把 `.proma-models.json` 提交到 git（应该在 `.gitignore`，本地缓存）
- ❌ 跨工作区共享缓存（不同工作区可能挂在不同环境）
