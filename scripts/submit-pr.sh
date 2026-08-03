#!/usr/bin/env bash
# 提 PR 到 proma-ai/Proma 一键脚本
#
# 前置：你需要在 GitHub 上 fork 过 proma-ai/Proma，并在本机配置好 git 身份和凭据：
#   git config --global user.name "你的名字"
#   git config --global user.email "你的邮箱"
#   # 推荐：GitHub 生成 Personal Access Token（repo 权限），然后：
#   #   export GH_TOKEN=ghp_xxx
#   # 或用 gh CLI：brew install gh && gh auth login
#
# 用法：bash scripts/submit-pr.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# 1. 配置
FORK_REMOTE="${FORK_REMOTE:-fork}"          # fork 远程名
BRANCH="feat/proactive-agent"               # 推送分支名
PR_TITLE="feat: Proactive Agent - 主动记忆 + 主动建议 + 主动中心"

echo "=== 1/5 检查 git 身份 ==="
if [ -z "$(git config user.name)" ] || [ -z "$(git config user.email)" ]; then
  echo "❌ 请先配置 git 身份："
  echo "   git config --global user.name '你的名字'"
  echo "   git config --global user.email '你的邮箱'"
  exit 1
fi
echo "  用户: $(git config user.name) <$(git config user.email)>"

echo "=== 2/5 检查 fork 远程 ==="
if ! git remote get-url "$FORK_REMOTE" >/dev/null 2>&1; then
  echo "❌ 缺少 fork 远程。请先在 GitHub 上 fork proma-ai/Proma，然后："
  echo "   git remote add $FORK_REMOTE https://github.com/<你的账号>/Proma.git"
  exit 1
fi
echo "  fork: $(git remote get-url "$FORK_REMOTE")"

echo "=== 3/5 创建并推送分支 ==="
git checkout -B "$BRANCH" origin/main 2>/dev/null || git checkout -B "$BRANCH"
# 确保包含全部 27 个功能 commits（如果 main 已领先，这里会保留；否则从 origin/main 重建）
git push -u "$FORK_REMOTE" "$BRANCH" --force

echo "=== 4/5 创建 PR ==="
PR_BODY_FILE="PR_DESCRIPTION.md"
if command -v gh >/dev/null 2>&1; then
  gh pr create --repo proma-ai/Proma --head "$FORK_REMOTE:$BRANCH" --base main \
    --title "$PR_TITLE" --body-file "$PR_BODY_FILE"
  echo "✅ PR 已创建（gh CLI）"
else
  echo "⚠️ 未安装 gh CLI，请手动创建 PR："
  echo "   1. 打开 https://github.com/proma-ai/Proma/pull/new/$BRANCH"
  echo "   2. 标题: $PR_TITLE"
  echo "   3. 正文: 复制 PR_DESCRIPTION.md 的内容"
  echo ""
  echo "   或者安装 gh 后重跑本脚本：brew install gh && gh auth login"
fi

echo "=== 5/5 完成 ==="
echo "PR 描述已保存在: $(pwd)/PR_DESCRIPTION.md"
