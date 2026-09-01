# Proma Ubuntu / Linux 适配说明

Proma 开源版官方 Release 仅提供 macOS（Apple Silicon / Intel）与 Windows 安装包，
CI（`.github/workflows/release.yml`）也只构建这两个平台。
但代码库本身已按跨平台设计（Bun + Electron monorepo）：

- 主进程绝大多数平台分支已包含 `linux` 路径（终端回退 `/bin/bash`、环境检测、
  系统代理检测、Bun 探测、托盘图标、数据目录 `~/.proma/` 等）；
- macOS 专属能力（灵动岛 Agent Island、EventKit 日历/提醒）在非 darwin 平台
  自动禁用，构建脚本（`build:agent-island-native` / `build:eventkit-native`）
  在 Linux 上直接跳过；
- 原生依赖均带 linux-x64 预构建产物（sharp、@napi-rs/canvas、
  @mariozechner/clipboard、photon-node）；
- OfficeCLI 二进制有官方 linux-x64 版本（`prepare:officecli` 内置 SHA-256 校验）；
- Proma CLI 用 `bun build --compile` 按宿主架构编译，在 Ubuntu 上直接产出
  linux-x64 可执行文件。

因此 Linux 适配的主要工作是**补齐 electron-builder 的 `linux` 打包配置**
（`apps/electron/electron-builder.yml` 的 `linux:` 节，目标 AppImage + deb），
其余为构建工具链准备。

## 系统要求

- Ubuntu 22.04+ / Debian 12+，x86_64（arm64 理论上可行，未验证）
- 构建需要：`bun`、`python3`、`make`、`g++`（node-pty 源码编译）
- 运行需要（桌面 Ubuntu 默认已带）：
  `libgtk-3-0t64`、`libnss3`、`libasound2t64`、`libxss1`；
  AppImage 方式运行还需 `libfuse2t64`

## 从源码构建

```bash
# 1. 获取源码
git clone https://github.com/proma-ai/Proma.git
cd Proma

# 2. 安装工具链（一次性）
curl -fsSL https://bun.sh/install | bash
sudo apt update
sudo apt install -y build-essential python3

# 3. 安装依赖
bun install

# 4. 开发模式（热重载）
bun run dev

# 5. 生产构建（不打包）
bun run electron:build

# 6. 打包 Linux 产物（AppImage + deb，输出到 apps/electron/out/）
bun run dist:linux -- --publish never
```

> `--publish never` 避免 electron-builder 尝试把产物上传到官方 GitHub Release
> （本地适配构建不应发布到 proma-ai/Proma）。
> 首次构建会自动：下载 Electron 二进制、编译 proma CLI、下载并校验
> OfficeCLI linux-x64 二进制。
>
> 产物（`apps/electron/out/`）：
> - `Proma-<版本>.AppImage`（约 280MB）
> - `proma_<版本>_amd64.deb`（约 180MB，deb 包名 `proma`）
> - `latest-linux.yml`（electron-updater 自动更新 feed）
>
> 版本注意：`apps/electron/package.json` 的 `electron` 依赖已固定为 `43.2.0`
> （与 `electron-builder.yml` 的 `electronVersion` 及官方 CI 保持一致；
> 原 `^43.2.0` 会漂移到更高 patch 版本造成开发/打包不一致）。
> `node-pty@1.1.0` 使用 N-API（ABI 稳定），bun install 时的源码编译产物
> 可直接被 Electron 加载，无需按 Electron ABI 重编译。

## 安装

### deb（推荐，Ubuntu 原生）

```bash
sudo dpkg -i apps/electron/out/proma_<版本>_amd64.deb
# 或
sudo apt install ./apps/electron/out/proma_*_amd64.deb
```

安装后从应用菜单启动 "Proma"。

> 桌面集成细节：`.desktop` 已按 Electron 43 实测的窗口 `WM_CLASS`
> （小写 `proma`，可用 `xprop WM_CLASS` 验证）设置 `StartupWMClass`，
> GNOME 任务栏/dash 能正确关联窗口与应用图标；若升级 Electron 后
> `WM_CLASS` 变化，需同步调整 `electron-builder.yml` 的
> `linux.desktop.StartupWMClass`。

### AppImage（便携）

```bash
chmod +x apps/electron/out/Proma-<版本>.AppImage
./Proma-<版本>.AppImage --no-sandbox
```

从桌面双击启动无需参数（electron-builder 生成的 .desktop 条目已带
`--no-sandbox`）；**终端直接运行需手动加 `--no-sandbox`**（原因见下节）。
AppImage 是 electron-updater 的自动更新目标（`latest-linux.yml` feed）；
dpkg 安装的 deb 版本不支持应用内自动更新，需要重新安装新版 deb。

## Ubuntu 24.04 的 Chromium 沙箱限制（重要）

Ubuntu 24.04 默认启用 AppArmor 对非特权用户命名空间的限制
（`kernel.apparmor_restrict_unprivileged_userns=1`），Chromium 的
user-namespace 沙箱因此不可用；若 SUID 沙箱（`chrome-sandbox`）又未配置，
Electron 启动时会直接 FATAL：

