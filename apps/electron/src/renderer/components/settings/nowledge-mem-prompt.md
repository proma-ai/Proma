请帮我从零完成 Nowledge Mem 接入 Proma 的完整配置。严格按以下步骤操作。

---

## Step 0：确认 Nowledge Mem 客户端已安装并运行（必须）

本地模式下**不需要登录或注册账号**——Nowledge Mem 是本地优先的，App 装好并启动之后，后台服务就在 `127.0.0.1:14242` 运行，Proma 通过 MCP 直连，全程不出本地。

先检查 App 是否已安装：

```bash
ls -d "/Applications/Nowledge Mem.app" 2>/dev/null && echo "已安装" || echo "未安装"
```

再检查后台服务是否在运行：

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:14242/mcp/ 2>/dev/null || echo "服务不可达"
```

返回 `200` 或非空即表示服务在运行。如果 App 已安装但服务不可达，打开 Nowledge Mem 桌面应用即可（它会在后台自动启动服务）。

**如果未安装**，去 https://mem.nowledge.co/zh 下载桌面应用。装好并启动后再继续下面的步骤，否则一切无法工作。

---

## Step 0.5：与用户确认目标工作区（必须）

MCP、Skills、Hooks 都是按工作区生效的，所以**必须先问清楚用户希望装到哪个工作区**。

先列出当前所有工作区：

```bash
ls ~/.proma/agent-workspaces/
```

然后**必须调用 `AskUserQuestion` 工具**向用户提问，不要用纯文本问，否则用户无法在选项中点选。具体参数：

- `question`: "你希望把 Nowledge Mem 装到哪个工作区？"
- `header`: "目标工作区"
- `multiSelect`: `false`
- `options`: 上一步扫描到的每个工作区名作为一个 option，`label` 直接写工作区名（如 `default`、`dev-pma`），`description` 留空或填工作区简介。`mcp.json` 中已存在 `nowledge-mem` 条目的工作区可以在 `description` 标注 "已配置"，方便用户避免重复装。

**记下用户选中的工作区名**（下文统一用 `<工作区名>` 表示）。后续 Step 2 / 3 / 4 中所有 `<工作区名>` 占位都要替换成用户的选择。

---

## Step 1：确保 nmem 命令行可用

**首先检测 nmem 是否已在 PATH 中**：

```bash
command -v nmem && nmem status
```

如果显示 `status: ok, mode: local, database connected, agent running`，跳过本步骤直接进入 Step 2。

否则按以下方式之一引导用户安装 nmem CLI（按推荐顺序）：

### 方式 A · 推荐 · macOS

让用户打开 **Nowledge Mem 桌面应用 → 设置 → 开发者工具 → 点击「安装 CLI」**。完成后跑：

```bash
nmem status
```

### 方式 B · 跨平台兜底 · macOS / Linux / Windows

如果方式 A 不可行（或用户在 Linux / Windows 上），用 **uv**（Astral.sh 的跨平台 Python 工具运行器）：

安装 uv（一次性）：

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows（PowerShell，注意：当前提示词其他步骤需要 bash 环境，Windows 用户建议在 Git Bash 中执行）
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

之后用 `uvx nmem-cli` 代替 `nmem` 调用，无需全局安装：

```bash
uvx nmem-cli status
```

如果走方式 B，**记下"用户的 nmem 实际命令是 `uvx nmem-cli`"**——这个信息当前 Step 4 的 hooks 不直接用到（hooks 是调用 `~/.proma/scripts/` 下的 Python 脚本，跟 nmem CLI 无关），但用户排错或自己用 nmem 时需要知道。

### 方式 C · 最后兜底 · 仅 macOS

只在方式 A、B 都不可行时使用，手动 wrap App Bundle 内置的 nmem：

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/nmem << 'EOF'
#!/bin/bash
exec "/Applications/Nowledge Mem.app/Contents/Resources/_up_/python-standalone/python/bin/python3" "/Applications/Nowledge Mem.app/Contents/Resources/_up_/python-standalone/python/lib/python3.13/site-packages/bin/nmem" "$@"
EOF
chmod +x ~/.local/bin/nmem
export PATH="$HOME/.local/bin:$PATH"
nmem status
```

