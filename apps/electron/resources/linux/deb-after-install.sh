#!/bin/sh
# 为 Debian/Ubuntu 安装包启用 Electron 的 SUID sandbox。
#
# chrome-sandbox 必须由 root 拥有并具有 4755 权限才会被 Chromium 使用。deb
# 安装脚本以 root 身份执行；在只读或 nosuid 文件系统上，保留标准权限失败信息，
# 不会将应用静默降级为 --no-sandbox。
set -eu

APP_DIR="/opt/Proma"
SANDBOX="$APP_DIR/chrome-sandbox"

if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX"
  chmod 4755 "$SANDBOX"
else
  echo "[Proma] 未找到 chrome-sandbox：$SANDBOX" >&2
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

exit 0
