# Embeddings API

文本向量化，用于检索、聚类、去重、相似度计算。

## ⚠️ embedding 模型不在 /v1/models 里

embedding 模型注册在 **MultimodalModel** 表，`GET /v1/models` 查不到它们。要发现可用的 embedding 模型，用多模态端点（`/api/v1` 前缀）：

```bash
API_ROOT="${BASE_URL%/api/v1}"   # 先把 get_credentials 的 baseUrl 幂等归一化成根域名
curl -s "${API_ROOT}/api/v1/multimodal-models?type=EMBEDDING" \
  -H "Authorization: Bearer ${API_KEY}" | jq '.models[] | {id, name, inputPricePer1M}'
```

实测返回（当前唯一可用）：

```json
{ "id": "text-embedding-3-large", "name": "Text Embedding 3 Large", "inputPricePer1M": "0.1300" }
```

> 上游是 OpenAI，3072 维。模型清单会变，调用前先查这个端点拿真实 ID，不要硬编码。

## Endpoint

```
POST {API_ROOT}/v1/embeddings
Headers:
  Authorization: Bearer {apiKey}
  Content-Type: application/json
```

> `API_ROOT = baseUrl.replace(/\/api\/v1\/?$/, '')` —— 归一化到根域名（形如 `https://api.proma.cool`）。**调用走 `${API_ROOT}/v1/embeddings`（LLM 前缀），发现模型走 `${API_ROOT}/api/v1/multimodal-models`（多模态前缀）**——两类端点前缀不同，注意区分。

## 单条请求

```bash
curl -X POST "${API_ROOT}/v1/embeddings" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-large",
    "input": "The cat sat on the mat."
  }'
```

响应：
```json
{
  "object": "list",
  "data": [{
    "object": "embedding",
    "index": 0,
    "embedding": [0.0023, -0.0418, ...]
  }],
  "model": "pa/text-embedding-3-large",
  "usage": { "prompt_tokens": 6, "total_tokens": 6 }
}
```

> 实测 `text-embedding-3-large` 默认返回 **3072 维**。注意响应里 `model` 字段可能带 `pa/` 前缀，不影响使用。

## 批量请求（强烈推荐）

`input` 字段接受字符串数组（实测支持），**一次最多 100-2048 条**（取决于上游模型）。

```bash
curl -X POST "${API_ROOT}/v1/embeddings" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "text-embedding-3-large",
    "input": [
      "First sentence.",
      "Second sentence.",
      "Third sentence."
    ]
  }'
```

响应里的 `data[]` 与输入顺序一一对应。

**批量比单条循环快 10-50 倍，且费用一样**。绝大多数 embedding 场景应该批量。

## 维度

默认维度由模型决定（`text-embedding-3-large` 是 3072）。**实测支持 `dimensions` 参数缩减**（传 `dimensions: 1024` 实测返回 1024 维）：

```json
{
  "model": "text-embedding-3-large",
  "input": "...",
  "dimensions": 1024
}
```

降维后存储空间小、检索快，但召回率略降。

## 模型选择

当前平台只注册了一个 embedding 模型：

| 模型 | 默认维度 | 上游 | 用途 |
|---|---|---|---|
| `text-embedding-3-large` | 3072（可降维） | OpenAI | 通用、高质量检索 |

> 用 `GET ${API_ROOT}/api/v1/multimodal-models?type=EMBEDDING` 查当前可用清单，未来可能新增中文/多语言模型。**不要硬编码模型 ID**。

## 典型用法

### 1. 文档相似度

```python
import numpy as np

resp = call_embeddings([doc_a, doc_b])
vec_a, vec_b = resp['data'][0]['embedding'], resp['data'][1]['embedding']

# 余弦相似度
cos_sim = np.dot(vec_a, vec_b) / (np.linalg.norm(vec_a) * np.linalg.norm(vec_b))
```

### 2. 最近邻检索（语义搜索）

```python
# 1. 把 N 篇文档向量化
docs = ["...", "...", ...]
doc_vecs = call_embeddings(docs)['data']

# 2. 查询向量
query_vec = call_embeddings([query])['data'][0]['embedding']

# 3. 取 top-k
sims = [cos_sim(query_vec, d['embedding']) for d in doc_vecs]
top_k = sorted(enumerate(sims), key=lambda x: -x[1])[:5]
```

### 3. 去重

```python
# 把文档批量向量化后用 DBSCAN / 阈值过滤近似重复
from sklearn.cluster import DBSCAN
labels = DBSCAN(eps=0.1, min_samples=1, metric='cosine').fit_predict(vecs)
```

## 成本估算

Embeddings 极其便宜：

| 模型 | 大约 1M tokens 成本 |
|---|---|
| text-embedding-3-large | $0.13（含 costMultiplier 7.8 后约 1 积分）|

10 万条短句（每条 ~30 token）大约 3M tokens，约 0.5 积分。**embedding 任务很少需要担心成本**，但要批量发请求（不要 N 次单条）。实际定价以 `multimodal-models` 端点的 `inputPricePer1M` 为准。

## 容量限制

- 单条 input 最大 token：通常 8192（OpenAI text-embedding-3-large）
- 批量 input 数量：100-2048
- 超长文本要先切分（chunking）

## 错误处理

详见 `error-handling.md`。常见：

- 400 → 模型不可用（用错 ID，或用了 `/v1/models` 里的 chat 模型）/ input 超长
- 422 → 模型不支持 embeddings（用错接口了）

- 400 → input 超长，切分后重试
- 422 → 模型不支持 embeddings（用错接口了）