注意：这条路径绕过 Nowledge 官方推荐方式，依赖 App 内部实现，未来 App 升级可能失效。

## Step 2：下载插件文件并安装到目标工作区
```bash
rm -rf /tmp/nowledge-community
git clone https://github.com/nowledge-co/community.git /tmp/nowledge-community

mkdir -p ~/.proma/scripts ~/.proma/agent-workspaces/<工作区名>/skills
cp /tmp/nowledge-community/nowledge-mem-proma-plugin/hooks/save-to-nmem.py ~/.proma/scripts/
cp /tmp/nowledge-community/nowledge-mem-proma-plugin/hooks/read-working-memory.py ~/.proma/scripts/
chmod +x ~/.proma/scripts/save-to-nmem.py ~/.proma/scripts/read-working-memory.py
cp -R /tmp/nowledge-community/nowledge-mem-proma-plugin/skills/{read-working-memory,search-memory,distill-memory,save-thread,status} ~/.proma/agent-workspaces/<工作区名>/skills/
```

## Step 3：配置目标工作区的 MCP
在 `~/.proma/agent-workspaces/<工作区名>/mcp.json` 中创建或编辑（顶层 key 必须是 `servers`）：

```json
{
  "servers": {
    "nowledge-mem": {
      "url": "http://127.0.0.1:14242/mcp/",
      "type": "http",
      "headers": {
        "APP": "Proma"
      }
    }
  }
}
```

如果文件已存在，把 `nowledge-mem` 合并进已有 `servers`，**不要覆盖其他条目**。

## Step 4：配置 Hooks
编辑 `~/.proma/sdk-config/.claude/settings.json`，添加以下 hooks。如果文件已有内容则合并，不要覆盖。

**先把下面所有 `<工作区名>` 替换成 Step 0.5 中用户选择的工作区**：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "PROMA_WORKSPACE_DIR=\"${PROMA_HOME}/agent-workspaces/<工作区名>\" python \"${PROMA_HOME}/scripts/read-working-memory.py\"",
            "timeout": 15000
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python \"${PROMA_HOME}/scripts/save-to-nmem.py\" --event user-prompt-submit",
            "timeout": 30000
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python \"${PROMA_HOME}/scripts/save-to-nmem.py\" --event stop",
            "timeout": 30000
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "PROMA_WORKSPACE_DIR=\"${PROMA_HOME}/agent-workspaces/<工作区名>\" python \"${PROMA_HOME}/scripts/read-working-memory.py\" --rewake",
            "timeout": 15000,
            "async": true,
            "asyncRewake": true,
            "rewakeMessage": "Nowledge Mem context refreshed"
          }
        ]
      }
    ]
  }
}
```

## Step 5：验证
```bash
export PATH="$HOME/.local/bin:$PATH"
nmem status
python3 ~/.proma/scripts/read-working-memory.py
grep 'nowledge-mem:start' ~/.proma/agent-workspaces/<工作区名>/CLAUDE.md && echo "Block 已注入" || echo "Block 缺失"

# 检查 5 个 skill 是否都已安装到目标工作区
for s in read-working-memory search-memory distill-memory save-thread status; do
  if [ -d ~/.proma/agent-workspaces/<工作区名>/skills/$s ]; then
    echo "✅ skill: $s"
  else
    echo "❌ skill: $s 缺失"
  fi
done
```
预期：
- `nmem status` 全绿
- `read-working-memory.py` 返回 `{"status": "updated"}`
- CLAUDE.md 中存在 nowledge-mem block
- 5 个 skill 全部显示 ✅

如有任何一项失败，回到对应 Step 重新执行。

---

## ⚠️ 以上步骤完成后，必须完全退出并重启 Proma，配置才会生效。

MCP 和 Hooks 只在 Proma 启动时加载，不重启等于没有配置。

重启后在新会话里验证：
1. `cat ~/.proma/logs/nm-hooks.log` — 确认有新的 SessionStart 记录
2. 用自然语言说「帮我记住：<想存的内容>」存第一条记忆
