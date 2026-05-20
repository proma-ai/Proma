# Embeddings API

文本向量化，用于检索、聚类、去重、相似度计算。

## Endpoint

```
POST {baseUrl}/v1/embeddings
Headers:
  Authorization: Bearer {apiKey}
  Content-Type: application/json
```

## 单条请求

```bash
curl -X POST "${BASE_URL}/v1/embeddings" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
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
  "model": "text-embedding-3-small",
  "usage": { "prompt_tokens": 6, "total_tokens": 6 }
}
```

## 批量请求（强烈推荐）

`input` 字段接受字符串数组，**一次最多 100-2048 条**（取决于上游模型）。

```bash
curl -X POST "${BASE_URL}/v1/embeddings" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "text-embedding-3-small",
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

默认维度由模型决定（OpenAI text-embedding-3-small 是 1536）。部分模型支持 `dimensions` 参数缩减：

```json
{
  "model": "text-embedding-3-small",
  "input": "...",
  "dimensions": 512
}
```

降维后存储空间小、检索快，但召回率略降。

## 模型选择

| 模型 | 维度 | 用途 |
|---|---|---|
| `text-embedding-3-small` | 1536 | 通用、便宜 |
| `text-embedding-3-large` | 3072 | 高质量检索 |
| `bge-large-zh` | 1024 | 中文优化 |
| `bge-m3` | 1024 | 多语言、高维稀疏 |

查 `/v1/models` 看当前可用。

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
| text-embedding-3-small | $0.02 (≈0.16 积分) |
| text-embedding-3-large | $0.13 (≈1 积分) |

10 万条短句（每条 ~30 token）大约 3M tokens，约 0.5 积分。**embedding 任务很少需要担心成本**，但要批量发请求（不要 N 次单条）。

## 容量限制

- 单条 input 最大 token：通常 8192（OpenAI），其他模型见 `/v1/models` 元数据
- 批量 input 数量：100-2048
- 超长文本要先切分（chunking）

## 错误处理

详见 `error-handling.md`。常见：

- 400 → input 超长，切分后重试
- 422 → 模型不支持 embeddings（用错接口了）
