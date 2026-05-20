# Nano Banana 定价

价格以 Proma Cloud 服务端 `app/configs/tool_pricing.py` 实际配置为准。

> 1 USD = 7.80 积分（Proma 积分体系）
> 实际扣费 = 单价 × `numberOfImages`

## 模型 × 分辨率定价表

| 模型 | image_size | USD / 张 | 积分 / 张 |
|---|---|---|---|
| `gemini-3.1-flash-image-preview` | `auto` / `1K` | $0.10 | **0.78** |
| `gemini-3.1-flash-image-preview` | `2K` | $0.15 | **1.17** |
| `gemini-3.1-flash-image-preview` | `4K` | $0.20 | **1.56** |
| `gemini-3-pro-image-preview` | `auto` / `1K` | $0.15 | **1.17** |
| `gemini-3-pro-image-preview` | `2K` | $0.15 | **1.17** |
| `gemini-3-pro-image-preview` | `4K` | $0.30 | **2.34** |

## 选型建议（本 Skill 内部模型选择）

> ⚠️ 前提：用户已明确指定要用 Nano Banana / Gemini，否则应该用 `proma-gpt-image-2`（默认）。

| 场景 | 推荐 |
|---|---|
| 用户说"省积分 / 便宜的 / Flash 模型" | `gemini-3.1-flash-image-preview` + `1K` |
| 较高细节要求，但不需要 4K | `gemini-3.1-flash-image-preview` + `2K` |
| 用户明确说"Pro 模型 / 最高质量" | `gemini-3-pro-image-preview` + `4K` |
| 多轮快速迭代尝试 | `gemini-3.1-flash-image-preview` + `auto`（最便宜） |

## 与默认 GPT Image 2 的成本对比

| 同分辨率单张 | Nano Banana Flash | GPT Image 2 (medium) |
|---|---|---|
| 1K | 0.78pt | 0.83pt |
| 2K | 1.17pt | 3.31pt |
| 4K | 1.56pt（Flash） / 2.34pt（Pro） | 3.31pt（实降到 2K 档） |

**结论**：Nano Banana 在 2K+ 显著比 GPT Image 2 便宜。这是用户主动选 Nano Banana 时的核心动机。

## 成本估算示例

- 用户：「画 4 张 1K 的小猫图」
  → `gemini-3.1-flash-image-preview`，`numberOfImages=4`，`image_size=1K`
  → 0.78 × 4 = **3.12 积分**

- 用户：「画一张 4K 的高质量海报」
  → `gemini-3-pro-image-preview`，`numberOfImages=1`，`image_size=4K`
  → **2.34 积分**

如果用户问"这次会花多少积分"，根据上表给出明确答复。
