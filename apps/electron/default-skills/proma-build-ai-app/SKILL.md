---
name: proma-build-ai-app
description: 帮用户生成可重复使用的 AI 应用。当用户说"做一个 X 工具"、"写一个小应用"、"做一个文章润色器/翻译器/分类器/邮件助手"、"做一个网页小工具"等时触发。默认输出一个精心设计的单文件 HTML 工具（浏览器双击即开），视觉设计语言参考 guizang-ppt-skill。内嵌 Proma Cloud LLM 调用，Agent 通过 mcp__proma-cloud__create_app_key 自动创建带 quota 上限的专用 key 注入到 HTML 并明确告知用户。用户明确要求其他形态（CLI / Python / Node 等）时按用户指定的形态自由生成，不预设模板。
version: 1.2.0
---

# Proma AI 应用生成器

帮用户生成**可重复使用的**带 AI 能力的应用。Agent 一站式完成：理解需求 → 调用 MCP 创建专用 key → 生成代码 → 告知用户怎么跑。

## 与其他 Skill 的区别

| Skill | 目的 | 输出 |
|---|---|---|
| **本 Skill** | 用户要长期使用的 AI 工具 | 一个可复用文件 |
| `proma-cloud-sdk` | Agent 自己批处理 | 当前对话内的临时脚本 |
| `proma-generate-image` / `proma-gpt-image-2` | 单次生图 | 一张图片 |

只有当用户明确说"做一个工具 / 写一个应用 / 我以后还要用"才用本 Skill。
"翻译这段话"或"处理这 50 个 PDF" → 不要触发本 Skill，直接做或用 `proma-cloud-sdk`。

## 默认形态：单文件 HTML 工具

**没有特别说明时，一律输出 HTML**。理由：

- 零依赖：用户双击 `tool.html` 浏览器打开就能用
- 零安装：不用装 Python/Node 环境
- 单文件：易传、易备份
- Proma Cloud CORS = `*`：浏览器可直接调 LLM
- 视觉表达力强：HTML 比 CLI 漂亮，符合"工具"该有的感觉

### 视觉设计 → 参考 `guizang-ppt-skill`

**不要自己临时设计 CSS**。直接参考姐妹 Skill `guizang-ppt-skill` 的设计语言：

| 资源 | 用途 |
|---|---|
| `guizang-ppt-skill/references/themes-swiss.md` | 4 套瑞士风主题色（IKB蓝 / 柠檬黄 / 柠檬绿 / 安全橙） |
| `guizang-ppt-skill/references/themes.md` | 电子杂志风的主题色 |
| `guizang-ppt-skill/references/components.md` | 可复用组件（按钮、卡片、警示条、meta 条、加载动画） |
| `guizang-ppt-skill/assets/template-swiss.html` | 瑞士风的字体栈、CSS 变量、间距基线（抄 `:root` 块） |
| `guizang-ppt-skill/assets/template.html` | 电子杂志风的同上 |

**两种风格按用户调性选**：

| 用户场景 | 推荐风格 |
|---|---|
| 科技 / 工具 / 数据 / 默认 | **瑞士风（template-swiss）** |
| 内容生成 / 人文 / 创意 / 文学 | 电子杂志风（template） |
| 用户明确说"瑞士风" / "Helvetica" / "Swiss" | 瑞士风 |
| 用户明确说"杂志风" / "Monocle" | 杂志风 |

**注意**：guizang-ppt-skill 是 PPT deck（多页翻页），我们要的是**单页工具**。只复用它的 **设计语言**（字体、配色、间距、组件样式），不要复用它的翻页 / 多 slide 结构。

### HTML 工具应该包含的元素

```
顶部：
  - eyebrow（"PROMA · AI TOOL"，monospace 小字）
  - 标题（应用名）
  - 副标题（一句话描述）
  - meta 条（当前模型，可选）

警示卡片：
  - "⚠ 不要分享本文件" + key 名 + 配额

工作区：
  - 输入区（textarea / input）
  - 运行按钮 + 辅助按钮（清空 / 复制结果）
  - 结果区（含入场过渡）
  - meta 信息条（token in/out / 估算积分 / 耗时）

底部：
  - 页脚 monospace 行（key 名 / 风格标识）
```

### 业务逻辑骨架（直接抄进 `<script>`）

```javascript
// ============================================================
// 凭据 — Agent 在生成时替换占位符
// ⚠️ 本 HTML 文件分享出去 = 泄露 key
// ============================================================
const PROMA_API_KEY = '{{API_KEY}}';
const PROMA_API_BASE = '{{BASE_URL}}';
const MODEL = '{{MODEL}}';

// 业务 system prompt（英文，效果更稳）
const SYSTEM_PROMPT = `{{SYSTEM_PROMPT}}`;

// LLM 调用 — Anthropic Messages 协议
async function callLLM(prompt, { maxTokens = 1024 } = {}) {
  const start = performance.now();
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (SYSTEM_PROMPT && SYSTEM_PROMPT.trim()) body.system = SYSTEM_PROMPT;

  const r = await fetch(`${PROMA_API_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PROMA_API_KEY}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const durationMs = Math.round(performance.now() - start);

  if (!r.ok) {
    const errText = await r.text();
    let msg = errText.slice(0, 300);
    try {
      const p = JSON.parse(errText);
      msg = p?.error?.message || p?.detail || msg;
    } catch {}
    throw new Error(`HTTP ${r.status} · ${msg}`);
  }

  const data = await r.json();
  return { text: data.content[0].text, usage: data.usage, durationMs };
}

