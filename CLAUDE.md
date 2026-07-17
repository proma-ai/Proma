# CLAUDE.md

This file provides guidance to AI coding agents working with this repository.

**重要提示：**
- 当功能发生变化时，请保持此文件和 `README.md` 同步更新。请更新文档以反映当前状态，但是需要经过我的允许后再修改。
- 所有的注释和日志优先采用中文，保留必要的专业术语部分。
- 所有的依赖包的安装都要先进行搜索，综合判断依赖采用的版本，而不是默认采用某个版本。
- 状态管理上我们全部采用 Jotai 来实现。
- 这是个开源项目，本地存储优先，善用配置文件优于大部分默认采用 localstorage，不采用本地数据库方案。
- 保证充分的组件化以及人类的可读性，每次完成改动后都要思考这一点，运行@code-simplifier 来简化优化代码，保持简单直接不过渡设计的风格。
- 在 UI 设计上采用更现代的方案，UI 组件推荐采用 ShadcnUI，在合适的情况下，用卡片和阴影取代边框，用符合主题的饱满色彩，设置界面要设置背景，为未来做不同主题留下空间。
- 采用 BDD 行为驱动开发的方案。

## 项目概述

Proma 是一个本地优先的 Electron AI 桌面应用，Chat 与 Agent 工作流并行；Agent 模式可使用 Claude Agent SDK（默认）或 Pi Agent SDK（实验性）。

## Monorepo 结构

Bun workspace monorepo：

```
proma-v2/
├── packages/
│   ├── shared/     # 共享类型、IPC 通道常量、配置、工具函数 (v0.1.42)
│   ├── core/       # AI Provider 适配器、代码高亮服务 (v0.2.15)
│   └── ui/         # 共享 UI 组件 (CodeBlock, MermaidBlock) (v0.1.9)
└── apps/
    └── electron/   # Electron 桌面应用 (v0.14.26)
        └── src/
            ├── main/       # 主进程 + 服务层 (main/lib/)
            ├── preload/    # IPC 上下文桥接
            └── renderer/   # React UI (Vite + Tailwind + Radix UI)
```

**包命名规范**：`@proma/*` 作用域（`@proma/core`、`@proma/shared`、`@proma/ui`、`@proma/electron`）

**依赖管理**：package.json 中使用 `workspace:*` 引用内部包

### 包职责详解

#### @proma/shared (v0.1.42)
- **导出模块**：`./types`、`./config`、`./utils`、`./constants/permission-rules`
- **关键类型**：`AgentMessage`、`ChatMessage`、`Channel`、`PermissionRequest`、`FeishuConfig`
- **依赖**：无运行时依赖（仅 TypeScript）

#### @proma/core (v0.2.15)
- **导出模块**：`./providers`、`./highlight`、`./types`、`./utils`
- **关键功能**：Provider 适配器注册表、代码高亮（Shiki）
- **依赖**：`@proma/shared`、`shiki`
- **Peer 依赖**：`@anthropic-ai/claude-agent-sdk`、`@anthropic-ai/sdk`、`@modelcontextprotocol/sdk`

#### @proma/ui (v0.1.9)
- **关键组件**：共享 React UI 组件库
- **依赖**：`@proma/core`、`beautiful-mermaid`、`shiki`、Radix UI
- **Peer 依赖**：`react@^18.3.0`、`react-dom@^18.3.0`

#### @proma/electron (v0.14.26)
- **职责**：Electron 桌面应用主体，集成所有包
- **关键依赖**：
  - `@anthropic-ai/claude-agent-sdk@0.3.201` - Claude Agent Runtime
  - `@earendil-works/pi-coding-agent` / `pi-agent-core` / `pi-ai@0.80.3` - Pi Agent Runtime（实验性）
  - `@larksuiteoapi/node-sdk` - 飞书集成
  - Radix UI、TipTap、Tailwind CSS
  - 文件解析：`pdf-parse`、`officeparser`、`word-extractor`

## 常用命令

