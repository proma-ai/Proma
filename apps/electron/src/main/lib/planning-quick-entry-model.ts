/** 用于 Windows Jump List 启动独立规划窗口的命令行参数。 */
export const OPEN_PLANNING_ARGUMENT = '--open-planning'

export function hasOpenPlanningArgument(argv: readonly string[]): boolean {
  return argv.includes(OPEN_PLANNING_ARGUMENT)
}

/**
 * 开发模式需把应用目录传给 Electron 可执行文件；打包版只需传功能参数。
 */
export function getPlanningTaskArguments(defaultApp: boolean, appPath: string): string {
  const appArgument = defaultApp ? `"${appPath}" ` : ''
  return `${appArgument}${OPEN_PLANNING_ARGUMENT}`
}
