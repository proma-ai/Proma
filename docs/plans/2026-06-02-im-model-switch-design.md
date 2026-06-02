# IM 模型切换能力设计（飞书 / 钉钉 / 微信）

> 日期：2026-06-02
> 分支：`feat-im-model-switch`

## 背景与目标

用户希望在飞书等 IM 上直接切换 Agent 使用的渠道与模型，无需回到 Proma 桌面端设置。具体需求：罗列渠道、进入某渠道、罗列该渠道下的模型、切换模型，并让 `/now` 显示当前模型。

## 关键现状（实现前盘点）

存在**两套独立的命令分发实现**：

| 平台 | 命令分发 | binding 类型 | 当前模型解析优先级 | 持久化 |
|------|---------|------------|------------------|--------|
| 飞书 | `feishu-bridge.ts` 自己的 switch + 卡片消息 | `FeishuChatBinding` | `botConfig 默认 > 应用设置 > binding`（`:1612-1613`） | ✅ 存盘 |
| 钉钉/微信 | 共享 `bridge-command-handler.ts` + 纯文本 | `BridgeChatBinding` | `应用设置 > binding`（`:610-611`） | ❌ 内存态 |

两套都把 binding（per-chat）排在全局默认**之后**，导致 per-chat 切换不会生效。

## 已确认的设计决策

1. **作用域：per-chat**。切换只影响当前 IM chat 绑定的会话，不同 chat 各用各的模型。
2. **命令形态：单命令带参数**，命令名 `/model`，并支持 `/m` 别名。
3. **渠道过滤：只列可用渠道**（`enabled === true` 且至少有一个 `enabled` 模型）。
4. **平台范围：三个 IM 都做**。
5. **钉钉/微信 binding 持久化：保持现状**（内存态，bridge 重启后切换失效，与现有 `/workspace`、`/switch` 行为一致）。

## 命令语义（三平台一致）

- `/model`（或 `/m`）→ 列出可用渠道，带序号
- `/model <渠道序号>` → 列出该渠道下启用的模型，带序号
- `/model <渠道序号> <模型序号>` → 切换：写入当前 chat 的 binding（飞书还需 `saveBindings()`）

非法序号给出友好提示，引导用 `/model` 重新查看。

## 核心改动：per-chat 优先级

把两套的模型/渠道解析改为 **binding 优先**：

- 飞书 `feishu-bridge.ts:1612-1613`：
  `binding.channelId || botConfig.defaultChannelId || appSettings.agentChannelId`（模型同理）
- 共享 `bridge-command-handler.ts:610-611`：
  `binding.channelId || appSettings.agentChannelId`，`binding.modelId ?? appSettings.agentModelId`

语义后果（符合 per-chat）：桌面端之后再改全局默认模型，**不影响**已切换过的 IM chat。binding 在创建时继承当时的全局默认值，之后独立。

## `/now` 增强（三平台）

在会话信息下方加一行：`模型: <渠道名> / <模型名>`，从 `binding.channelId` + `binding.modelId` 解析。渠道/模型已被删除或停用时降级显示原始 ID + 「(已失效)」提示。

## 架构：共享数据层 + 各自呈现

新建 `apps/electron/src/main/lib/bridge-model-utils.ts`，放纯逻辑（无平台耦合）：

- `listSwitchableChannels(): Channel[]` — 过滤 enabled + 有启用模型的渠道
- `getEnabledModels(channel): ChannelModel[]` — 取启用模型
- `resolveChannelByIndex(index)` / `resolveModelByIndex(channel, index)` — 按序号解析
- `describeBindingModel(channelId, modelId)` — 返回 `{ channelName, modelName, valid }` 供 `/now` 展示

呈现层各自实现：
- 飞书：`feishu-message.ts` 新增 `buildChannelListCard` / `buildModelListCard` / `buildModelSwitchedCard`
- 钉钉/微信：共享 handler 内拼纯文本

## 改动清单

### 新增
- `apps/electron/src/main/lib/bridge-model-utils.ts`

### 飞书
- `feishu-bridge.ts`：`handleCommand` 加 `/model`+`/m`；新增 `handleModelCommand`；切换写 binding + `saveBindings`；`:1612-1613` 优先级；`handleNowCommand` 加模型行
- `feishu-message.ts`：新增 3 个卡片 builder；`buildHelpCard` 加 `/model` 说明

### 钉钉/微信
- `bridge-command-handler.ts`：`handleCommand` 加 `/model`+`/m`；新增 `handleModelCommand`（纯文本）；切换写 binding；`:610-611` 优先级；`handleNowCommand` 加模型行；`sendHelp` 加说明

### 收尾
- `bun run typecheck` 通过
- 递增 `@proma/electron` patch 版本
- code-reviewer 审查

## 追加变更（2026-06-02 同批次）

### 移除未实现的 Chat 模式
飞书与共享 handler 的 Chat 模式一直只是占位（发消息回 "Chat 模式暂未实现"）。本批次彻底移除模式概念：
- 删除 `/chat`、`/agent` 命令及 `updateBindingMode`
- 删除 `FeishuChatBinding.mode` 与 `BridgeChatBinding.mode` 字段、所有 `mode: 'agent'` 初始化、`createNewSession` 的 mode 参数
- `handleUserMessage` 去掉 mode 分支，直接走 Agent 逻辑
- `/now` 去掉「模式」行；帮助卡片/文本/设置 UI 去掉 `/chat` `/agent`
- 旧持久化 binding 里残留的 `mode` 字段被忽略，无害

### 命令简写别名（不与现有命令冲突）
`/h`=help、`/n`=new、`/ls`=list、`/s`=stop、`/sw`=switch、`/ws`=workspace、`/m`=model。帮助卡片/文本与设置 UI 同步标注。

## 测试要点（BDD 思路）

- `/model` 列出渠道且只含可用渠道
- `/model 1` 列出该渠道启用模型
- `/model 1 2` 切换成功，`/now` 显示新模型
- 切换后发送消息，实际用新渠道/模型（验证优先级改动生效）
- 序号越界/非数字给出友好提示
- 飞书切换后重启 bridge，binding 保留（持久化）；钉钉/微信回落默认（内存态）
