# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

Proma 是一个集成通用 AI Agent 的下一代人工智能软件，采用 Electron 桌面应用架构。

## Monorepo 结构

Bun workspace monorepo：

```
proma-v2/
├── packages/
│   ├── shared/     # 共享类型、IPC 通道常量、配置、工具函数 (v0.1.15)
│   ├── core/       # AI Provider 适配器、代码高亮服务 (v0.2.2)
│   └── ui/         # 共享 UI 组件 (CodeBlock, MermaidBlock) (v0.1.3)
└── apps/
    └── electron/   # Electron 桌面应用 (v0.9.5)
        └── src/
            ├── main/       # 主进程 + 服务层 (main/lib/)
            ├── preload/    # IPC 上下文桥接
            └── renderer/   # React UI (Vite + Tailwind + Radix UI)
```

**包命名规范**：`@proma/*` 作用域（`@proma/core`、`@proma/shared`、`@proma/ui`、`@proma/electron`）

**依赖管理**：package.json 中使用 `workspace:*` 引用内部包

### 包职责详解

#### @proma/shared (v0.1.15)
- **导出模块**：`./types`、`./config`、`./utils`、`./constants/permission-rules`
- **关键类型**：`AgentMessage`、`ChatMessage`、`Channel`、`PermissionRequest`、`FeishuConfig`
- **依赖**：无运行时依赖（仅 TypeScript）

#### @proma/core (v0.2.2)
- **导出模块**：`./providers`、`./highlight`、`./types`、`./utils`
- **关键功能**：Provider 适配器注册表、代码高亮（Shiki）
- **依赖**：`@proma/shared`、`shiki`
- **Peer 依赖**：`@anthropic-ai/claude-agent-sdk`、`@anthropic-ai/sdk`、`@modelcontextprotocol/sdk`

#### @proma/ui (v0.1.3)
- **关键组件**：共享 React UI 组件库
- **依赖**：`@proma/core`、`beautiful-mermaid`、`shiki`、Radix UI
- **Peer 依赖**：`react@^18.3.0`、`react-dom@^18.3.0`

#### @proma/electron (v0.9.5)
- **职责**：Electron 桌面应用主体，集成所有包
- **关键依赖**：
  - `@anthropic-ai/claude-agent-sdk@0.2.120` - Agent SDK
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
| **Agent SDK** | @anthropic-ai/claude-agent-sdk | 0.2.120 |
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
- `MEMORY_IPC_CHANNELS` - 记忆功能
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
| `agent-team-reader.ts` | Agent 团队协作：团队配置读取 |
| `chat-service.ts` | Chat 流式调用编排（20KB）：Provider 适配器集成、消息持久化、AbortController |
| `conversation-manager.ts` | 对话管理（13KB）：对话 CRUD、JSONL 消息存储、置顶、上下文分割 |
| `channel-manager.ts` | 渠道管理（16KB）：渠道 CRUD、API Key AES-256-GCM 加密（safeStorage）、连接测试、模型获取 |

#### 集成服务

| 服务 | 职责 |
|------|------|
| `feishu-bridge.ts` | 飞书集成（68KB）：消息同步、任务通知、OAuth 认证 |
| `memory-service.ts` | 记忆管理：跨会话记忆存储与检索 |
| `memos-client.ts` | Memos 客户端：笔记服务集成 |

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
| **Moonshot** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
| **智谱 AI** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
| **MiniMax** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
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

## 构建工具

- **主进程/Preload**：esbuild (`--bundle --platform=node --format=cjs --external:electron --external:@anthropic-ai/claude-agent-sdk`)
- **渲染进程**：Vite + React 插件 + Tailwind CSS + HMR
- **开发热重载**：渲染进程 Vite HMR 即时生效；主进程/Preload 通过 electronmon 监听 dist 文件变化自动重启
- **打包分发**：electron-builder（配置见 `electron-builder.yml`）

### 重要：打包配置注意事项

**Agent SDK 打包要求（必须遵守）：**
- `@anthropic-ai/claude-agent-sdk` 必须使用 `--external` 参数排除在 esbuild 打包之外
- **0.2.113+ 架构变化**：SDK 主包已不再携带 JS CLI 入口（`cli.js`）和 `vendor/ripgrep/`，改为按平台分发 native binary（`claude` / `claude.exe`，单文件 214-252 MB），通过 `optionalDependencies` 安装到 `@anthropic-ai/claude-agent-sdk-{platform}-{arch}/` 子包
- `apps/electron/package.json` 必须显式声明当前 CI 矩阵覆盖的平台子包为 `optionalDependencies`（darwin-arm64 / darwin-x64 / win32-x64），否则 bun workspace 不会把它们链接到 `apps/electron/node_modules/`
- `electron-builder.yml` 的 `files` 配置要同时包含主包和所有平台子包：
  ```yaml
  files:
    - dist/**/*
    - package.json
    - node_modules/@anthropic-ai/claude-agent-sdk/**/*
    - node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/**/*
    - node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/**/*
    - node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/**/*
    - "!node_modules/@proma/**"
  ```
