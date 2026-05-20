# GPT Image 2 错误码处理

错误响应体：`{ "detail": "<message>" }`

## HTTP 状态码

| 状态码 | 含义 | 排查 / 用户提示 |
|---|---|---|
| **200** | 成功 | — |
| **400** | 参数错误 | 检查 size/quality 是否在白名单；详见下方"400 子类型" |
| **401** | API Key 失效 | 提示用户重新登录，先调一次 `mcp__proma-cloud__get_credentials` 强制刷新 |
| **402** | 余额不足（精确预检失败） | 提示用户：「Proma 余额不足，本次需 X.XX 积分，请前往设置充值。」**GPT Image 2 比较贵，生成前主动估算并告知用户**（参见 size-quality-pricing.md） |
| **403** | API Key 已禁用 / 用户未激活 | 检查 Key 状态 |
| **502** | 上游 OpenAI 异常或超时 | 重试 1-2 次；持续失败提示用户「OpenAI 生图服务暂时不可用」 |

### 400 子类型

- `Unsupported size 'xxx'. Allowed: [...]`
  → 用了非法 size，限定在白名单内
- `Unsupported quality 'xxx'. Allowed: [...]`
  → 限定在 `low` / `medium` / `high`
- `Pricing not configured for size='xxx' quality='yyy'`
  → 极少出现，组合无定价（一般是新加 size 但定价表没更新）
- 上游透传错误（含 `content_policy_violation`、`invalid_image` 等）
  → prompt 触发安全过滤、参考图格式不支持等

## 超时

`settings.GPT_IMAGE_2_TIMEOUT`（180-300 秒）。Edit + high 时上游极易超时，服务端已主动降级 high → medium 缓解。
客户端 fetch 超时建议设为 360 秒留余量。

## 重试策略

- `502`、`network error`、`timeout`：可重试 1-2 次（指数退避：1s, 3s）
- `400`、`422`：参数问题，不要重试
- `401`：清缓存重新 `get_credentials` 后重试 1 次
- `402`：不要重试，立即提示用户

## 余额预检（重要）

服务端在调用上游**之前**精确预检余额：
```
available = user.credits + subscription_remaining + enterprise_allocated_balance
if available < total_cost:
    return 402
```

所以 402 一定是真没钱，不是误判。**这意味着 Agent 也应该在调用前估算成本**（用 `size-quality-pricing.md` 的表），如果用户余额可能不够，**先告知再调用**，避免无谓的 402 体验。
