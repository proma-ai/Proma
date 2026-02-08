# Proma

下一代集成通用 Agent 的 AI 桌面应用。本地优先、多供应商支持、完全开源。

[English version README.md](./README.en.md)

![Proma 海报](https://img.erlich.fun/personal-blog/uPic/pb.png)

### 并行运行的商业版本
同时 Proma 也支持商业的版本，如果你需要未来更多的**云端功能**｜**稳定靠谱的 API** ｜**更划算省心的订阅包**｜**简单的使用体验**，也欢迎支持 Proma 的商业版本：https://proma.cool/download 即可下载使用。

Proma 的核心意义不在于替代任何一款软件，目前只实现了 Proma 的基础设施部分，接下来 Proma 将继续实现多 Agents 协同工作（个人与他人）、Agents 与外部的链接、Tools 和 Skills 固化，以及利用对用户的理解和记忆实现主动提供软件和建议的能力等，Proma 正在借助 VibeCoding 工具在飞速进化，欢迎大家 PR。

## Proma 截图

Proma 的聊天模式，支持多模型切换，支持附加文件对话。
![Proma Chat Mode](https://img.erlich.fun/personal-blog/uPic/tBXRKI.png)
Proma Agent 模式，通用 Agent 能力，支持 Cladue 全系列、Minimax M2.1、Kimi K2.5、智谱 GLM 等模型，支持第三方渠道。优雅、简洁、丝滑、确信的流式输出。
![Proma Agent Mode](https://img.erlich.fun/personal-blog/uPic/3ZHWyA.png)
Proma Skills 和 MCP，默认内置 Brainstorming 和办公软件 Skill，支持通过对话就能自动帮助你寻找和安装 Skills。
![Proma Default Skills and Mcp](https://img.erlich.fun/personal-blog/uPic/PNBOSt.png)
Proma 全协议大模型渠道支持，支持国内外所有渠道模型，通过 Base URL + API KEY 配置。
![Proma Mutili Provider Support](https://img.erlich.fun/personal-blog/uPic/uPPazd.png)

## 特性

- **多供应商支持** — Anthropic、OpenAI、Google、DeepSeek、MiniMax、Kimi、智谱 GLM，以及任何 OpenAI 兼容端点
- **AI Agent 模式** — 基于 Claude Agent SDK 的自主通用 Agent
- **流式输出 & 思考模式** — 实时流式响应，可视化扩展思考过程
- **丰富渲染** — Mermaid 图表、语法高亮代码块、Markdown
- **附件 & 文档解析** — 上传图片，解析 PDF/Office/文本文件内容到对话中
- **本地优先** — 所有数据存储在 `~/.proma/`，无数据库，完全可移植
- **主题切换** — 亮色/暗色模式，跟随系统偏好

## 快速开始

下载适合你平台的最新版本：

**[下载 Proma](https://github.com/ErlichLiu/Proma/releases)**

## 配置指南

### 添加渠道

进入 **设置 > 渠道管理**，点击 **添加渠道**，选择供应商并输入 API Key。Proma 会自动填充正确的 API 地址。点击 **测试连接** 验证，然后 **获取模型** 加载可用模型列表。

### Agent 模式（仅限 Anthropic）

Agent 模式需要一个 **Anthropic** 渠道。添加后，进入 **设置 > Agent** 选择你的 Anthropic 渠道和模型（推荐 Claude Sonnet 4 / Opus 4）。底层使用 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)。

### 特殊供应商端点

MiniMax、Kimi（Moonshot）和智谱 GLM 使用专用 API 端点 — 选择供应商时会自动配置。三者均支持**编程会员**套餐的 API 访问：

| 供应商 | Chat 模式 | Agent 模式 | 备注 |
|--------|----------|-----------|------|
| MiniMax | `https://api.minimaxi.com/v1` | `https://api.minimaxi.com/anthropic` | 支持 MiniMax Pro 会员 |
| Kimi | `https://api.moonshot.cn/v1` | `https://api.moonshot.cn/anthropic` | 支持 Moonshot 开发者套餐 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `https://open.bigmodel.cn/api/anthropic` | 支持智谱开发者套餐 |

## 技术栈

- **运行时** — Bun
- **框架** — Electron + React 18
- **状态管理** — Jotai
- **样式** — Tailwind CSS + shadcn/ui
- **构建** — Vite（渲染进程）+ esbuild（主进程/预加载）
- **语言** — TypeScript

## 致谢

Proma 的诞生离不开这些优秀的开源项目：

- [Shiki](https://shiki.style/) — 语法高亮
- [Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid) — 图表渲染
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio) — 多供应商桌面 AI 的灵感来源
- [Lobe Icons](https://github.com/lobehub/lobe-icons) — AI/LLM 品牌图标集
- [Craft Agents OSS](https://github.com/lukilabs/craft-agents-oss) — Agent SDK 集成模式参考

## 开源许可

[MIT](./LICENSE)
