export interface WindowsPtyOptions {
  backend: 'conpty'
  buildNumber: number
}

export const CONSERVATIVE_CONPTY_BUILD_NUMBER = 19041

/**
 * xterm.js 必须知道 ConPTY 的 build 才能选择正确的 Windows buffer resize 路径。
 * 固定为最早完整支持 ConPTY 的 Windows 10 build，使不同 Windows 版本都采用
 * 保守兼容策略，避免 xterm.js 与 ConPTY 对输入行和历史缓冲重复重排。
 */
export function getWindowsPtyOptions(): WindowsPtyOptions {
  return { backend: 'conpty', buildNumber: CONSERVATIVE_CONPTY_BUILD_NUMBER }
}
