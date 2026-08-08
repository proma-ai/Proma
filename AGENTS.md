# Proma 工程约定

Proma 是一个本地优先的 Electron AI 桌面 Agent。仓库是 Bun monorepo；主应用在 `apps/electron`，共享包在 `packages/*`。

## 必须遵守

- 使用 **Bun**，不使用 npm/pnpm：`bun run dev`、`bun run typecheck`、`bun test`。
- 注释、日志和用户可见的工程文档优先使用中文，保留必要技术术语。
- 不使用 `any`；对象类型优先 `interface`，仅类型导入优先 `import type`。
- 状态管理统一使用 Jotai。保持组件化、可读、最小设计；避免过度抽象。
- 先调研再新增依赖，明确版本与维护状态；不要凭习惯加入依赖。
- 本地优先：持久化优先采用可移植的 JSON/JSONL 配置文件，不引入本地数据库。
- 修改 JSON 配置或会话元数据时，使用 `apps/electron/src/main/lib/safe-file.ts` 的原子写封装；不要直接 `writeFileSync`。
- 功能改动应有 BDD 风格的可执行测试，至少覆盖正常路径和主要边界。
- 改动 UI 时复用既有 Radix/shadcn primitives 与主题变量；重视空状态、键盘操作、加载态和深浅主题。

## 常用命令

```bash
# 开发
bun run dev

# 构建 / 类型检查 / 测试
bun run build
bun run electron:build
bun run typecheck
bun test

# 打包（apps/electron 内）
bun run dist:mac
bun run dist:win
bun run dist:linux
bun run dist:fast
```

对单一变更优先运行最小相关测试，再运行 `bun run typecheck`。改运行时依赖、external 清单或打包规则后，至少运行 `bun run electron:build`；涉及发布产物时运行目标平台的打包冒烟验证。

## 目录与边界

```text
apps/electron/                    Electron 主应用
  src/main/lib/                   主进程服务、Agent/Pi runtime、持久化
  src/preload/                    类型安全 IPC bridge
  src/renderer/                   React + Vite + Tailwind UI
  default-skills/                 随应用分发的默认 Skills
packages/shared/                  类型、IPC 常量、通用工具
packages/core/                    Provider 适配器、SSE、代码高亮
packages/session-core/            会话通用能力
packages/ui/                      跨应用共享 UI
release-notes/                    版本发布日志
```

### IPC 是四层契约

新增/修改 IPC 时必须同步检查：

1. `packages/shared` 的通道常量和请求/响应类型；
2. `apps/electron/src/main/ipc.ts` 的 handler；
3. `apps/electron/src/preload/index.ts` 的 bridge；
4. renderer 的调用、错误处理与状态更新。

### Agent 与项目指令

- Proma 仅使用 **Pi Agent runtime**。不要重新引入 Claude Agent SDK 或其专属配置、session 语义和打包依赖。
- 用户项目的 `AGENTS.md` 由 `project-instruction-resolver.ts` 在已授权项目根内显式解析；禁止恢复 cwd、祖先目录或附加目录的环境式规则发现。
- Proma 受管工作区的 `AGENTS.md` 与用户项目的 `AGENTS.md` 有不同所有权边界，均须通过已验证的显式路径注入。
- 旧项目 `CLAUDE.md` 仅是兼容输入，不能自动覆盖、合并或删除用户文件。
- 改动 Agent 工具、权限或上下文路径时，检查工作区隔离、附加目录边界、会话恢复与 Automation/Collaboration 的回归。

### 默认 Skills

修改 `apps/electron/default-skills/<skill>/` 的任何内容时，必须同步递增该 Skill `SKILL.md` frontmatter 的 `version`（patch +1），否则老工作区不会收到升级。

## 版本、提交与文档

- **每次改动都必须递增版本号**：代码、UI、默认 Skills、文档或工程配置的任何提交，至少将对应交付物的 patch 版本 +1；跨多个可发布包时逐个递增受影响包。
- `apps/electron/package.json` 是桌面应用版本；`packages/*/package.json` 是各共享包版本；默认 Skill 改动还必须递增其 `SKILL.md` frontmatter 的 `version`。
- 仅在功能行为、安装方式或用户流程发生变化时更新 README / tutorial / release notes；改文档前先取得用户授权。
- 提交前检查 `git diff`，不要覆盖用户已有改动或提交无关文件。
