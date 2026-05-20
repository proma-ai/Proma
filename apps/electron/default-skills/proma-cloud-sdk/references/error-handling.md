# 错误处理与重试

Proma Cloud 错误响应通常是 `{ "error": { "message": "...", "type": "...", "code": "..." } }` 或 `{ "detail": "..." }`。

## HTTP 状态码

| 状态码 | 含义 | 操作 |
|---|---|---|
| **200** | 成功 | — |
| **400** | 请求参数错（model 不存在、context 超限、JSON 格式错） | **不要重试**，修参数 |
| **401** | API Key 无效/失效 | **不要重试**。清缓存重调 `get_credentials` 后重试 1 次。仍失败 → 告知用户重登录 |
| **402** | 余额不足 / Quota 用尽 | **不要重试**。告知用户充值或调整 Quota Limit |
| **403** | Key 被禁用 / 用户未激活 | **不要重试** |
| **413** | 请求体过大（如生图 base64 累计 > 50MB） | **不要重试**，压缩参数 |
| **422** | Pydantic 校验失败 | **不要重试**，看 detail |
| **429** | 速率限制 | **重试**（指数退避） |
| **500** | 服务端内部错 | **重试** |
| **502** | 上游 LLM API 异常或超时 | **重试** |
| **529** | Anthropic 上游过载 | **重试**（专门标记） |

## 重试策略

```python
import time
import httpx

RETRYABLE_STATUS = {429, 500, 502, 503, 504, 529}
MAX_RETRIES = 3
BASE_DELAY = 1.0  # 秒

def call_with_retry(method, url, **kwargs):
    last_exc = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = httpx.request(method, url, timeout=120, **kwargs)
            if resp.status_code in RETRYABLE_STATUS and attempt < MAX_RETRIES:
                delay = BASE_DELAY * (3 ** attempt)  # 1s, 3s, 9s
                print(f"[retry {attempt+1}/{MAX_RETRIES}] status={resp.status_code}, waiting {delay}s")
                time.sleep(delay)
                continue
            return resp
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            last_exc = e
            if attempt < MAX_RETRIES:
                time.sleep(BASE_DELAY * (3 ** attempt))
                continue
            raise
    raise RuntimeError(f"Exceeded retries; last response: {resp.status_code} {resp.text[:200]}")
```

## 401 的特殊处理（key 失效）

```python
def call_with_key_refresh(method, url, body):
    creds = get_credentials_from_mcp()  # 第一次调用获取
    resp = call_with_retry(method, url,
        headers={'Authorization': f"Bearer {creds['apiKey']}"},
        json=body)
    if resp.status_code == 401:
        # 重新拿一次（MCP 内部清缓存自动重建）
        creds = get_credentials_from_mcp()
        resp = call_with_retry(method, url,
            headers={'Authorization': f"Bearer {creds['apiKey']}"},
            json=body)
    return resp
```

## 429 速率限制特殊处理

部分上游会返回 `Retry-After` header（秒数）：

```python
if resp.status_code == 429:
    retry_after = int(resp.headers.get('Retry-After', '0'))
    delay = max(retry_after, BASE_DELAY * (3 ** attempt))
    time.sleep(delay)
```

## 并发控制（批处理时避免触发 429）

```python
import asyncio

CONCURRENCY = 10  # 不要超过 10

async def process_one(item):
    # 单次 API 调用
    ...

async def process_batch(items):
    semaphore = asyncio.Semaphore(CONCURRENCY)
    async def bounded(item):
        async with semaphore:
            return await process_one(item)
    return await asyncio.gather(*(bounded(i) for i in items))
```

```bash
# Bash 并发：xargs -P
echo "${INPUTS[@]}" | xargs -P 10 -I {} bash process_one.sh {}
```

## 错误降级（批处理时一条挂了不要全挂）

```python
results = []
for item in items:
    try:
        results.append({"ok": True, "data": call_llm(item)})
    except Exception as e:
        results.append({"ok": False, "error": str(e), "item": item})

succeeded = [r for r in results if r['ok']]
failed = [r for r in results if not r['ok']]
print(f"Done: {len(succeeded)}/{len(items)} succeeded, {len(failed)} failed")
```

## 错误消息解析

Anthropic 风格：
```json
{ "error": { "type": "invalid_request_error", "message": "..." } }
```

OpenAI 风格：
```json
{ "error": { "message": "...", "type": "invalid_request_error", "code": "model_not_found" } }
```

FastAPI 直接抛错：
```json
{ "detail": "Unsupported size 'xxx'" }
```

通用提取：
```python
def extract_error(resp):
    try:
        body = resp.json()
        if 'error' in body:
            return body['error'].get('message', str(body['error']))
        if 'detail' in body:
            return body['detail']
    except Exception:
        pass
    return resp.text[:200]
```

## 不要做的事

- ❌ 4xx 错误盲目重试（除 429）
- ❌ 不限重试次数
- ❌ 重试不退避（瞬时打爆上游）
- ❌ 401 不刷新 key 直接重试（重试也是 401）
- ❌ 并发 > 10（容易触发限速）
