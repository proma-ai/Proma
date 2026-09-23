# AnySearch 内置 MCP 与 Skill：维护说明

Proma 的连接目录在 `apps/electron/src/renderer/components/agent-skills/integration-catalog.ts` 内置 AnySearch 远程 MCP 卡片。用户从「连接」选择它后，Proma 使用既有 MCP 安装与验证链路连接 `https://api.anysearch.com/mcp`；匿名使用不需 Python 或 API Key。该卡片请求启用，主进程先验证握手和工具发现，失败时保留待配置状态，不把卡片存在视为已连接。官方 MCP 暴露 `search`、`get_sub_domains`、`batch_search`、`extract`。

此目录另外提供默认 Skill：桌面安装包通过 `apps/electron/electron-builder.yml` 把 `default-skills/` 放入资源目录；启动时 `seedDefaultSkills()` 同步到用户默认目录，新旧工作区通过 `copyDefaultSkills()` 和 `upgradeDefaultSkillsInWorkspaces()` 获得该 Skill。Agent 可按 `SKILL.md` 调用随包分发的 REST 客户端，用于需要客户端直接控制搜索参数或用户已在环境中配置密钥的场景。当前 Skill 使用 `version: 1.0.1`；今后改动此目录时应递增 `SKILL.md` patch 版本，使既有工作区升级。

## 协议和配置

- 客户端只调用 `https://api.anysearch.com` 的 `POST /v1/search`、`GET /v1/domains`、`GET /v1/sub-domains` 和 `POST /v1/extract`，依赖 Python 3.10+ 标准库，无额外 Python 包。服务端能力目录会变化，垂直搜索先读实时目录，再按目录要求传 `tag`、`params`。
- 搜索传 `query` 与 `max_results`（1–10）；可选 `tag`、`params`、`zone`、`language`。批量搜索是客户端最多五路并发的独立搜索，保留顺序并逐项报告错误；没有虚构服务端批量 REST 接口。
- `ANYSEARCH_API_KEY` 不存在或为空时不传认证头，正常走匿名服务；配置后通过 `Authorization: Bearer` 发送。密钥不放在命令行参数、URL、测试快照或普通输出。客户端发送 `X-Anysearch-Client: proma-skill/1.0.1`。
- 原生 MCP 卡片当前只提供匿名连接；它不收集或保存 API Key。已有密钥的 REST 使用路径是本 Skill 的 `ANYSEARCH_API_KEY` 环境变量。若以后为 MCP 增加密钥配置，必须复用项目的系统 Keychain 流程，不能把密钥硬编码进本目录、公开 PR 或工作区普通文档。
- HTTP 错误、超时、非 JSON、非零业务 `code` 和主要响应结构损坏均作为失败返回。错误不回显远端原始正文。`extract` 拒绝非 HTTP(S)、内嵌凭据及明显本地/私有网络地址；搜索结果和提取正文始终视作不可信数据。

## 验证与限制

在仓库根目录运行：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s apps/electron/tests/anysearch -v
bun test apps/electron/src/renderer/components/agent-skills/integration-catalog.test.ts
bun run typecheck
```

可用普通公开查询手动调用 CLI 做匿名实测；若设置了凭证，先确认使用者自行授权该密钥的配额。还应使用 Proma 所用 MCP SDK 对官方端点完成匿名 handshake、`tools/list` 和 `tools/call`。2026-09-23 的无密钥预检覆盖通用搜索、`code.doc` 垂直目录及搜索、两路并行搜索、`example.com` 提取；响应均为 `code: 0`。相同 SDK 的匿名 MCP 预检发现上述四个工具，并实际调用通用搜索、`code.doc` 垂直搜索、两路批量搜索及 `example.com` Extract 成功。七项 Python 单测、目录测试、monorepo 类型检查及完整 Electron 源码构建通过。

本机还组装了未签名 macOS arm64 应用。安装包中 `default-skills/anysearch/SKILL.md` 和脚本与源码 SHA-256 一致；直接运行包内客户端，匿名搜索返回 `code: 0`。从该打包应用的正常「MCP/Skills」入口可见 AnySearch 内置 Skill 已启用；在「MCP」中点击「连接 AnySearch」后，页面显示「已连接」，本地配置记录为 `enabled: true`、无认证头、握手成功并发现四个工具。

用户配置现有模型后，macOS arm64 打包版的正常 Agent 对话已实际调用 MCP 普通、垂直、批量搜索和 Extract；无效子领域返回错误并被 Agent 正确报告。随包 REST Skill 的模型自主调用、真实 AnySearch Key、其他系统和全部故障状态仍需进一步验证。`code.doc` 仅适合真实软件包或框架；对任意产品名可能返回不相关文档。Pi 桥接的 AnySearch 搜索工具说明要求 Agent 核对相关性，并在不相关时改用普通搜索；客户端不会伪造来源。Agent 回复中的裸 URL 紧贴中文标点时，Markdown 渲染器将标点拆回正文，显式链接不受影响。

AnySearch 的 Extract 面向公开网页正文；PDF、Office 与媒体文件不在此客户端的提取承诺范围。匿名请求可能限额，客户端保留明确错误供 Agent 说明。仓库默认 Skill 中已有其他 Python 脚本，但用户系统若无 Python 3.10+，本 Skill 应明确提示运行条件，不能悄悄下载解释器或使用不明脚本。
