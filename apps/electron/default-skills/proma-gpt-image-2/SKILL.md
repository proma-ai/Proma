---
name: proma-gpt-image-2
description: 默认生图工具。当用户要"画一张图"、"生成图片"、"基于这张图改"、"P 图"、"修图"、"换风格"、"加个元素"、"扩图"、"做一张海报/壁纸/插图"、"用 GPT 生图"、"OpenAI 风格"或"用 mask 编辑"时触发。基于 OpenAI GPT Image 2，支持文生图（text-to-image）和图片编辑（edit）两种模式，自动按 image 字段路由。1024×1024 到 4K 全分辨率支持，low/medium/high 三档质量，可指定 mask 区域精确编辑。版本 1.1.0。
version: 1.1.0
---

# GPT Image 2 生图（默认）

通过 Proma Cloud 调用 OpenAI GPT Image 2 生成或编辑图片。**这是 Proma Agent 的默认生图 Skill**——用户没特别指定模型时，使用本 Skill。

## 何时使用本 Skill vs Nano Banana

| 场景 | 推荐 Skill |
|---|---|
| 默认情况、用户没指定模型 | **本 Skill**（GPT Image 2） |
| 用户明确说"用 GPT / OpenAI" | **本 Skill** |
| 需要 mask 精确编辑 | **本 Skill**（Nano Banana 不支持 mask） |
| 印刷品、海报、4K 输出 | **本 Skill**（GPT 高分辨率稳定） |
| 用户明确说"用 Nano Banana / Gemini / Google 生图" | proma-generate-image |
| 用户明确说"用便宜的 / 快的 / Flash 模型" | proma-generate-image |
| 多轮快速迭代、不在意细节、要省积分 | proma-generate-image |

**默认选择策略**：除非用户在消息里出现"Nano Banana"、"Gemini"、"Google 生图"、"便宜模式"、"省积分"等明确关键词，否则一律用本 Skill。

## 调用流程

1. **获取凭据**：调用 MCP 工具 `mcp__proma-cloud__get_credentials`
2. **选择模式**：
   - 不传 `image` 字段 → **text-to-image**（纯文生图）
   - 传 `image` 字段（base64 或 URL） → **edit**（编辑模式）
3. **设置参数**（详见 `references/api-spec.md`）：
   - `prompt`：英文描述
   - `n`：生成张数（1-10）
   - `size`：分辨率（见下方枚举）
   - `quality`：`low` / `medium` / `high`
   - `mask`（可选，仅 edit 模式）：蒙版图片
4. **调用接口**：先归一化 baseUrl 再拼工具路径
   ```javascript
   const API_ROOT = baseUrl.replace(/\/api\/v1\/?$/, '')   // 幂等归一化到根域名
   // POST ${API_ROOT}/api/v1/tools/gpt-image-2/generate
   ```
   > ⚠️ 务必先归一化：`get_credentials` 历史上返回过带 `/api/v1` 后缀的 baseUrl，直接 `${baseUrl}/api/v1/tools/...` 会拼成 `/api/v1/api/v1/tools/...` → 404。归一化后新旧返回值都正确。
5. **解析响应**：从 `images[]` 提取 URL 或 base64
   - URL 类型 → fetch 下载
   - base64 类型 → 直接解码保存
6. **保存到** `${cwd}/generated-images/`，回显 Markdown 图片

完整示例：
- 纯文生图：`examples/text-to-image.md`
- 编辑模式：`examples/edit-image.md`

## 关键特性

### Edit 模式自动降级（服务端处理，Agent 无需关心）

如果用户要 edit 模式且传了高分辨率（如 4K），服务端会自动降级：
- `size` 降级：`2048x2048` → `1024x1024`、`3840x2160` → `1536x1024` 等
- `quality` 降级：`high` → `medium`（因为上游 high + edit 必定超时）

**这意味着**：edit 模式下 Agent 可以放心传任何用户期望的 size/quality，服务端会自动选最合适的。但要在回复里告知用户实际生成的分辨率（可能与请求不同）。

### 多张生成
`n=10` 时返回 10 张独立图片（与 Nano Banana 不同，GPT Image 2 真的返回多个 image entry）。

## 默认参数建议

用户没指定参数时，使用以下默认：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `n` | `1` | 单张，除非用户说"画 N 张" |
| `size` | `1024x1024` | 通用尺寸；用户说"横版"用 `1536x1024`，"竖版"用 `1024x1536`，"高清/大图"升到 `2048x2048` |
| `quality` | `medium` | 性价比最高；用户说"高质量/精致"用 `high`，"草图/快速"用 `low` |

## 成本提示

GPT Image 2 比 Nano Banana 略贵，特别是 high quality 或大尺寸。**生成前如果总积分 > 5，主动告知用户**（参考 `references/size-quality-pricing.md`）。

## 错误码处理

详见 `references/error-codes.md`。常见：

- `401` → 重新登录
- `402` → 余额不足，告知用户充值
- `400` → size/quality 不在白名单
- `502` → 上游异常，重试 1-2 次

## 详细参考

- `references/api-spec.md`：完整请求/响应 schema、所有字段
- `references/size-quality-pricing.md`：全部 size × quality 定价矩阵（含 edit 模式降级映射）
- `references/error-codes.md`：错误码处理
- `examples/text-to-image.md`：文生图完整示例
- `examples/edit-image.md`：编辑模式完整示例（含 mask）
