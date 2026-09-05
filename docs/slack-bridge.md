# Slack Bridge（V1）

Slack Bridge 让运行 Proma 的**本机桌面客户端**通过 Slack **Socket Mode** 接收频道 `@mention`。它不需要公网 HTTP endpoint；Slack 只与本机建立出站 WebSocket 连接。

> 配置顺序：**Manifest → Socket Mode → xapp App Token → 安装应用并取得 xoxb Bot Token → Proma 保存并连接 → 频道验收**。

## 能力与边界

- 将 Bot 邀请进频道后，工作区成员可用 `@Proma` 发起任务；Proma 始终在该消息的 thread 中回复。
- 同一成员在同一 thread 中的后续消息会继续同一个 Proma 会话；不同成员各自隔离会话上下文。
- AskUserQuestion、计划批准/拒绝和单次 permission approval 会以 Block Kit 卡片回到原 thread。
- 普通模式先显示“Proma 正在规划…”，再节流更新；最终回复有持久化重试保障。
- 配置 Home Channel 后，桌面端、Automation 或其他 Bridge 发起的会话完成时会向该频道发送仅含标题与状态的完成通知，绝不复制会话回复；由 Slack 发起的任务不会重复通知。

V1 **仅支持频道 `@mention`**：不接收 Slack 私信、不提供配对码或用户授权名单，也不注册 Slash Commands。它同样不支持附件、语音、reaction trigger、全频道监听、用户 token、多 Slack workspace、Proma 管理的 OAuth 流程或 Slack Marketplace 分发。

Slack 自身的 **Install to Workspace** 是安装 Bot 所必需的 Slack 授权步骤，不等于 Proma 提供 OAuth 登录。

## 配置前准备

1. 在 Proma 中先选择一个有效的**默认项目**；新的 Slack thread 会以它作为初始项目和会话边界。
2. 确认你能在目标 Slack workspace 安装应用。若工作区要求管理员批准，请由管理员完成 Slack 授权页。
3. 不要将任何 `xapp-…` 或 `xoxb-…` Token 发给他人、贴进聊天记录或提交到 Git。Token 只应粘贴到本机 Proma 的 Slack 设置。

## 完整连接流程

### 1. 在 Proma 创建 Bot 配置并复制 Manifest

1. 打开 **设置 → Bot → Slack**。
2. 点击 **添加 Bot**。默认 App 名称为 `Proma`；可改为英文名称，但不能包含中文。
3. 展开 Bot 卡片，点击 **复制 Manifest**。
4. 暂时不要填写 Token；下面步骤会分别生成它们。

Manifest 仅包含频道 mention 所需的最小配置：

- Bot scopes：`app_mentions:read`、`channels:history`、`groups:history`、`chat:write`
- Bot events：`app_mention`、`message.channels`、`message.groups`
- Interactivity、Socket Mode，以及关闭 App Home 的 Messages tab

`message.channels` 与 `message.groups` 只用于延续已由 `@mention` 创建的 thread，以及接收该 thread 中的自由文本回答；Proma 会忽略频道根消息和未绑定 thread 中的普通消息。

### 2. 在 Slack API 创建应用并导入 Manifest

