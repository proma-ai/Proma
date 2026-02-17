#!/usr/bin/env bash
# 分屏开发脚本 - 使用 tmux 或打开两个终端标签页（左右分屏）

set -e

# 检测是否在 tmux 中
if [ -n "$TMUX" ]; then
  echo "已在 tmux 中，创建左右分屏..."

  # 创建垂直分屏（tmux 中 -h 表示左右分屏）
  tmux split-window -h

  # 左侧运行 Vite
  tmux select-pane -L
  tmux send-keys "cd $(pwd) && bun run dev:vite" C-m

  # 右侧运行 Electron
  tmux select-pane -R
  tmux send-keys "cd $(pwd) && bun run dev:electron" C-m

elif command -v tmux &> /dev/null; then
  echo "启动 tmux 会话..."

  # 创建新的 tmux 会话
  tmux new-session -d -s proma-dev "cd $(pwd) && bun run dev:vite"

  # 创建左右分屏并运行 Electron
  tmux split-window -h -t proma-dev "cd $(pwd) && bun run dev:electron"

  # 选择左侧窗格（Vite）
  tmux select-pane -t proma-dev:0.0

  # 附加到会话
  tmux attach-session -t proma-dev

elif [[ "$OSTYPE" == "darwin"* ]]; then
  echo "在 macOS 上打开左右分屏..."

  # 检测是 iTerm2 还是 Terminal.app
  if [[ "$TERM_PROGRAM" == "iTerm.app" ]]; then
    # iTerm2 左右分屏
    osascript <<EOF
tell application "iTerm"
  tell current window
    tell current session
      -- 创建左右分屏（vertically 在 iTerm 中表示左右分屏）
      set newSession to (split vertically with default profile)

      -- 在新分屏（右侧）中运行 Electron
      tell newSession
        write text "cd $(pwd) && bun run dev:electron"
      end tell

      -- 在当前分屏（左侧）中运行 Vite
      write text "cd $(pwd) && bun run dev:vite"
    end tell
  end tell
end tell
EOF
  else
    # Terminal.app 打开两个标签页
    osascript <<EOF
tell application "Terminal"
  activate

  -- 创建新标签页运行 Vite
  tell application "System Events"
    keystroke "t" using command down
  end tell
  delay 0.5
  do script "cd $(pwd) && bun run dev:vite" in front window

  -- 创建新标签页运行 Electron
  tell application "System Events"
    keystroke "t" using command down
  end tell
  delay 0.5
  do script "cd $(pwd) && bun run dev:electron" in front window
end tell
EOF
  fi

else
  echo "不支持的平台或未安装 tmux"
  echo "请手动在两个终端中运行："
  echo "  终端 1: bun run dev:vite"
  echo "  终端 2: bun run dev:electron"
  exit 1
fi