- SDK 主包和同级平台子包会被复制到 `app/node_modules/@anthropic-ai/`，Node.js 的模块解析能从 `app/dist/main.cjs` 找到
- `agent-orchestrator.ts` 中 `resolveSDKCliPath()` 解析到 SDK 主包入口后，沿 `..` 到 `@anthropic-ai/` 同级目录，再拼 `claude-agent-sdk-${platform}-${arch}/{claude|claude.exe}` 得到 binary 路径

**跨平台打包限制：**
- optionalDependencies 的平台子包由包管理器按 `os`/`cpu` 字段筛选：Apple Silicon runner 只会装 darwin-arm64，不会装 darwin-x64（cpu 不匹配）
- 因此当前 CI（macos-latest + windows-latest）**不支持在单个 macOS runner 上同时打 arm64 + x64 DMG**
- 若要发布 darwin-x64 版本，需要在 macos-13（x64 runner）单独跑一次构建
- Windows runner 默认 x64，打 win32-x64 正常

**不使用 extraResources 放 binary 的原因：**
- `extraResources` 会将文件复制到 `Contents/Resources/` 目录，路径与 node_modules 解析不一致
- 直接使用 `files` 配置让 Node.js 的模块解析能正确找到 SDK

**修改打包配置时的检查清单：**
1. ✅ 确认 SDK 在 esbuild 中使用 `--external` 参数
2. ✅ 确认 SDK 主包 + 所有目标平台子包都在 `files` 配置中
3. ✅ 确认 `apps/electron/package.json` 的 `optionalDependencies` 列出了所有目标平台子包
4. ✅ `bun install` 后验证 `apps/electron/node_modules/@anthropic-ai/claude-agent-sdk-{platform}-{arch}/` symlink 存在且 binary 可执行
5. ✅ 本地测试打包后的应用 Agent 功能（`CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist:fast`）

**其他依赖的打包策略：**
- **原则**：只有 `electron` 和 `@anthropic-ai/claude-agent-sdk` 需要标记为 `--external`
- `electron`：由 Electron 运行时提供，必须 external
- `@anthropic-ai/claude-agent-sdk`：有特殊打包要求（含 214 MB native binary），必须 external + 在 files 中包含主包和平台子包
- **所有其他依赖**（如 `electron-updater`、`undici`、`chokidar` 等）：应该让 esbuild 打包进 `main.cjs`
  - ✅ 优点：避免遗漏子依赖，简化 electron-builder 配置
  - ❌ 如果标记为 external：必须在 `electron-builder.yml` 的 `files` 中手动列出所有子依赖
- **常见错误**：将普通 npm 包标记为 external 但忘记在 `files` 中包含，导致打包后找不到模块（如 `Cannot find module 'universalify'`）

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

## Agent SDK 集成架构

基于 `@anthropic-ai/claude-agent-sdk@0.2.120` 实现 Agent 模式，与 Chat 模式并行。

### 核心流程

```
用户输入 → agent-orchestrator.ts (SDK 编排)
  ↓
SDK query() → SDKMessage 流
  ↓
convertSDKMessage() → AgentEvent[]
  ↓
webContents.send() → IPC 推送
  ↓
useGlobalAgentListeners (全局监听) → store.set(atoms)
  ↓
React UI 更新
```

### 关键组件

#### agent-orchestrator.ts（核心编排层，71KB）
- **并发守卫**：同一会话不允许并行请求
- **渠道管理**：查找渠道 + API Key 解密
- **环境构建**：环境变量 + SDK 路径解析
- **消息持久化**：SDK 消息存储到 JSONL
- **事件流处理**：文本累积 + 工具调用解析
- **错误处理**：SDK 错误映射 + 重试逻辑
- **自动标题**：首次对话自动生成标题

#### agent-prompt-builder.ts（提示词构建，18KB）
- **系统提示词生成**：基于工作区配置
- **动态上下文构建**：注入工作区信息
- **内置 Agent 构建**：预定义 Agent 配置

#### agent-permission-service.ts（权限管理）
- **工具权限检查**：基于权限规则
- **权限模式管理**：safe / ask / allow-all

### 关键设计

