# Proma

Proma is a local-first AI desktop app that brings multi-model Chat, general-purpose Agent workflows, workspaces, Skills, MCP, remote bots, and memory into one open-source client.

It is not just another chat box. Proma is meant to become a long-lived Agent workbench for your personal workflows: use Chat for simple answers, use Agent when the task needs to act on files, tools, projects, and longer context.

![Proma Poster](https://img.erlich.fun/personal-blog/uPic/pb.png)

[中文 README](./README.md) | [Beginner Tutorial](./tutorial/tutorial.md) | [Open-Source Release](https://github.com/ErlichLiu/Proma/releases) | [Commercial Version](https://proma.cool/download)

## What Proma Can Do

- **Chat mode**: multi-model conversations, attachments, image input, Markdown / Mermaid / KaTeX / code highlighting, parallel conversations, system prompts, and context controls.
- **Agent mode**: the Agent core has fully migrated to Proma's built-in Pi Agent Runtime with no third-party Agent runtime; workspace isolation, permission modes, file operations, streaming output, plan confirmation, and ask-user interactions are all supported.
- **In-app browser automation**: the Agent can directly operate the built-in managed browser—opening pages, inspecting page structure, clicking / filling controls, switching tabs, and opening `localhost` dev services; in-site search, post-login pages, dynamic content, and local HTML previews can all be handled by the Agent without manual copy-paste.
- **Collaboration and tasks**: complex work can be split into traceable collaboration sub-agents and tasks, with calls and results shown in the message stream.
- **Skills, MCP, and project instructions**: each Proma project manages its own Skills and MCP servers. Projects can declare trusted project instructions via `AGENTS.md`, and legacy `CLAUDE.md` configurations are auto-migrated. Project files can use a user-selected local project root or a Proma-managed blank-project directory.
- **Remote bots**: Lark / Feishu bot bridging is supported, with DingTalk and WeChat bridge entry points also present in the app.
- **Memory and tools**: Chat and Agent can share workspace memory, with memory changes tracked and refresh prompts shown in the UI; web search, built-in Chat tools, and Agent recommendation helpers are also available.
- **Local-first data**: conversations, workspaces, attachments, settings, and Skills are stored under `~/.proma/` as JSON / JSONL files, without a local database.
- **Desktop experience**: auto-update, proxy settings, file preview, global shortcuts, quick task window, Agent Island run states, voice input, and light / dark / system themes.

## Getting Started

### Download

Download the open-source version from [GitHub Releases](https://github.com/ErlichLiu/Proma/releases), with builds for macOS Apple Silicon, macOS Intel, and Windows.

The open-source version can be used independently with self-configured AI provider channels. If you prefer Proma-provided built-in model channels and subscription options, you can optionally explore the [Proma commercial version](https://proma.cool/download). The two versions support different preferences, and you are free to choose the one that best fits your workflow.

| Comparison | Open-source version | Commercial version |
| --- | --- | --- |
| Core desktop experience | Full Proma desktop experience with freedom to configure your workflow | The same core desktop experience |
| Model channels | Add and manage AI provider channels and API keys yourself | Sign in to use Proma-provided model channels, while keeping the option to configure third-party channels |
| Model pricing | Use each chosen provider under its own pricing and terms | Selected models have Proma Cloud-exclusive offers, with some priced as low as 20% of the official reference price |
| Agent security and reliability | Evaluate each provider's security, protocol compatibility, and reliability yourself; third-party relays also add trust and data-handling considerations | Use Proma Cloud's managed official route with unified security and reliability safeguards, Agent protocol compatibility, and model health monitoring—reducing uncertainty from opaque third-party relays |
| Web-connected and built-in AI capabilities | Configure search, image generation, and their API keys as needed | Get a more complete Proma Cloud web-connected and built-in experience, including WebSearch plus GPT Image 2 image generation and editing |
| Public API and services | Primarily use the provider APIs that you configure yourself | Create dedicated, quota-limited Proma Cloud API keys to bring LLM, tool, and multimodal capabilities into your own apps or services |
| Team credit management | Build your own member, credit-allocation, and usage-management processes | Team admins can allocate or reclaim shared team credits for members, automate monthly allocation, and review member usage and credit transactions |
| Skills distribution & collaboration | Skills are workspace-local; distribution and sharing across your team need to be self-organized | The enterprise version adds org-level Skills distribution and team collaboration: admins can push team-built Skills to members in one click, members use them without manual installation, and versions, updates, and usage scope are managed centrally |
| Subscription and usage | Manage provider accounts, balances, and usage yourself | Manage subscriptions and balance in the app, with detailed model, Agent, and tool usage |
| Switching from open source | — | Install over the existing app and continue using your local Proma data |

> Available models, prices, and benefits may change; refer to the current in-app information.

### Enterprise licensing

If your organization plans to deploy Proma for hundreds or thousands of employees, enterprise licenses are available. We can also provide scoped, lightweight customization around your deployment needs. The enterprise version offers org-level Skills distribution and team collaboration, so best practices your team builds can be pushed to members in one click and maintained centrally. Contact us on WeChat: `geekthings`.

### First Setup

1. Open Proma and finish the environment check. Agent mode depends on local tooling, especially Git, Node.js / Bun, and a usable shell.
2. Go to **Settings > Channels**, add at least one AI provider channel, and fill in Base URL, API Key, and model list.
3. Chat mode can use OpenAI, Anthropic, Google, or OpenAI-compatible channels.
4. Agent uses the Pi Runtime and can use any enabled model channel.
5. Go to **Settings > Agent** and choose the default Agent channel, model, and workspace.
6. Configure memory, web search, or Feishu / DingTalk / WeChat bridges from their corresponding settings tabs if needed.

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

Agent works across the project root and session workspace, reads project files, progresses through tasks, outputs structured findings, and keeps reusable files visible in the right-side file panel.

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

## Agent Runtime and Providers

Proma's Agent mode is driven by a single **Pi Agent Runtime**, powered by `@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai`, with no third-party Agent runtime. Enabled Proma channels are dynamically registered as Pi providers, supporting OpenAI Chat Completions / Responses, Google Generative AI, Anthropic Messages, and compatible endpoints. Historical sessions from the early Claude runtime are retained as read-only records: they can be viewed, but not continued, forked, or rewound.

| Channel type | Chat | Pi Agent |
| --- | --- | --- |
| Anthropic / Anthropic-compatible | Supported | Supported |
| Anthropic-protocol channels such as DeepSeek, Kimi API / Coding Plan, Zhipu Coding Plan, MiniMax, and Xiaomi MiMo | Supported | Supported |
| OpenAI, OpenAI Responses, Google, Zhipu AI, Doubao, and Qwen | Supported | Supported |
| Custom OpenAI-compatible endpoints | Supported | Supported |
| ChatGPT subscription (Codex OAuth) | — | Supported |
| xAI subscription (Grok OAuth) | — | Supported |

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
| Agent runtime | Pi: `@earendil-works/pi-* @0.82.1` |

## Architecture

Proma's core communication path is:

```text
shared types and IPC constants
  -> main/ipc.ts handlers
  -> preload/index.ts window.electronAPI bridge
  -> renderer Jotai atoms and React components
```

Main-process services live in `apps/electron/src/main/lib/`:

- `agent-orchestrator.ts`: Pi Agent orchestration, environment variables, event streams, and error handling.
- `adapters/pi-agent-adapter.ts`: Pi runtime adapter and session management.
- `agent-session-manager.ts`: Agent session index and JSONL message persistence.
- `agent-workspace-manager.ts`: Proma workspaces, project roots, MCP, and Skills.
- `chat-service.ts`: Chat streaming, Provider Adapters, tool activity.
- `conversation-manager.ts`: Chat session index and message storage.
- `channel-manager.ts`: channel CRUD, API key encryption, connection tests, model fetching.
- `feishu-bridge.ts` / `dingtalk-bridge.ts` / `wechat-bridge.ts`: remote bot bridges.
- `chat-tool-*`, `document-parser.ts`, `workspace-watcher.ts`: tools, document parsing, and file watching.

Renderer state is managed with Jotai. Key atoms live in `apps/electron/src/renderer/atoms/`. Agent IPC listeners are mounted globally at the app root so streaming events, permission requests, and background tasks survive view changes.

## Packaging Notes

The Pi Agent runtime runs as an esbuild external dependency in the main process. Before invoking `electron-builder`, the Electron packaging scripts run `bun run sync:runtime-deps` to copy these runtime dependency closures into the app directory:

- `@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai`
- Pi runtime native modules and `pdfjs-dist`

When changing packaging, verify that:

- `build:main` / `watch:main` keep Pi runtime dependencies external.
- `scripts/sync-runtime-deps.ts` stays aligned with the external runtime dependency list.
- `electron-builder.yml` retains the `asarUnpack` rules required by Pi native add-ons.
- After `bun run dist:fast` on a target platform, verify that Pi Agent can start, call tools, and resume sessions.

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

<a href="https://www.star-history.com/?repos=proma-ai%2Fproma&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=proma-ai/proma&type=date&theme=dark&legend=top-left&sealed_token=0cHFGjNPPe5hd2uxpF1cy35N2kYGSIEnTvyIbHlGjkrrtH9rnKcBMkqA8wDWltJIlPRKFZoYyPjXItri9HhQXE1TM1rwdIe91fqTqXVcPwK6OMzGEJ9yNw" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=proma-ai/proma&type=date&legend=top-left&sealed_token=0cHFGjNPPe5hd2uxpF1cy35N2kYGSIEnTvyIbHlGjkrrtH9rnKcBMkqA8wDWltJIlPRKFZoYyPjXItri9HhQXE1TM1rwdIe91fqTqXVcPwK6OMzGEJ9yNw" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=proma-ai/proma&type=date&legend=top-left&sealed_token=0cHFGjNPPe5hd2uxpF1cy35N2kYGSIEnTvyIbHlGjkrrtH9rnKcBMkqA8wDWltJIlPRKFZoYyPjXItri9HhQXE1TM1rwdIe91fqTqXVcPwK6OMzGEJ9yNw" />
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
