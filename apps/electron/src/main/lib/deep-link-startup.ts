export const PROTOCOL_NAME = 'proma'

/** 从 Electron 的命令行参数中提取浏览器传入的 Proma deep-link。 */
export function extractPromaDeepLink(argv: readonly string[]): string | undefined {
  const prefix = `${PROTOCOL_NAME}://`
  return argv.find((arg) => arg.slice(0, prefix.length).toLowerCase() === prefix)
}

/**
 * 在 Cloud 认证服务初始化完成前暂存 deep-link，避免 Linux/Windows 冷启动时
 * OAuth token 在认证状态恢复过程中被丢弃或覆盖。
 */
export function createDeferredDeepLinkHandler(dispatch: (url: string) => void): {
  receive: (url: string) => void
  activate: () => void
} {
  let active = false
  const pendingUrls: string[] = []

  return {
    receive(url) {
      if (active) {
        dispatch(url)
        return
      }
      pendingUrls.push(url)
    },
    activate() {
      if (active) return
      active = true
      for (const url of pendingUrls.splice(0)) {
        dispatch(url)
      }
    },
  }
}
