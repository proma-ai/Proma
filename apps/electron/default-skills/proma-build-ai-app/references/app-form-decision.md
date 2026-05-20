# 应用形态决策

## 默认：HTML 单文件工具

**用户没明确指定形态 → 一律输出 HTML**。

理由：
- 零依赖 — 双击浏览器打开就能用
- 零安装 — 不要求用户装 Python/Node
- 单文件 — 易传、易备份
- 视觉表达力强 — 比命令行漂亮，符合"工具"的感觉
- CORS 已开 — 浏览器可直接调 Proma API

### HTML 视觉设计 → 参考 `guizang-ppt-skill`

不要自己临时设计 CSS，直接复用姐妹 Skill 的设计语言：

- **风格选择**：瑞士国际主义（默认，科技 / 工具 / 数据场景）或电子杂志风（人文 / 创意场景）
- **主题色**：`guizang-ppt-skill/references/themes-swiss.md` 或 `themes.md`
- **字体栈 + CSS 变量**：从 `guizang-ppt-skill/assets/template-*.html` 的 `:root` 抄
- **组件样式（按钮/卡片/警示）**：参考 `guizang-ppt-skill/references/components.md`

注意：guizang-ppt-skill 是 PPT 多页 deck，**只复用它的设计语言**，不复用多 slide 结构。

## 用户明确要求其他形态时

不预设模板，**按用户场景直接生成最简代码**。常见情况：

| 用户线索 | 生成方式 |
|---|---|
| "做个 Python CLI / 脚本" | 单文件 `main.py` + `.env` + `requirements.txt`（如有依赖） |
| "用 Node 实现" | 单文件 `main.mjs` + `.env` + `package.json`（如有依赖） |
| "做个 Bash 脚本" | 单文件 `.sh` + `.env` |
| "做个 Web 应用 / 服务" | 拒绝，建议改成 HTML 或他自己起项目 |
| "做个桌面应用 / GUI" | 拒绝，HTML 能满足大多数 GUI 需求 |
| "打包成 .exe 分享" | 拒绝，应用里嵌 key 分享 = 泄露 |

## HTML 形态的特点

✅ 适合：
- 输入 → 处理 → 显示结果的交互式工具
- 文章润色 / 翻译 / 改写 / 分类
- AI 对话玩具
- 文本生成器
- 内容审核小工具
- 单次输出图片的生图工具

⚠️ 限制：
- key 在 HTML 源码里，用户能看见（这是设计内特性，单用户工具）
- **绝对不要鼓励用户分享 HTML 文件**（会泄露 key）
- 不能批量处理本地文件（浏览器不能任意访问磁盘）— 这种场景用 CLI

## 形态触发关键词速查

```
HTML（默认） ← "网页工具" / "双击打开" / "简单工具" / "做个 X 器" / 没明确说
Python CLI  ← "Python 脚本" / "CLI" / "批处理" / "命令行" / "处理 N 个文件"
Node CLI    ← "Node" / "npm" / "TypeScript" / "我的项目"
Bash 脚本   ← "Bash" / "Shell" / "命令行单行处理"
拒绝         ← "桌面 GUI" / "打包 exe" / "多人协作" / "服务端"
```

## 不要做的形态

- ❌ Electron 桌面应用 — 复杂度太高，Proma Chat 模式已覆盖
- ❌ Docker 容器 — 单机工具没必要
- ❌ Web service / 后端 API — 单用户工具不需要
- ❌ 浏览器扩展 — 上架审核流程超 Skill 范围
- ❌ 移动 app — 原生开发超 Skill 范围

用户坚持时坦诚说明并引导他换形态或换方案。