- **SDK 调用**：`sdk.query({ prompt, options: { apiKey, model, permissionMode, cwd, abortController } })`
- **事件转换**：`convertSDKMessage()`（`@proma/shared`）将 SDK 原始消息转为统一的 `AgentEvent` 类型
- **工具匹配**：`packages/shared/src/agent/tool-matching.ts` — 无状态 `ToolIndex` + `extractToolStarts` / `extractToolResults` 解析工具调用
- **状态管理**：`applyAgentEvent()` 纯函数更新 `AgentStreamState`，支持流式增量更新
- **全局 IPC 监听**：`useGlobalAgentListeners`（`renderer/hooks/`）在 `main.tsx` 顶层挂载，通过 `useStore()` 直接操作 atoms，永不销毁。确保页面切换（如设置页）时流式输出、权限请求不丢失
- **权限请求排队**：权限/AskUser 请求按 sessionId 入队到 Map atoms（`allPendingPermissionRequestsAtom` / `allPendingAskUserRequestsAtom`），不区分当前/后台会话，SDK Promise 等待用户回来响应
- **工作区隔离**：每个工作区独立的 MCP Server 配置和 cwd，Agent 会话按工作区过滤

### SDK 版本升级注意事项

**`@anthropic-ai/claude-agent-sdk` 0.2.113+ `options.env` 语义为"替换"**

- SDK 将 `options.env` **替换** 传递给子进程（0.2.111/0.2.112 短暂改为叠加，0.2.113 恢复替换）
- 如果传 `env` 时只给 `ANTHROPIC_*` 相关变量，子进程会丢失 `PATH` / `HOME` / `SHELL` 等关键变量，导致 SDK 调用 `npx` / `git` 等命令失败
- **正确做法**：`agent-orchestrator.ts` 的 `buildSdkEnv()` 末尾显式 `{ ...cleanEnv, ...customEnv }` 合并 `process.env`，再剥离不希望泄漏的 `ANTHROPIC_*` 变量
- **修改 `buildSdkEnv()` 时的检查清单**：
  1. ✅ 基于 `process.env` 合并，保证 PATH / HOME / SHELL 等继承到子进程
  2. ✅ 过滤掉不希望泄漏的 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_CUSTOM_HEADERS`、`ANTHROPIC_MODEL` 等
  3. ✅ 新增的 SDK 识别的环境变量必须显式加入 `sdkEnv`
- 若未来升级到后续大版本导致语义再次变化，需重新评估本加固逻辑

**关键 Breaking Changes（升级参考）**：
- `0.2.91`: `sandbox.failIfUnavailable` 默认从 `false` 变为 `true`（目前项目未使用 sandbox 选项）
- `0.2.111`: `options.env` 从"替换"变为"叠加"
- `0.2.113`:
  - `options.env` 回退为"替换"
  - **SDK 包结构重构**：删除 `cli.js`，改为平台 native binary（通过 `@anthropic-ai/claude-agent-sdk-{platform}-{arch}` optionalDependency 分发），ripgrep 编译进 binary
  - 详见上方"打包配置注意事项"段落
- `0.2.120`: `query()` 省略 `settingSources` 时默认加载所有来源（Proma 已显式传 `['user', 'project']`，不受影响）

### 共享类型（`@proma/shared`）

- `AgentEvent`：Agent 事件（text / tool_start / tool_result / done / error）
- `AgentSessionMeta`：会话元数据（id / title / channelId / workspaceId）
- `AgentMessage`：持久化消息（role + content blocks）
- `AgentSendInput`：发送请求输入
- `AGENT_IPC_CHANNELS`：Agent 相关 IPC 通道常量
- `WorkspaceCapabilities`：工作区能力（MCP Server 列表 + Skills 列表）

## 创作参考

遵循 [craft-agents-oss](https://github.com/craftship/craft-agents-oss) 的模式：

- **会话管理**：收件箱/归档工作流
- **权限模式**：safe / ask / allow-all
- **Agent SDK**：@anthropic-ai/claude-agent-sdk（[v1 文档](https://platform.claude.com/docs/en/agent-sdk/typescript)、[v2 文档](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)）
- **MCP 集成**：Model Context Protocol 用于外部数据源
- **凭证存储**：AES-256-GCM 加密
- **配置位置**：`~/.proma/`（类似 `~/.craft-agent/`）

## 核心特性

### 已实现功能

- ✅ **多 Provider 支持**：Anthropic、OpenAI、DeepSeek、Moonshot、智谱、MiniMax、豆包、通义千问、Google、自定义端点
- ✅ **Agent SDK 集成**：基于 Claude Agent SDK 的完整 Agent 模式
- ✅ **飞书集成**：消息同步、任务通知、OAuth 认证（68KB 核心服务）
- ✅ **工作区管理**：多工作区隔离、MCP Server 配置、Skills 管理
- ✅ **权限系统**：工具权限检查、用户确认流程
- ✅ **记忆系统**：跨会话记忆存储与检索
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
