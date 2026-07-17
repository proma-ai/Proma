# Proma

Proma is a local-first AI desktop app that brings multi-model Chat, general-purpose Agent workflows, workspaces, Skills, MCP, remote bots, and memory into one open-source client.

It is not just another chat box. Proma is meant to become a long-lived Agent workbench for your personal workflows: use Chat for simple answers, use Agent when the task needs to act on files, tools, projects, and longer context.

![Proma Poster](https://img.erlich.fun/personal-blog/uPic/pb.png)

[中文 README](./README.md) | [Beginner Tutorial](./tutorial/tutorial.md) | [Open-Source Release](https://github.com/ErlichLiu/Proma/releases) | [Commercial Version](https://proma.cool/download)

## What Proma Can Do

- **Chat mode**: multi-model conversations, attachments, image input, Markdown / Mermaid / KaTeX / code highlighting, parallel conversations, system prompts, and context controls.
- **Agent mode**: two built-in runtimes—Claude Agent SDK and Pi Agent SDK—with workspace isolation, permission modes, file operations, streaming output, plan confirmation, and ask-user interactions. Claude is the default; Pi is available behind an experimental setting.
- **Collaboration and tasks**: complex work can be split into traceable collaboration agents and tasks, with calls and results shown in the message stream.
- **Skills & MCP**: each workspace can manage its own Skills, MCP servers, and workspace files.
- **Remote bots**: Lark / Feishu bot bridging is supported, with DingTalk and WeChat bridge entry points also present in the app.
- **Memory and tools**: Chat and Agent can share memory, with web search, built-in Chat tools, and Agent recommendation helpers.
- **Local-first data**: conversations, workspaces, attachments, settings, and Skills are stored under `~/.proma/` as JSON / JSONL files, without a local database.
- **Desktop experience**: auto-update, proxy settings, file preview, global shortcuts, quick task window, voice input, and light / dark / system themes.

## Getting Started

### Download

Download the open-source version from [GitHub Releases](https://github.com/ErlichLiu/Proma/releases), with builds for macOS Apple Silicon, macOS Intel, and Windows.

If you want fewer API setup steps, you can also use the [Proma commercial version](https://proma.cool/download). The commercial and open-source versions run in parallel; the commercial version mainly adds built-in model channels and subscription options.

### First Setup

1. Open Proma and finish the environment check. Agent mode depends on local tooling, especially Git, Node.js / Bun, and a usable shell.
2. Go to **Settings > Channels**, add at least one AI provider channel, and fill in Base URL, API Key, and model list.
3. Chat mode can use OpenAI, Anthropic, Google, or OpenAI-compatible channels.
4. The default Claude Agent Runtime requires an Anthropic or Anthropic-compatible channel, such as Anthropic, DeepSeek, Kimi API, or Kimi Coding Plan.
5. To use the **experimental Pi Agent Runtime**, open **Settings > Experimental**, enable **Agent runtime switching**, then choose a default runtime for new sessions or switch Claude / Pi below the Agent input. Pi can use any enabled model channel.
6. Go to **Settings > Agent** and choose the default Agent channel, model, and workspace.
7. Configure memory, web search, or Feishu / DingTalk / WeChat bridges from their corresponding settings tabs if needed.

## Choosing A Mode

### Use Chat For

- Everyday Q&A, explanation, translation, rewriting, and lightweight code discussion.
- Reading attachments and summarizing or comparing their content.
- One-off conversations enhanced by web search or memory tools.
- Comparing outputs from multiple models or exploring different system prompts.

### Use Agent For

- Creating, editing, or organizing local files.
- Research, report writing, and multi-step tasks.
- Work that needs MCP, Skills, Shell, Git, project files, or external context.
- Tasks that benefit from permissions, plan mode, background execution, or remote bot follow-up.

In short: **use Chat when you need an answer; use Agent when you need work to be done.**

## Screenshots

### Chat Analysis

Use Chat for lightweight but practical analysis: compare audience needs, generate a table, and shape first-screen README copy quickly.

![Proma Chat analysis](./docs/assets/screenshots/proma-chat-demo.png)

### Agent Workbench

Agent works inside a workspace, reads project files, progresses through tasks, outputs structured findings, and keeps reusable files visible in the right-side workspace panel.

![Proma Agent workbench](./docs/assets/screenshots/proma-agent-demo.png)

### Skills

Each workspace can keep its own reusable Skills. The `feedback-synthesis` Skill shown here turns scattered feedback, interviews, and issues into themes, evidence, and priority suggestions.

![Proma workspace Skills](./docs/assets/screenshots/proma-skills-demo.png)

### Skills & MCP

The same workspace can manage stdio and HTTP MCP servers, enabling or disabling external context per project.

![Proma MCP settings](./docs/assets/screenshots/proma-mcp-demo.png)

### Streaming Voice Input

Proma supports Doubao-powered streaming voice input, both inside Proma and across the desktop:

- Inside Proma: press Ctrl + Backtick to start recognition, then press it again to finish and insert the transcript into the active Proma input box.
- Outside Proma: press Ctrl + Backtick to start recognition, then press it again to finish and insert the transcript at the current cursor position. If there is no active cursor, Proma writes the transcript to the clipboard.

![Proma voice input](./docs/assets/screenshots/proma-typeless-input.png)

## Agent Runtimes and Providers

Proma provides two switchable Agent runtimes:

- **Claude Agent Runtime (default)**: powered by `@anthropic-ai/claude-agent-sdk` and using the Anthropic Messages API or compatible endpoints.
- **Pi Agent Runtime (experimental)**: powered by `@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai`. It dynamically registers enabled Proma channels as Pi providers and supports OpenAI Chat Completions / Responses, Google Generative AI, Anthropic Messages, and compatible endpoints.

| Channel type | Chat | Claude Agent | Pi Agent (experimental) |
| --- | --- | --- | --- |
| Anthropic / Anthropic-compatible | Supported | Supported | Supported |
| Anthropic-protocol channels such as DeepSeek, Kimi API / Coding Plan, Zhipu Coding Plan, MiniMax, and Xiaomi MiMo | Supported | Supported | Supported |
| OpenAI, OpenAI Responses, Google, Zhipu AI, Doubao, and Qwen | Supported | Not yet | Supported |
| Custom OpenAI-compatible endpoints | Supported | Not yet | Supported |
| ChatGPT subscription (Codex OAuth) | — | Supported | Supported |

> **Experimental notice**: Pi Runtime is off by default. Once enabled, it can be switched per Agent session. Switching starts a new underlying SDK session but does not delete Proma's saved messages. Pi bridges workspace Skills, user-configured MCP servers, and Proma's built-in Automation / Collaboration tools. Tool calling, reasoning, and context capabilities still vary by model provider.

> **Kimi Coding Plan users**: Proma is officially whitelisted by Kimi. Using Proma with your Kimi Coding Plan subscription will not trigger any third-party client ban policy.

## Local Data

Proma stores data in local files so it is easy to back up, migrate, and inspect.

```text
~/.proma/
├── channels.json
├── conversations.json
├── conversations/
│   └── {conversation-id}.jsonl
├── agent-sessions.json
├── agent-sessions/
│   └── {session-id}.jsonl
├── agent-workspaces/
│   └── {workspace-slug}/
│       ├── workspace-files/
│       ├── mcp.json
│       └── skills/
├── attachments/
├── user-profile.json
├── settings.json
└── sdk-config/
```

API keys are encrypted through Electron `safeStorage` before being written to `channels.json`. Proma does not use a local database; core data is represented as JSON configuration and append-only JSONL logs.

## Development

Proma is a Bun workspace monorepo.

```text
proma-v2/
├── packages/
│   ├── shared/     # shared types, IPC constants, config, utilities
│   ├── core/       # Provider Adapters, SSE, code highlighting
│   └── ui/         # shared React UI components
└── apps/
    └── electron/   # Electron desktop app
```

Current package versions:

| Package | Version | Responsibility |
| --- | --- | --- |
| `@proma/electron` | `0.14.26` | Electron desktop app |
| `@proma/shared` | `0.1.42` | shared types, IPC constants, config, utilities |
| `@proma/core` | `0.2.15` | Provider Adapters, SSE, Shiki highlighting |
| `@proma/ui` | `0.1.9` | shared React UI components |

Common commands:

```bash
# Install dependencies
bun install

# Development mode: Vite + Electron + hot reload
bun run dev

# Build Electron app
bun run electron:build

# Build and run
bun run electron:start

# Typecheck
bun run typecheck

# Test
bun test
```

More granular scripts are available inside the Electron app:

```bash
cd apps/electron

bun run dev:vite
bun run dev:electron
bun run build:main
bun run build:preload
bun run build:renderer
bun run dist:fast
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Bun |
| Desktop | Electron 39 |
| Frontend | React 18 + TypeScript |
| State | Jotai |
| Styling | Tailwind CSS + Radix UI |
| Rich text input | TipTap |
| Markdown / diagrams / math | React Markdown + Beautiful Mermaid + KaTeX |
| Code highlighting | Shiki |
| Build | Vite + esbuild |
| Distribution | electron-builder |
| Agent runtimes | Claude: `@anthropic-ai/claude-agent-sdk@0.3.201`; Pi: `@earendil-works/pi-* @0.80.3` |

## Architecture

Proma's core communication path is:

```text
shared types and IPC constants
  -> main/ipc.ts handlers
  -> preload/index.ts window.electronAPI bridge
  -> renderer Jotai atoms and React components
```

Main-process services live in `apps/electron/src/main/lib/`:

- `agent-orchestrator.ts`: Agent orchestration, runtime routing, environment variables, SDK calls, event streams, and error handling.
- `adapters/claude-agent-adapter.ts` / `adapters/pi-agent-adapter.ts`: runtime adapters for Claude and Pi; `runtime-routing-agent-adapter.ts` routes each session to its selected runtime.
- `agent-session-manager.ts`: Agent session index and JSONL message persistence.
- `agent-workspace-manager.ts`: workspaces, MCP, Skills, and workspace files.
- `chat-service.ts`: Chat streaming, Provider Adapters, tool activity.
- `conversation-manager.ts`: Chat session index and message storage.
- `channel-manager.ts`: channel CRUD, API key encryption, connection tests, model fetching.
- `feishu-bridge.ts` / `dingtalk-bridge.ts` / `wechat-bridge.ts`: remote bot bridges.
- `chat-tool-*`, `document-parser.ts`, `workspace-watcher.ts`: tools, document parsing, and file watching.

Renderer state is managed with Jotai. Key atoms live in `apps/electron/src/renderer/atoms/`. Agent IPC listeners are mounted globally at the app root so streaming events, permission requests, and background tasks survive view changes.

## Packaging Notes

Both Agent runtimes run as esbuild external dependencies in the main process. Before invoking `electron-builder`, the Electron packaging scripts run `bun run sync:runtime-deps` to copy these runtime dependency closures into the app directory:

- `@anthropic-ai/claude-agent-sdk` (including the platform-specific Claude native binary)
- `@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai`
- Pi runtime native modules and `pdfjs-dist`

When changing packaging, verify that:

- `build:main` / `watch:main` keep both Agent SDKs external.
- `scripts/sync-runtime-deps.ts` stays aligned with the external runtime dependency list.
- `electron-builder.yml` retains the `asarUnpack` rules for the Claude binary and Pi native add-ons.
- After `bun run dist:fast` on a target platform, both Claude and Pi (when enabled) can start, call tools, and resume sessions.

See [AGENTS.md](./AGENTS.md) for the full engineering conventions.

## Contributing

Bug fixes, documentation improvements, tests, UX polish, Skills, MCP configs, and real-world Agent workflows are all welcome.

Before opening a PR, please check:

- Use Bun scripts and do not mix npm / pnpm lockfiles.
- Use Jotai for state management.
- Keep the app local-first and prefer config files plus JSON / JSONL storage.
- Do not use TypeScript `any`; prefer `interface` for object shapes.
- When adding IPC, update shared types, main handler, preload bridge, and renderer calls together.
- Bump the patch version of affected packages when behavior changes.
- Add focused tests where possible, especially for shared logic, IPC contracts, and persistence formats.

## Star History

<a href="https://www.star-history.com/?repos=ErlichLiu%2FProma&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ErlichLiu/Proma&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ErlichLiu/Proma&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=ErlichLiu/Proma&type=date&legend=top-left" />
 </picture>
</a>

## Credits

- [Shiki](https://shiki.style/): code highlighting.
- [Beautiful Mermaid](https://github.com/lukilabs/beautiful-mermaid): Mermaid diagram rendering.
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio): inspiration for multi-provider desktop AI products.
- [Lobe Icons](https://github.com/lobehub/lobe-icons): AI / LLM brand icons.
- [Craft Agents OSS](https://github.com/lukilabs/craft-agents-oss): Agent SDK integration reference.

## License

The Proma Community Edition is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE). The full license text is available in the `LICENSE` file at the repository root.

**Personal / non-commercial use**: free to use, modify, and distribute, subject to the terms of AGPL-3.0.

**Commercial use**: permitted as long as you fully comply with AGPL-3.0, including (but not limited to) releasing the complete corresponding source code of any modified version you distribute or make available over a network, and licensing all derivative works under AGPL-3.0.

**Commercial license (exemption from AGPL-3.0 obligations)**: if you want to integrate Proma into a closed-source product, offer it as a SaaS service without releasing your modifications, or use it in any way that cannot meet AGPL-3.0 requirements, please contact us by email to obtain a commercial license: [erlichliu@gmail.com](mailto:erlichliu@gmail.com).

By submitting a Pull Request to this project, you agree to license your contribution under AGPL-3.0 and to grant the maintainer the right to relicense it under future commercial license terms.