// 成本估算（按输入价 0.8 / 输出价 4 积分/M 粗算，按实际模型调整）
function estimateCost(usage, inPrice = 0.8, outPrice = 4) {
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  return (inTok / 1_000_000) * inPrice + (outTok / 1_000_000) * outPrice;
}
```

需要其他模型（Qwen / GPT 等）走 OpenAI 兼容协议时，参考 `references/proma-cloud-api-summary.md`。

## 用户明确要求其他形态时

用户说"做个 Python CLI" / "用 Node 实现" / "做成 Bash 脚本"等明确形态需求时：

- **不预设模板**，按用户的语言和习惯生成
- 关键设计点保持一致：
  - 凭据通过 `create_app_key` 自动创建并注入
  - 凭据存放方式（`.env` 文件 / 环境变量）+ `.gitignore`
  - 错误处理 + 重试
  - 单次调用打印 token 数
  - 完整 README 含 key 管理说明
- LLM 调用细节参考 `references/proma-cloud-api-summary.md`

不要因为用户说"做个 CLI"就生成一堆我们没预设的脚手架——直接根据场景写最简单的代码。

## 标准工作流（Agent 必须按这个顺序）

### 步骤 1: 与用户对齐需求

- 应用做什么？
- 输入是什么？
- 输出在哪里？
- 形态：默认 HTML，用户明确要求才换

### 步骤 2: 选模型 + 决定 quotaLimit

根据应用核心任务自行判断（**不要硬编码模型 ID 或定价**，先查 `/v1/models` 拿当前真实模型）：

- 纯文本任务（润色、翻译、分类） → 选便宜的 fast 档模型（如 Haiku / flash 类），默认 50 积分
- 高质量生成 / 复杂推理 → 选 smart 档（如 Sonnet），默认 100 积分
- 含生图 → 默认 200 积分
- 含 GPT Image 2 high quality → 默认 500 积分

判断原则：**第一次给保守值**（用户用完再调），不要默认给 500+ 让用户没意识到的成本失控。

### 步骤 3: 调用 `mcp__proma-cloud__create_app_key`

```
appName: kebab-case 应用名（如 "article-polisher"）
description: 一句话说明用途（≤ 80 字，用户在面板看到）
quotaLimit: 步骤 2 选的数字
```

得到 `{ apiKey, baseUrl, keyId, keyName, quotaLimit }`。

### 步骤 4: 生成 HTML（默认形态）

1. 选风格（瑞士风 / 杂志风），从 `guizang-ppt-skill` 对应 `assets/template-*.html` 抄 `:root` CSS 变量
2. 从 `guizang-ppt-skill/references/themes-*.md` 选主题色
3. 从 `guizang-ppt-skill/references/components.md` 看可复用的按钮/卡片/警示条样式
4. 用上方"业务逻辑骨架"的 JS
5. 把 Agent 创建的真实 `apiKey` / `baseUrl` / `keyName` / `quotaLimit` 直接写到 HTML 文件（不留占位符）
6. 业务 `SYSTEM_PROMPT` 用英文写（效果更稳）

### 步骤 5: 写 README

应用目录下生成 README.md，告诉用户：

- 怎么打开（双击 `tool.html`）
- API Key 信息（名字 / 配额 / 在哪管理）
- 怎么自定义（改 system prompt / 主题色）
- ⚠️ 不要分享本文件（含 key）

### 步骤 6: 在对话中明确告知用户（必须！）

用人话告诉用户 3 件事：

1. **创建了什么 key**：`app-article-polisher-20260520`，配额 50 积分
2. **在哪里管理**：Proma 客户端 → 设置 → API Keys
3. **怎么跑**：直接双击 `tool.html`

例：

```
✅ 已生成 ./article-polisher/tool.html
   设计风格：瑞士国际主义 · IKB 克莱因蓝

📋 配套的 API Key：
   • 名字: app-article-polisher-20260520
   • 配额: 50 积分（够用 ~1000 次调用）
   • 在 Proma 客户端 → 设置 → API Keys 可以看到/管理

🚀 立即使用：
   双击打开 tool.html

💡 后续：
   配额不够 → 设置面板调高 Quota Limit
   不再用 → 设置面板删除这个 key
   怀疑泄露 → 立即在面板禁用 key
```

## 关键反模式

❌ **不要复用 `proma-agent-inner`**：必须调用 `create_app_key` 创建专用 key
❌ **不要让用户去面板手动创建 key**：Agent 自动创建是核心体验
❌ **不要忘了告知用户 key 名字和配额**：必须在对话里说清楚
❌ **不要默认给用户做 CLI**：HTML 是默认形态，除非用户明确要其他
❌ **不要自己临时设计 HTML 风格**：参考 `guizang-ppt-skill` 的设计语言（字体、配色、间距、组件）
❌ **不要复制 guizang-ppt-skill 的翻页结构**：我们是单页工具，不是 PPT
❌ **不要硬编码模型定价**：会跟着平台变
❌ **不要在 HTML 里加分享按钮**：HTML 里有 key，分享 = 泄露

## 详细参考

- `references/app-form-decision.md` — 形态决策（HTML 优先）
- `references/credentials-strategy.md` — 凭据策略
- `references/proma-cloud-api-summary.md` — Proma Cloud API 速查（详细见 proma-cloud-sdk）

## 没有预设模板

本 Skill **不预设 templates 目录**。理由：

- HTML 视觉风格 → 复用 `guizang-ppt-skill`（不重复造轮子）
- 其他形态（CLI 等） → 按用户场景自由生成（不限制 Agent 创造力）

这样 Agent 在每次生成时都能根据具体场景做最合适的设计选择。
