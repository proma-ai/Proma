# Proma

> **📖 新手？从这里开始 →** [**Proma 使用教程系列(点击此处)**](./tutorial/tutorial.md) — 从零开始配置环境、连接大模型，3-5 分钟即可上手。

下一代集成通用 Agent 的 AI 桌面应用，支持对话、Agent、Agent Teams **等能力**，本地优先、多供应商支持、完全开源。支持远程通过飞书机器人与 Agent 对话和交互，甚至把 Proma Agent 拉进群组替你完成工作，跟同事实现 Agent 协作，让你用手机也可以处理很多必要的工作。

[English version README.md](./README.en.md)

### ✦ 核心能力

> **Chat** · 多模型对话 &nbsp;│&nbsp; **Agent** · 自主通用 Agent &nbsp;│&nbsp; **Agent Teams** · 多 Agent 协同 &nbsp;│&nbsp; **Skills & MCP** · 可扩展工具链
>
> **飞书远程** · 手机也能用 Agent &nbsp;│&nbsp; **记忆** · 跨会话理解你 &nbsp;│&nbsp; **多供应商** · Anthropic / OpenAI / Google / DeepSeek / MiniMax / Kimi / 智谱 &nbsp;│&nbsp; **本地优先** · 数据全在你手里

![Proma 海报](https://img.erlich.fun/personal-blog/uPic/pb.png)

### 并行运行的商业版本
同时 Proma 也支持商业的版本，如果你需要未来更多的**云端功能**｜**稳定靠谱的 API** ｜**更划算省心的订阅包**｜**简单的使用体验**，也欢迎支持 Proma 的商业版本：https://proma.cool/download 即可下载使用，订阅包低至官方价 4 折。

Proma 的核心意义不在于替代任何一款软件，目前只实现了 Proma 的基础设施部分，接下来 Proma 将继续实现多 Agents 协同工作（个人与他人）、Agents 与外部的链接、Tools 和 Skills 固化，以及利用对用户的理解和记忆实现主动提供软件和建议的能力等，Proma 正在借助 VibeCoding 工具在飞速进化，欢迎大家 PR。

## Proma 截图

### Chat 模式
Proma 的聊天模式，支持多模型切换，支持附加文件对话。

![Proma Chat Mode](https://img.erlich.fun/personal-blog/uPic/tBXRKI.png)

### Agent 模式
Proma Agent 模式，通用 Agent 能力，支持 Cladue 全系列、Minimax M2.1、Kimi K2.5、智谱 GLM 等模型，支持第三方渠道。优雅、简洁、丝滑、确信的流式输出。

![Proma Agent Mode](https://img.erlich.fun/personal-blog/uPic/3ZHWyA.png)

### Agent Teams
Agent Teams 或者 Agent 蜂群将会是 2026 年 Agent 主要的发展方向之一，Proma 也已经支持 Agent Teams 能力，并且可以自动根据用户的任务复杂度自动组件 Agent Teams，实际测试可以将复杂任务的处理能力和效果提高至少 5% - 20%。当运行 Agent Teams 时你将在右侧看到具体的 Agent 的工作状态。（也可以通过自然语言主动要求使用 Agent Teams，并为每个 Agent 指定它的工作或研究范围）
![Proma Agent Teams](https://img.erlich.fun/personal-blog/uPic/vNVpRu.png)

### Skill & MCP
Proma Skills 和 MCP，默认内置 Brainstorming 和办公软件 Skill，支持通过对话就能自动帮助你寻找和安装 Skills。

![Proma Default Skills and Mcp](https://img.erlich.fun/personal-blog/uPic/PNBOSt.png)

### 通过飞书远程使用 Proma / 支持私聊和群组
Proma 支持通过使用飞书机器人的方式来远程使用 Proma Agent 能力，支持切换工作区（/workspace 命令），支持创建新会话（/new 命令），这样就可以实现类似截图中的效果，可以为不同的工作区先配置上（或直接通过 Proma Agent 来帮你配置）对应的 Skills / MCP 以及文件附录等资源，即可远程也能让 Proma Agent 帮你完成工作。譬如远程帮你进行调研，并将调研文件通过邮件或其他方式发送到同事的邮箱、远程合并 PR 或者修复紧急的 Bug 并推送上线等。

也支持将 Proma Agent 拉进你的飞书群组，可以跟同事共享你积攒下来的 Skills 和 MCP 能力，利用本地的文件和飞书文档一起完成更智能的 Agent 协作，甚至可以直接用 Proma Agent 来完成对外部用户的服务。

![Proma Lark Demo](https://img.erlich.fun/personal-blog/uPic/nNu4wA.png)

实际的配置过程很简单，但我也知道这对于任何新手来说认知压力会比较大，但请相信我克服这种恐惧，3 分钟足够。

![Proma Lark Config](https://img.erlich.fun/personal-blog/uPic/wTQisd.png)

![Proma Lark Command](https://img.erlich.fun/personal-blog/uPic/tvzfZp.png)

### 记忆能力
Proma 记忆功能，Chat 和 Agent 共享记忆，让 AI 真正了解你、记住你的偏好和习惯。
![Proma memory settings](https://img.erlich.fun/personal-blog/uPic/94B0LN.png)

![Proma memory dmeo](https://img.erlich.fun/personal-blog/uPic/Wi8QfB.png)


### Proma 渠道配置功能

Proma 全协议大模型渠道支持，支持国内外所有渠道模型，通过 Base URL + API KEY 配置。

![Proma Mutili Provider Support](https://img.erlich.fun/personal-blog/uPic/uPPazd.png)

## 特性

- **多供应商支持** — Anthropic、OpenAI、Google、DeepSeek、Moonshot、智谱 GLM、MiniMax、豆包、通义千问，以及任何 OpenAI 兼容端点
- **AI Agent 模式** — 基于 Claude Agent SDK 0.2.84 的自主通用 Agent，支持工作区隔离和权限管理
- **Agent Teams** — 多 Agent 协同工作，自动组建团队处理复杂任务，提升 5-20% 效果
- **远程全天候使用 Proma** — 基于飞书/Lark 的机器人能力，实现远程使用 Proma Agent，支持私聊和群组，搭配工作区的 Skill 和 MCP 实现远程工作
- **Skills & MCP** — 可扩展工具链，默认内置 Brainstorming 和办公软件 Skill，支持通过对话自动寻找和安装 Skills
- **流式输出 & 思考模式** — 实时流式响应，可视化扩展思考过程
- **丰富渲染** — Mermaid 图表、语法高亮代码块、Markdown、数学公式（KaTeX）
- **附件 & 文档解析** — 上传图片，解析 PDF/Office/文本文件内容到对话中
- **记忆功能** — Chat 和 Agent 共享记忆，AI 记住你的偏好、习惯和上下文，跨会话持续理解你
- **本地优先** — 所有数据存储在 `~/.proma/`，JSON + JSONL 格式，无数据库，完全可移植
- **主题切换** — 亮色/暗色模式，跟随系统偏好
- **自动更新** — 内置 Electron Updater，自动检测和安装更新

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

- **运行时** — Bun 1.2.5+
- **桌面框架** — Electron 39.5.1
- **前端框架** — React 18.3.1
- **状态管理** — Jotai 2.17.1
- **UI 组件** — Radix UI
- **样式** — Tailwind CSS 3.4.17
- **富文本编辑器** — TipTap 3.19.0
- **代码高亮** — Shiki 3.22.0
- **构建工具** — Vite 6.0.3（渲染进程）+ esbuild 0.24.0+（主进程/预加载）
- **打包工具** — Electron Builder 25.1.8
- **语言** — TypeScript 5.0.0+
- **Agent SDK** — @anthropic-ai/claude-agent-sdk 0.2.84
- **飞书 SDK** — @larksuiteoapi/node-sdk

## 致谢

Proma 的诞生离不开这些优秀的开源项目：

- [Shiki](https://shiki.style/) — 语法高亮
- [Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid) — 图表渲染
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio) — 多供应商桌面 AI 的灵感来源
- [Lobe Icons](https://github.com/lobehub/lobe-icons) — AI/LLM 品牌图标集
- [Craft Agents OSS](https://github.com/lukilabs/craft-agents-oss) — Agent SDK 集成模式参考
- [MemOS](https://memos.openmem.net) - Proma 的记忆功能实现

## 参与贡献

欢迎大家参与 Proma 的开发！无论是修复 Bug、新增功能还是改进文档，我们都非常欢迎你的贡献。

**PR 赠金活动** — Proma 目前设有 PR 赠金计划，对合并的 PR 自动给予慷慨的赠金，支持在 Claude Code 等产品中使用，帮助大家更好地进行 AI 辅助开发。提交 PR 时请在描述中留下你的邮箱信息即可。

![Proma Given](https://img.erlich.fun/personal-blog/uPic/PR%20%E8%B5%A0%E9%87%91%201.png)


## 赞助支持（招募中）
AI 时代最能玩梗，但又一语中的炒作组织，惊叹于对这个 AI 时代的精准嘲讽，点透疯癫。微信公众号搜索：**葬 AI**

![葬 AI](https://img.erlich.fun/personal-blog/uPic/zang-ai.png)

## 开源许可

[MIT](./LICENSE)
