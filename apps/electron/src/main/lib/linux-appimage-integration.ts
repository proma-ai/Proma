import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { PROTOCOL_NAME } from './deep-link-startup'

export const APPIMAGE_DESKTOP_FILE_NAME = 'proma-appimage.desktop'

export interface AppImageProtocolHandlerOptions {
  appImagePath: string | undefined
  homeDir?: string
  xdgDataHome?: string | undefined
  runCommand?: (file: string, args: readonly string[]) => Promise<void>
}

function isSafeAppImagePath(path: string | undefined): path is string {
  return typeof path === 'string' && isAbsolute(path) && !/[\r\n\0]/.test(path)
}

/** 按 XDG Base Directory 规范定位用户级 desktop entry 目录。 */
export function getAppImageApplicationsDir(options: {
  homeDir: string
  xdgDataHome?: string | undefined
}): string {
  const dataHome = options.xdgDataHome && isAbsolute(options.xdgDataHome)
    ? options.xdgDataHome
    : join(options.homeDir, '.local', 'share')
  return join(dataHome, 'applications')
}

/**
 * Desktop Entry 的 Exec 字段不是 shell；路径仍需为双引号、反斜杠和 field code
 * 百分号转义，避免空格或 `%` 让 AppImage 路径在 xdg-open 中失效。
 */
function escapeDesktopExecArgument(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/%/g, '%%')}"`
}

/** 为直接运行的 AppImage 生成可被浏览器发现的用户级协议处理器。 */
export function buildAppImageDesktopEntry(appImagePath: string): string {
  if (!isSafeAppImagePath(appImagePath)) {
    throw new Error('APPIMAGE 路径必须是没有换行符的绝对路径')
  }

  return [
    '[Desktop Entry]',
    'Name=Proma',
    `Exec=${escapeDesktopExecArgument(appImagePath)} --no-sandbox %U`,
    'Terminal=false',
    'Type=Application',
    'Icon=proma',
    'StartupWMClass=proma',
    'Categories=Development;',
    `MimeType=x-scheme-handler/${PROTOCOL_NAME};`,
    '',
  ].join('\n')
}

const execFileAsync = promisify(execFile)

async function runXdgMime(file: string, args: readonly string[]): Promise<void> {
  await execFileAsync(file, [...args], { timeout: 5_000, windowsHide: true })
}

/**
 * AppImage 不会自动写入宿主机的 applications 数据库。首次手动启动时在用户目录
 * 安装一个 desktop entry，并用 xdg-mime 显式关联 proma://，以支持后续 OAuth 回调。
 */
export async function installLinuxAppImageProtocolHandler(
  options: AppImageProtocolHandlerOptions,
): Promise<{ desktopEntryPath: string } | null> {
  if (!isSafeAppImagePath(options.appImagePath)) return null

  const applicationsDir = getAppImageApplicationsDir({
    homeDir: options.homeDir ?? homedir(),
    xdgDataHome: options.xdgDataHome,
  })
  const desktopEntryPath = join(applicationsDir, APPIMAGE_DESKTOP_FILE_NAME)

  await mkdir(applicationsDir, { recursive: true })
  await writeFile(desktopEntryPath, buildAppImageDesktopEntry(options.appImagePath), { mode: 0o644 })
  await (options.runCommand ?? runXdgMime)(
    'xdg-mime',
    ['default', APPIMAGE_DESKTOP_FILE_NAME, `x-scheme-handler/${PROTOCOL_NAME}`],
  )

  return { desktopEntryPath }
}