```bash
# 开发模式（推荐 - 自动启动 Vite + Electron + 热重载）
bun run dev

# 手动开发模式（调试时更稳定）
# 终端 1: cd apps/electron && bun run dev:vite
# 终端 2: cd apps/electron && bun run dev:electron

# 构建并运行
bun run electron:start

# 仅构建
bun run electron:build

# 类型检查（所有包）
bun run typecheck

# 单包类型检查
cd packages/core && bun run typecheck

# 测试
bun test

# 打包分发
cd apps/electron
bun run dist:mac      # macOS
bun run dist:win      # Windows
bun run dist:linux    # Linux
bun run dist:fast     # 当前架构快速打包
```

### Electron 构建脚本（`apps/electron/` 目录下）

```bash
bun run build:main        # esbuild → dist/main.cjs
bun run build:preload     # esbuild → dist/preload.cjs
bun run build:renderer    # Vite → dist/renderer/
bun run build:resources   # 复制 resources/ 到 dist/
bun run generate:icons    # 生成应用图标
```

## 运行时环境

使用 Bun 代替 Node.js/npm/pnpm：

- `bun install` 安装依赖，`bun run <script>` 运行脚本
- `bun test` 运行测试（内置测试运行器，`import { test, expect } from "bun:test"`）
- Bun 自动加载 .env 文件（无需 dotenv）
- 优先使用 Bun 原生 API：`Bun.file` > `node:fs`，`Bun.$\`command\`` > `execa`

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| **运行时** | Bun | 1.2.5+ |
| **语言** | TypeScript | 5.0.0+ |
| **桌面框架** | Electron | 39.5.1 |
| **前端框架** | React | 18.3.1 |
| **状态管理** | Jotai | 2.17.1 |
| **UI 组件** | Radix UI | 最新 |
| **样式** | Tailwind CSS | 3.4.17 |
| **富文本编辑器** | TipTap | 3.19.0 |
| **代码高亮** | Shiki | 3.22.0 |
| **Markdown** | React Markdown | 10.1.0 |
| **图表** | Beautiful Mermaid | 最新 |
| **数学公式** | KaTeX | 0.16+ |
| **构建工具** | Vite | 6.0.3 |
| **打包工具** | esbuild | 0.24.0+ |
| **分发工具** | Electron Builder | 25.1.8 |
| **Agent Runtime** | Claude Agent SDK + Pi Agent SDK（实验性） | Claude `0.3.201`；Pi `0.80.3` |
| **飞书 SDK** | @larksuiteoapi/node-sdk | 最新 |

## 核心架构

### IPC 通信模式（最重要的架构模式）

类型定义 → 主进程处理 → Preload 桥接 → 渲染进程调用：

1. **类型 & 常量**：`@proma/shared` 定义 IPC 通道名称常量和请求/响应类型
2. **主进程处理**：`main/ipc.ts`（57KB）注册 `ipcMain.handle()` 处理器，调用 `main/lib/` 服务
3. **Preload 桥接**：`preload/index.ts` 通过 `contextBridge.exposeInMainWorld` 暴露类型安全的 API
4. **渲染进程**：通过 `window.electronAPI.*` 调用，Jotai atoms 中封装调用逻辑

添加新 IPC 通道时，需要同步修改这四个位置。

#### 主要 IPC 通道组

- `IPC_CHANNELS` - 基础通道（运行时、Git、环境）
- `CHANNEL_IPC_CHANNELS` - 渠道管理
- `CHAT_IPC_CHANNELS` - Chat 功能
- `AGENT_IPC_CHANNELS` - Agent 功能
- `ENVIRONMENT_IPC_CHANNELS` - 环境检查
- `PROXY_IPC_CHANNELS` - 代理设置
- `SYSTEM_PROMPT_IPC_CHANNELS` - 系统提示词
- `CHAT_TOOL_IPC_CHANNELS` - Chat 工具
- `FEISHU_IPC_CHANNELS` - 飞书集成
- `GITHUB_RELEASE_IPC_CHANNELS` - GitHub 发布

### 主进程服务层（`main/lib/`）

#### 核心服务

