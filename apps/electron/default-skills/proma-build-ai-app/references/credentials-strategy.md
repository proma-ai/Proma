# 凭据策略（核心安全规范）

## 核心原则

1. **不复用 Agent 自己的 `proma-agent-inner`** — 应用 key 泄露不能牵连 Agent
2. **Agent 自动创建专用 key** — 不让用户去面板手动操作
3. **默认带 Quota Limit** — 防止用户没意识到的成本失控
4. **明确告知用户** — 创建时在对话和应用里都说清楚

## 调用 MCP 创建 key

```typescript
// 通过 mcp__proma-cloud__create_app_key 调用：
{
  appName: "article-polisher",          // 必须 kebab-case
  description: "文章润色 HTML 工具专用",  // 用户在面板看到
  quotaLimit: 50                         // 可选，默认 50
}

// 返回：
{
  apiKey: "pk_xxx",        // ★ 注入到 HTML 的 PROMA_API_KEY 常量
  baseUrl: "https://api.proma.cool",
  keyId: "key_yyy",
  keyName: "app-article-polisher-20260520",  // ★ 在 HTML 警示区 + 对话里告知
  quotaLimit: 50           // ★ 同上
}
```

## quotaLimit 决策（自行判断，不要硬编码）

按应用核心任务的成本量级判断默认值：

| 应用类型 | 默认 quotaLimit |
|---|---|
| 纯文本（润色 / 翻译 / 分类） | 50 积分 |
| 高质量生成 / 复杂推理 | 100 积分 |
| 含 embedding 检索 | 100 积分 |
| 含生图 | 200 积分 |
| 含 GPT Image 2 high quality | 500 积分 |

**第一次给保守值**（用户用完再调高），不要给 1000+ 让用户没意识到的成本失控。

## HTML 形态的凭据注入

HTML 模板里有这一段：

```html
<script>
  // ⚠️ 安全提示：本 HTML 文件分享出去 = 泄露 key
  const PROMA_API_KEY = '{{API_KEY}}';
  const PROMA_API_BASE = '{{BASE_URL}}';
  const MODEL = '{{MODEL}}';
</script>
```

Agent 调 `create_app_key` 后**直接把真实值写到 HTML**。模板里还有一个显眼的警示卡片告诉用户"不要分享本文件"。

## 其他形态的凭据注入（用户明确要求时）

**Python / Node / Bash CLI**：用 `.env` 文件：

```dotenv
# .env（被 .gitignore 忽略）
PROMA_API_KEY=pk_xxx_real_key
PROMA_API_BASE=https://api.proma.cool
PROMA_MODEL={{MODEL}}              # Agent 生成时填真实模型 ID（先查 /v1/models，勿硬编码）

# 本 key 由 Proma Agent 自动创建：app-article-polisher-20260520
# Quota Limit: 50 积分 — 用完后可去 Proma 设置面板调整
```

同时生成：
- `.env.example`（占位符版本，可提交 git）
- `.gitignore`（必须包含 `.env`）

## 对话中告知用户（必须！）

Agent 创建 key 并生成应用后，**对话末尾必须**包含 3 条信息：

```
✅ 应用已生成到 `./article-polisher/tool.html`

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

## 滥用保护

`proma-cloud` MCP 内部有保护：`app-` 前缀 key 累计超过 20 个会拒绝创建。Agent 收到这个错误时**不要硬试**，告诉用户去面板清理废弃应用 key。

```
❌ 我尝试为应用创建 key，但你的账户已有 20 个 app- 开头的 key
（这是滥用保护上限）。请去 Proma 设置面板删除一些不再使用的 app key，
然后告诉我，我再试一次。
```

## 不要做的事

- ❌ 把 inner key（`proma-agent-inner` 的 key）写到应用里
- ❌ 让用户去面板手动创建 key
- ❌ 漏掉对话中的告知部分
- ❌ 同一应用反复生成（每次都创建新 key，积累快）— 让用户用同一个目录复用
- ❌ 鼓励用户分享应用文件