1. 打开 [Slack API Apps](https://api.slack.com/apps)。
2. 点击 **Create New App**，选择 **From an app manifest**。
3. 选择目标 workspace，然后粘贴刚复制的 Manifest。
4. 完成创建后，检查应用名称是 `Proma`。
5. 若页面顶部出现 **Save Changes**，点击它以保存 Manifest 导入后的改动。

> Manifest 是应用配置的唯一来源。不要手工添加重复的 events、commands 或 scopes；重复配置会让后续变更和排错变复杂。

### 3. 核验并启用 Socket Mode

1. 在 Slack 应用左侧打开 **Settings → Socket Mode**。
2. 确认 **Enable Socket Mode** 处于开启状态。
3. Socket Mode 页面应显示 Interactivity 和 Event Subscriptions 可通过 WebSocket 接收；不要填写 Event Subscriptions 的 **Request URL**。

Socket Mode 是必须项：Proma 不提供 HTTP Events receiver，也不需要公网回调地址。

### 4. 创建 App-Level Token（`xapp-…`）

此 Token 只用于 Proma 建立 Socket Mode 连接。

1. 在 **Socket Mode** 页面点击 **App Level Token**；新版 Slack 控制台会进入 **Basic Information → App-Level Tokens**。
2. 点击 **Generate Token and Scopes**。
3. Token Name 填 `proma-socket-mode`。
4. 点击 **Add Scope**，搜索并选择 `connections:write`。
5. 点击 **Generate**，立即复制生成的 `xapp-…` Token。
6. 回到 Proma 的 Bot 卡片，将它粘贴到 **App Token** 字段。

`connections:write` 是这个 Token 的唯一必需 scope。生成窗口通常只展示 Token 一次；丢失后请重新生成，而不是尝试从页面或日志中恢复。

### 5. 安装应用并取得 Bot Token（`xoxb-…`）

此 Token 用于调用 Slack Web API，例如发送 thread 回复、更新流式输出和响应交互卡片。

1. 在 Slack 应用左侧打开 **Settings → Install App**。
2. 点击 **Install to <你的工作区>**。
3. 在 Slack 授权页确认 workspace 与将授予的 Bot 权限，然后点击 **允许**。
4. 安装成功后，Slack 会显示并通常自动复制 **Bot User OAuth Token**；它以 `xoxb-…` 开头。
5. 将它粘贴到 Proma Bot 卡片的 **Bot Token** 字段。

> `xapp-…` 和 `xoxb-…` 不能互换。前者负责 Socket Mode，后者负责 Bot API 调用；缺少任一 Token 都无法完成连接。

### 6. 在 Proma 保存并连接

1. 确认 Bot 卡片中同时有 **Bot Token（xoxb）** 与 **App Token（xapp）**。
2. 可先点击 **测试 Token**：它只验证 Bot Token 是否能访问 Slack API，**不代表** Socket Mode 已连接。
3. 点击 **保存并连接**。
4. 观察 Bot 卡片状态：
   - **连接中…**：正在建立 Socket Mode 连接。
   - **已连接**：配置完成，Proma 已接收 Slack Socket Mode 事件。
   - **连接错误**：展开卡片查看脱敏错误信息，按“排障”处理。

Proma 使用 Electron `safeStorage` 加密保存 Token。正式版配置位于 `~/.proma/slack.json`；开发模式位于 `~/.proma-dev/slack.json`。每个 Bot 的 thread 绑定和投递 ledger 以 `slack-bindings-<botId>.json` 与 `slack-delivery-<botId>.json` 保存在同一配置目录。系统 Keychain/Secret Service 不可用时，Proma 会拒绝保存或使用 Token；恢复安全存储后重新粘贴并保存凭证。

## 频道验收

1. 选择一个低流量的测试频道，将 **Proma** 邀请进去。
2. 在频道发送：

```text
@Proma 用一句话回复“频道验收成功”
```

3. 预期 Proma 在该消息的 thread 内回复。后续消息请继续发在同一 thread，以延续上下文。
4. 若任务触发 AskUserQuestion、计划确认或权限确认，预期卡片也出现在同一 thread；仅该 thread 的原发起人可以操作自己的交互请求。

频道不需要逐个成员授权，但仍要求 Bot 已在频道中，并且新 thread 的首条消息必须包含 `@Proma`。将 Bot 邀请进频道即表示信任该频道全体成员：他们可发起任务，并对自己任务的计划和单次权限请求作出确认。普通频道消息不会触发。

## 从旧版私信配置迁移

如果此前导入过含私信、配对或 Slash Command 的旧 Manifest：

1. 在 Proma 重新复制当前 Manifest，并在 Slack 控制台替换为它。
2. 点击 **Save Changes**。
3. 由于 Bot scopes 已移除旧权限，请打开 **Install App** 并点击 **Reinstall to Workspace**。
4. 若 Slack 生成新的 `xoxb-…` Token，更新 Proma 中的 **Bot Token**，然后再次 **保存并连接**。

Proma 会在读取旧本地配置时丢弃遗留的配对码、成员授权名单和私信会话记录；新配置不会再保存它们。

## 常见问题与排障

| 现象 | 检查与处理 |
| --- | --- |
| App-Level Token 的旧 scope 选择器没有结果 | 从 Socket Mode 的 **App Level Token** 跳转到新版 **Basic Information → App-Level Tokens**，使用 **Generate Token and Scopes → Add Scope**，搜索 `connections` 并选择 `connections:write`。 |
| Slack 要求填写 Request URL | 确认 **Socket Mode** 已开启。V1 不使用 HTTP Request URL，不要为了消除提示而填写虚假地址。 |
| `测试 Token` 成功但状态不是“已连接” | 测试只覆盖 `xoxb`。确认 `xapp` 具有 `connections:write`、Socket Mode 已开启，然后点击 **保存并连接** 并查看脱敏错误。 |
| Slack 页面提示 scopes changed / reinstall | 先 **Save Changes**，再到 **Install App** 重装；scope 更新不会自动生效。 |
| 频道没有响应 | 确认 Bot 已被邀请进该频道，新 thread 的首条消息确实 `@Proma`，并确认 Proma 状态为“已连接”。普通频道消息不会触发。 |
| Bot 能收到消息但没有最终回复 | 保持 Proma 桌面端运行并检查状态。已准备好的终态会在 Socket 重连或进程重启后重试；若进程在 Agent 运行中重启，原 thread 会收到中断提示，请重新 @mention 发起任务。 |

## 安全与可靠性

- Token 仅由用户粘贴到本机 Settings；Settings IPC 使用不含 Token 字段的 DTO，已保存的 Token 永不回传 renderer，配置状态与日志都会脱敏。
- Bot 不接收私信。它会订阅自己已加入频道的消息，以延续已绑定的 thread，但只会由 `@mention` 创建新任务，并忽略普通频道消息与未绑定的 thread。
- 会话按 `teamId + channelId + rootThreadTs + userId` 隔离，避免多人 thread 上下文串扰。
- 事件处理使用去重、每个会话串行队列和持久化 delivery ledger；进程重启后会重试尚未送达的最终回复，并为运行中的任务投递明确的中断提示。
- Home Channel 只发送会话标题与完成/停止状态，不会转发桌面端、Automation 或其他 Bridge 的回复正文。标题本身仍会对该频道成员可见，请勿将敏感信息写入会话标题。

建议在专用 Slack development workspace 完成手工验收：频道 mention/thread、同一 thread 的串行消息、AskUserQuestion 的重复 event、计划批准/拒绝、permission 允许/拒绝、Home Channel 的无正文完成通知，以及在运行中重启后的中断提示。