| 服务 | 职责 |
|------|------|
| `agent-orchestrator.ts` | Agent 核心编排层（71KB）：并发守卫、渠道查找、环境变量构建、SDK 路径解析、消息持久化、事件流处理、错误处理、自动标题生成 |
| `agent-session-manager.ts` | Agent 会话管理：SDK 消息持久化、会话元数据 CRUD、JSONL 存储 |
| `agent-prompt-builder.ts` | Agent 系统提示词构建（18KB）：动态上下文构建、内置 Agent 构建、工作区上下文注入 |
| `agent-permission-service.ts` | Agent 权限管理：工具权限检查、权限模式管理 |
| `agent-ask-user-service.ts` | Agent 用户交互：AskUser 请求处理 |
| `agent-exit-plan-service.ts` | Agent 退出计划服务 |
| `agent-workspace-manager.ts` | 工作区管理（16KB）：MCP Server 配置、Skills 配置、工作区 CRUD |
| `chat-service.ts` | Chat 流式调用编排（20KB）：Provider 适配器集成、消息持久化、AbortController |
| `conversation-manager.ts` | 对话管理（13KB）：对话 CRUD、JSONL 消息存储、置顶、上下文分割 |
| `channel-manager.ts` | 渠道管理（16KB）：渠道 CRUD、API Key AES-256-GCM 加密（safeStorage）、连接测试、模型获取 |

#### 集成服务

| 服务 | 职责 |
|------|------|
| `feishu-bridge.ts` | 飞书集成（68KB）：消息同步、任务通知、OAuth 认证 |

#### 工具与文件

| 服务 | 职责 |
|------|------|
| `chat-tools/` | Chat 工具实现目录：内置工具函数 |
| `workspace-watcher.ts` | 工作区文件监听：文件系统变化监控 |
| `chat-tools-watcher.ts` | Chat 工具监听：工具配置变化监控 |
| `attachment-service.ts` | 附件管理：存储/读取/删除、文件对话框 |
| `document-parser.ts` | 文档解析：PDF/Office/文本文件提取 |

#### 系统服务

| 服务 | 职责 |
|------|------|
| `runtime-init.ts` | 运行时初始化：Shell 环境、Bun、Git 检测（`bun-finder.ts`、`git-detector.ts`、`shell-env.ts`） |
| `config-paths.ts` | 配置路径管理：`~/.proma/` 目录结构 |
| `user-profile-service.ts` | 用户档案持久化 |
| `settings-service.ts` | 应用设置持久化（主题等） |
| `updater/` | 自动更新：Electron Updater 集成 |

### AI Provider 适配器（`packages/core/src/providers/`）

基于适配器模式的多 Provider 支持，通过注册表统一管理：

#### 核心架构
- `ProviderAdapter` 接口：定义统一的 `sendMessage()` 流式方法
- `provider-registry.ts`：Provider 注册表，按 `providerId` 查找适配器
- `sse-reader.ts`：通用 SSE 流读取器（fetch + ReadableStream）

#### 支持的 Provider

| Provider | 适配器 | API 协议 | 特性 |
|----------|--------|----------|------|
| **Anthropic** | `anthropic-adapter.ts` | Messages API | extended_thinking、多模态 |
| **OpenAI** | `openai-adapter.ts` | Chat Completions | 标准 OpenAI 协议 |
| **DeepSeek** | `anthropic-adapter.ts` | Messages API | Anthropic 兼容 |
| **智谱 AI** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
| **MiniMax** | `anthropic-adapter.ts` | Messages API | Anthropic 兼容 |
| **豆包** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
| **通义千问** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
| **Google** | `google-adapter.ts` | Generative Language API | Gemini 系列 |
| **Custom** | `openai-adapter.ts` | Chat Completions | 自定义 OpenAI 兼容端点 |

#### 多模态支持
- **图片**：各 Provider 格式不同，适配器自动转换
- **文档**：提取文本后注入 `<file>` XML 标签

### Jotai 状态管理（`renderer/atoms/`）

