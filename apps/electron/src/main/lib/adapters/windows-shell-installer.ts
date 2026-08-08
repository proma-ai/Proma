export type WindowsShellInstallerTrigger = 'user' | 'automation' | 'delegation' | undefined

/**
 * 仅对没有 Shell 的前台 Windows Agent 提供安装工具。
 * 后台自动任务和子 Agent 无法可靠地等待用户完成系统安装，必须跳过。
 */
export function shouldOfferWindowsShellInstaller(
  platform: NodeJS.Platform,
  windowsShellAvailable: boolean | undefined,
  triggeredBy: WindowsShellInstallerTrigger,
): boolean {
  return platform === 'win32' && !windowsShellAvailable && triggeredBy === 'user'
}
