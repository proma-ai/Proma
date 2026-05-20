# Nano Banana 错误码处理

错误响应体：`{ "detail": "<message>" }`

## HTTP 状态码

| 状态码 | 含义 | 排查 / 用户提示 |
|---|---|---|
| **200** | 成功 | — |
| **400** | 请求参数错误 | 检查 `model` 是否在白名单、`image_size` 是否合法；详见下方"400 子类型" |
| **401** | API Key 失效 / 未登录 | 提示用户：「登录可能已过期，请重新登录后再试。」并先调一次 `mcp__proma-cloud__get_credentials` 强制刷新 |
| **402** | 余额不足 | 提示用户：「Proma 余额不足，本次生图需 X.XX 积分，请前往设置面板充值后再试。」 |
| **403** | API Key 已禁用 / 用户未激活 | 提示用户去面板检查 Key 状态或联系管理员 |
| **413** | 请求体过大（>50MB） | 减少 `numberOfImages` 或参考图数量/分辨率，或重新压缩 base64 后重试 |
| **422** | Pydantic 校验失败 | 检查 JSON 字段类型、是否漏传必填项 |
| **502** | 上游 Gemini API 异常或超时 | 自动重试 1-2 次；仍失败则提示用户「上游生图服务暂时不可用，请稍后再试」 |

### 400 子类型

服务端返回的 `detail` 字段会标明具体错误：

- `Model 'xxx' is not supported. Allowed: [...]`
  → 用户传了非法 model id。修正为白名单内的（`gemini-3.1-flash-image-preview` 或 `gemini-3-pro-image-preview`）
- `Unsupported image_size 'xxx' for model 'yyy'`
  → 修正为 `auto` / `1K` / `2K` / `4K` 之一
- 上游 Gemini API 透传错误（含 `INVALID_REQUEST_BODY`、`SAFETY` 等）
  → `numberOfImages` 误塞进 `generationConfig`、prompt 触发安全过滤、参考图格式不支持等

## 超时

服务端硬超时 360 秒。极端长尾（Pro + 4K + 复杂 prompt）可能触发。
客户端建议 fetch 超时设为 420 秒以避免提前断流。

## 重试策略

- `502`、`network error`、`timeout`：可重试 1-2 次（指数退避：1s, 3s）
- `4xx`（除 401 外）：参数问题，不要重试
- `401`：清缓存后重新 `get_credentials` 拿新 Key 重试 1 次
- `402`：不要重试，立即提示用户