| Atom 文件 | 管理的状态 |
|-----------|-----------|
| `chat-atoms.ts` | 对话列表、当前消息、流式状态（Map 结构支持多对话并行）、模型选择、上下文设置、并排模式、思考模式、待上传附件 |
| `agent-atoms.ts` | Agent 会话列表、当前会话、流式状态（`AgentStreamState`）、工作区选择、渠道选择、权限/AskUser 请求队列（按 sessionId Map） |
| `active-view.ts` | 主面板视图切换（'conversations' / 'settings'） |
| `app-mode.ts` | 应用模式（Chat / Agent） |
| `settings-tab.ts` | 设置面板当前标签页 |
| `theme.ts` | 主题模式（light / dark / system） |
| `user-profile.ts` | 用户档案（姓名 + 头像） |
| `updater.ts` | 自动更新状态（检查/下载/安装），优雅降级（updater 不可用时保持 idle） |

### 渲染进程组件架构（`renderer/components/`）

- **`app-shell/`**：三面板布局（LeftSidebar | NavigatorPanel | MainContentPanel），侧边栏含模式切换、置顶对话、日期分组列表、流式指示器
- **`chat/`**：聊天核心 — ChatView（消息加载/流式订阅）、ChatHeader（模型选择/上下文设置）、ChatInput（Tiptap 富文本编辑器）、ChatMessages（消息列表/自动滚动）、ParallelChatMessages（并排模式）
- **`agent/`**：Agent 模式 — AgentView（纯展示 + 交互，IPC 监听已提升到全局）、AgentHeader（渠道/模型选择）、AgentMessages（消息列表 + 工具活动）、ToolActivityItem（工具调用展示）、WorkspaceSelector（工作区切换）、PermissionBanner/AskUserBanner（权限/问答请求 UI）
- **`settings/`**：设置面板 — GeneralSettings（用户档案）、AppearanceSettings（主题）、ChannelSettings（渠道管理）、ChannelForm（Provider 配置）、AgentSettings（Agent 渠道/工作区/MCP）、McpServerForm（MCP 服务器配置）、AboutSettings（版本/更新）、FeishuSettings（飞书集成）；含 `primitives/` 可复用表单组件
- **`file-browser/`**：文件浏览器 — FileBrowser（工作区文件树浏览）
- **`ai-elements/`**：AI 展示组件 — Markdown 渲染、代码块、Mermaid 图、推理折叠、上下文分割线、富文本输入
- **`ui/`**：Radix UI 组件（现代化设计，CSS 变量主题）

### 全局 Hooks（`renderer/hooks/`）

| Hook | 职责 |
|------|------|
| `useGlobalAgentListeners` | 全局 Agent IPC 监听器，在 `main.tsx` 顶层挂载，使用 `useStore()` 直接操作 atoms。处理流式事件、完成/错误、标题更新、权限请求、AskUser 请求，永不随组件卸载销毁 |
| `useBackgroundTasks` | 后台任务管理（Agent/Shell 任务的增删改查），按 sessionId 隔离 |

### 渲染进程初始化组件（`renderer/main.tsx`）

| 组件 | 职责 |
|------|------|
| `ThemeInitializer` | 从主进程加载主题设置、监听系统主题变化、同步到 DOM |
| `AgentSettingsInitializer` | 加载 Agent 渠道/模型/工作区设置、订阅 MCP/文件变化事件 |
| `AgentListenersInitializer` | 挂载 `useGlobalAgentListeners`，全局 Agent IPC 监听 |
| `UpdaterInitializer` | 订阅主进程推送的自动更新状态变化事件 |

### 本地文件存储（`~/.proma/`）

```
~/.proma/
├── channels.json           # 渠道配置（API Key 经 safeStorage 加密）
├── conversations.json      # 对话索引（元数据，轻量）
├── conversations/          # 消息存储
│   └── {uuid}.jsonl        # 每对话一个 JSONL 文件，追加写入
├── agent-sessions.json     # Agent 会话索引
├── agent-sessions/         # Agent 会话消息存储
│   └── {uuid}.jsonl        # 每会话一个 JSONL 文件
├── agent-workspaces/       # Agent 工作区目录
│   └── {workspace-slug}/
│       ├── {session-id}/   # 会话工作目录
│       ├── workspace-files/# 工作区持久文件
│       ├── mcp.json        # MCP Server 配置
│       └── skills/         # Skills 配置目录
├── attachments/            # 附件文件
│   └── {conversationId}/
│       └── {uuid}.ext
├── user-profile.json       # 用户档案 { userName, avatar }
├── settings.json           # 应用设置 { themeMode }
└── sdk-config/             # Agent SDK 配置目录
    └── projects/           # SDK 项目配置
```

