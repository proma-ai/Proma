# Proma Ubuntu / Linux 第一版支持说明

Proma 第一版 Linux 发布目标是 **Ubuntu 22.04 x86_64**，提供：

- `.deb`：Ubuntu/Debian 原生安装包，优先推荐；
- `AppImage`：便携运行包，适用于不希望安装系统包的用户。

当前不承诺 Fedora/RHEL、Arch、Linux arm64 或其他发行版的完整兼容性。

## 下载与安装

从 [GitHub Releases](https://github.com/proma-ai/Proma/releases) 下载对应版本：

```bash
# deb：推荐
sudo apt install ./proma_<版本>_amd64.deb

# AppImage：便携运行
chmod +x ./Proma-<版本>.AppImage
./Proma-<版本>.AppImage
```

`.deb` 安装后可以从应用菜单启动 Proma。AppImage 建议放在用户有写权限的本地目录；从只读目录、网络盘或部分企业挂载目录运行时，应用内更新可能不可用。

## 系统范围

| 系统 | 第一版状态 |
| --- | --- |
| Ubuntu 22.04 x86_64 | 目标支持平台 |
| Ubuntu 24.04 x86_64 | 计划支持，待独立验证 |
| Debian 12 x86_64 | 计划支持，待独立验证 |
| Linux arm64 | 未支持 |
| Fedora / RHEL / Arch | 未承诺 |

应用包会声明并安装需要的运行库。若使用 AppImage，宿主系统通常需要兼容的 GTK、NSS、X11/音频库；FUSE 不可用时可使用 `--appimage-extract-and-run` 作为临时回退方式。

Ubuntu 22.04 与 24.04 的系统包名称不同，不要直接复用其他版本的 `t64` 依赖名。遇到缺少共享库时，应优先通过 `.deb` 安装，让 apt 解析包依赖。

## Chromium sandbox

Proma 不在 Linux 全局关闭 Chromium sandbox。

- `.deb` 安装后脚本会尝试将 `/opt/Proma/chrome-sandbox` 设置为 `root:root` 和 `4755`，以启用 SUID sandbox；
- AppImage 使用 `--no-sandbox`，这是因为 AppImage 挂载文件系统无法可靠提供 SUID sandbox；
- 如果 `.deb` 位于 `nosuid` 文件系统，或安装脚本无法设置权限，应用可能无法启动或需要用户显式排查；不建议把 `--no-sandbox` 作为长期默认解决方案。

AppImage 的隔离能力低于正确配置的 `.deb`。Proma 内嵌浏览器处理不可信网页时，优先使用 `.deb` 版本。

## 更新

- AppImage：GitHub Release 提供 `latest-linux.yml` 时，electron-updater 可检查并下载新 AppImage；原文件必须位于可写目录；
- `.deb`：第一版以重新下载并通过 apt 安装新版为主，后续再提供签名 APT repository；
- 更新前 Proma 会等待正在运行的 Agent 结束，避免中断任务和写入会话。

## 数据位置

正式版本数据位于：

```text
~/.proma/
```

开发模式数据位于：

```text
~/.proma-dev/
```

会话、工作区、配置和 Skills 使用 JSON/JSONL 文件保存。迁移前请退出 Proma，并备份对应目录。

Linux 下 `safeStorage` 依赖 GNOME Keyring、KWallet 或其他 Secret Service 实现。无可用系统密钥环时，不建议在共享机器上保存 API Key；请先配置桌面密钥环并重新启动 Proma。

## 第一版验收边界

Linux 第一版代码和发布配置以 Ubuntu 22.04 x86_64 为目标。发布前应在干净环境完成：

1. `bun install --frozen-lockfile`；
2. AppImage 和 deb 构建；
3. deb 安装、卸载和升级；
4. AppImage 启动与更新；
5. Chat/Agent 流式响应和 JSONL 落盘；
6. 工作区、Skills、MCP、内嵌终端和内嵌浏览器；
7. X11 与 Wayland 基本启动；
8. 中文输入、剪贴板、窗口图标和任务栏关联。

本轮实现阶段不执行 Linux 实机打包、安装或 E2E；上述项目作为后续发布前验收清单。