```
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166] The SUID
sandbox helper binary was found, but is not configured correctly.
```

适配构建的处理方式：

- electron-builder 生成的 Linux 桌面条目默认 `AppRun --no-sandbox`，
  因此 **deb / AppImage 从应用菜单启动开箱即用**；
- 终端手动运行（开发模式 `bun run dev`、`bunx electron .`、
  `./Proma.AppImage`）需要追加 `--no-sandbox`；
- 若希望恢复完整沙箱（更安全），可选其一：
  1. 放宽系统限制（全局，需 root）：
     `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`
     并写入 `/etc/sysctl.d/99-userns.conf` 持久化；
  2. 对 deb 安装配置 SUID 沙箱（一次性，需 root）：
     `sudo chown root:root /opt/Proma/chrome-sandbox && sudo chmod 4755 /opt/Proma/chrome-sandbox`
     （AppImage 内文件位于 FUSE 挂载，无法设置 SUID，不适用）。

## 数据位置

与官方版本一致：正式版本使用 `~/.proma/`，开发模式使用 `~/.proma-dev/`
（可用 `PROMA_DEV=1` 显式覆盖）。会话、工作区、配置、Skills 均为 JSON/JSONL，
迁移时直接拷贝该目录即可。

## Linux 下已知限制

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| Chat / Agent / 工作区 / Skills / MCP | 正常 | 核心能力与 macOS/Windows 一致 |
| 内嵌终端（node-pty） | 正常 | N-API 模块，源码编译后可直接使用；默认 shell `/bin/bash`，可选 zsh |
| 内嵌浏览器自动化 | 正常 | 基于 Electron BrowserView |
| 语音输入 | 部分 | 麦克风可用；“自动粘贴到光标”在 Linux 暂不支持，文本保留在剪贴板 |
| 灵动岛（Agent Island） | 不可用 | macOS 专属（Swift/AppKit），Linux 自动禁用 |
| 日历/提醒同步（EventKit） | 不可用 | macOS 专属，Linux 自动禁用 |
| 应用内自动更新 | AppImage 可用 / deb 不可用 | deb 用户需手动重装新版 |
| 托盘图标 | 正常 | X11 无问题；Wayland 下依赖桌面环境状态栏（GNOME 默认无系统托盘，需 AppIndicator 扩展） |
| API Key 加密（safeStorage） | 取决于 keyring | 依赖系统密钥环（GNOME Keyring / KWallet）。从应用菜单启动通常可用；
  若日志出现「safeStorage 加密不可用，将以明文存储」，渠道 API Key 将以明文存于
  `~/.proma/`（请自行注意 `chmod 700 ~/.proma`） |

## 端到端验证方法（已实测通过）

除启动冒烟外，还完成了完整的 Agent 对话链路验证（UI → IPC → Pi runtime →
HTTP/SSE → 渲染 → JSONL 落盘），方法可复用：

1. 用本地 mock 的 Anthropic 兼容端点（Python `http.server` 实现
   `POST /v1/messages` 返回 SSE 流）替换渠道 `baseUrl`；
2. `~/.proma/settings.json` 预设
   `agentChannelId` + `agentModelId` + `onboardingCompleted: true` +
   `onboardingVersion: 2`（两者缺一仍会显示引导页）；
3. 打包应用加 `--remote-debugging-port=9222` 启动，用 Node 22 内置
   `WebSocket` 走 CDP：`Input.insertText` 聚焦输入（合成 `input` 事件无法
   触发该组件的受控更新）、点「发送」；
4. 快速任务窗口的提交会隐藏自身并把 pending prompt 转给主窗口 composer
   （不自动发送），需再对主窗口 composer 发一次 Enter；
5. 断言：mock 收到 `x-api-key` 正确的 `/v1/messages`（含标题生成 +
   会话两轮），UI 渲染 mock 回复，`~/.proma/agent-sessions/*.jsonl`
   出现 `user → assistant → result(success)` 事件。

验证截图见 `docs/e2e-ubuntu-chat.png`（mock 回复渲染于主窗口 Agent 视图）。

## 故障排查

- **终端启动报 `posix_spawnp failed`**：node-pty 的 spawn-helper 丢了执行位，
  运行 `bun run --filter='@proma/electron' ensure:node-pty-helper`。
- **AppImage 报 `libfuse.so.2: cannot open shared object`**：
  `sudo apt install libfuse2t64`（Ubuntu 24.04 包名带 t64 后缀）。
- **窗口打不开 / 无反应（无头环境或远程桌面）**：
  加 `--no-sandbox` 或 `--disable-gpu` 参数启动；远程 X11 转发建议
  `xhost +local: && PROMA_DEV=1 bun run dev`。
- **node-pty 编译失败**：确认 `python3`、`make`、`g++` 已安装，
  且系统 Node 22 头文件可用（electron-rebuild 会自行下载 Electron 头文件）。
- **网络慢（国内）**：`bun install` 可设置镜像
  `bun config set registry https://registry.npmmirror.com`；
  Electron 二进制可设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