**关键设计**：
- JSON 配置 + JSONL 追加日志，无本地数据库，文件可移植
- Agent 工作区按 slug 隔离，每个会话独立目录
- MCP 配置和 Skills 按工作区管理

## 构建与打包

- 主进程/Preload 使用 esbuild；渲染进程使用 Vite；发布使用 electron-builder。
- Claude 与 Pi runtime 都必须保留为主进程 external：`@anthropic-ai/claude-agent-sdk`、`@earendil-works/pi-coding-agent`、`pi-agent-core`、`pi-ai`。
- 打包前必须运行 `bun run sync:runtime-deps`（`dist*` 脚本已包含），由 `apps/electron/scripts/sync-runtime-deps.ts` 将 external 依赖闭包复制到 `apps/electron/node_modules`。
- `apps/electron/electron-builder.yml` 的 `asarUnpack` 需保留 Claude SDK native binary 和 Pi native addon 规则。不要把这两套 runtime 改回 esbuild bundle。
- 改动 runtime 依赖、external 清单或打包规则后，至少运行 `bun run electron:build`；涉及分发时用 `cd apps/electron && bun run dist:fast` 验证目标平台产物。

## Agent Runtime 架构

Proma 的 Agent 模式通过 `RuntimeRoutingAgentAdapter` 统一入口，按会话的 `agentRuntime` 路由到两套适配器：

```text
用户输入 → AgentOrchestrator
  → RuntimeRoutingAgentAdapter
    ├→ ClaudeAgentAdapter → Claude Agent SDK
    └→ PiAgentAdapter     → Pi Agent SDK
  → SDKMessage 兼容消息流 → EventBus / IPC → Jotai / React
```

- **Claude Runtime（默认）**：`ClaudeAgentAdapter` 使用 `@anthropic-ai/claude-agent-sdk`。它要求渠道位于 `AGENT_COMPATIBLE_PROVIDERS`，即 Anthropic Messages API 或兼容端点。
- **Pi Runtime（实验性）**：由设置项 `experimentalAgentRuntimeSwitchEnabled` 显式开启；`PiAgentAdapter` 通过 `pi-model-registry.ts` 将任意已启用的 Proma 渠道注册为运行时 provider，覆盖 OpenAI Chat Completions / Responses、Google Generative AI 与 Anthropic Messages 协议。
- **会话语义**：会话元数据持久化 `agentRuntime` 与 `sdkSessionId`。切换 runtime 时必须清除旧的 `sdkSessionId`，以免跨 SDK resume；Proma 的 JSONL 消息仍保留并作为历史上下文回填。
- **共享能力**：两套 runtime 均复用工作区、权限服务、AgentEventBus、SDKMessage 持久化、Skills 与 Proma 内置 Automation / Collaboration 工具。Pi 的用户 MCP Server 需经 `adapters/pi-mcp-tools.ts` 连接并转换为 Pi custom tools，不能假设 Pi SDK 接受 Claude 的 `mcpServers` 参数。
- **运行时资源**：Pi runtime 需要在会话结束/取消时清理资源；不要绕开 `PiAgentAdapter` 或 `cleanupPiRuntimeResources()`。

### 修改 Agent 行为时的检查清单

1. 在 Claude 与 Pi runtime 下分别确认该行为是否应一致；不要把 Claude SDK 专有选项传给 Pi。
2. 新增或修改工具时，检查 Claude 的 MCP 注入路径和 Pi 的 `defineTool()` / custom-tool 桥接是否都已覆盖。
3. 新增模型渠道时，同时检查 `packages/shared/src/types/channel.ts` 的 Claude 兼容白名单与 `pi-model-registry.ts` 的协议、鉴权头、Base URL 映射。
4. 修改 IPC 时同步更新 shared 类型、main handler、preload bridge、renderer 调用。
5. 修改打包依赖时运行 build，必要时用分发产物验证两种 runtime。

## 代码风格

- 永远不要使用 `any` 类型 — 创建合适的 interface
- 对象类型优先使用 interface 而不是 type
- 尽可能使用 `import type` 进行仅类型导入
- 注释和日志采用中文，保留专业术语
- **路径别名**：`@/` → `apps/electron/src/renderer/`

## TypeScript 配置

- Module: `"Preserve"` + `"moduleResolution": "bundler"`
- JSX: `"react-jsx"`，严格模式启用，Target: ESNext
- 所有包 `"type": "module"`，导入时使用 `.ts` 扩展名

## 版本管理

提交代码时始终递增受影响包的 patch 版本（如 `0.1.18` → `0.1.19`），影响多个包则都要递增。

### 默认 Skills 版本契约（`apps/electron/default-skills/`）

修改任何 `default-skills/<skill>/` 内容时，**必须同步递增该 Skill `SKILL.md` frontmatter 的 `version` 字段**（patch +1）。

**为什么**：`seedDefaultSkills()` 与 `upgradeDefaultSkillsInWorkspaces()` 通过 semver 比较决定是否将 bundle 中的 Skill 同步到老用户的 `~/.proma/default-skills/` 与各工作区。**version 不变 = 老用户拿不到新内容**。

**早期实现曾用"无条件 cpSync"绕开这个约束**，但每次启动同步 4MB+ 文件会阻塞主进程导致启动卡顿，已恢复为 semver 比较（见 `config-paths.ts:seedDefaultSkills`、`agent-workspace-manager.ts:upgradeDefaultSkillsInWorkspaces`）。

**新增 Skill 不需要先注入 default-skills 目录的旧版本**——`upgradeDefaultSkillsInWorkspaces` 会通过"目标缺失即注入"路径让所有老工作区自动获得。

## 创作参考

遵循 [craft-agents-oss](https://github.com/craftship/craft-agents-oss) 的模式：

- **会话管理**：收件箱/归档工作流
- **权限模式**：safe / ask / allow-all
- **Agent Runtime**：Claude Agent SDK（[文档](https://platform.claude.com/docs/en/agent-sdk/typescript)）与 Pi Agent SDK（`@earendil-works/pi-*`）；共享上层会话、权限和消息协议。
- **MCP 集成**：Model Context Protocol 用于外部数据源
- **凭证存储**：AES-256-GCM 加密
- **配置位置**：`~/.proma/`（类似 `~/.craft-agent/`）

## 核心特性

### 已实现功能

- ✅ **多 Provider 支持**：Anthropic、OpenAI、DeepSeek、Kimi、智谱、MiniMax、豆包、通义千问、Google、自定义端点
- ✅ **双 Agent Runtime**：Claude Agent SDK（默认）与 Pi Agent SDK（实验性），通过统一路由、消息协议与权限桥接接入
- ✅ **飞书集成**：消息同步、任务通知、OAuth 认证（68KB 核心服务）
- ✅ **工作区管理**：多工作区隔离、MCP Server 配置、Skills 管理
- ✅ **权限系统**：工具权限检查、用户确认流程
- ✅ **自动更新**：Electron Updater 集成
- ✅ **代理支持**：系统代理检测与配置
- ✅ **文档解析**：PDF、Office、文本文件提取
- ✅ **多模态支持**：图片、文档附件
- ✅ **Chat 工具**：内置工具系统 + 动态加载

### 架构亮点

- **并发守卫**：同一会话防止并行请求冲突
- **全局监听**：Agent IPC 监听器永不销毁，确保后台会话不丢失
- **权限排队**：按 sessionId 隔离权限请求，支持多会话并行
- **文件监听**：工作区文件、MCP 配置、Chat 工具实时监控
- **事件流处理**：SDK 消息流式转换与累积
- **错误映射**：SDK 错误统一转换为应用错误
