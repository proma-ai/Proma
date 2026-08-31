export interface WindowsPtyOptions {
  backend: 'conpty'
  buildNumber: number
}

export const CONSERVATIVE_CONPTY_BUILD_NUMBER = 19041

/**
 * xterm.js 必须知道 ConPTY 的 build 才能启用 Windows 的换行启发式规则。
 * 以最早完整支持 ConPTY 的 Windows 10 build 作为保守基线：它会关闭 xterm
 * 对当前输入行的二次 reflow，交给 PowerShell/cmd/ConPTY 保持真实光标位置。
 */
export function getWindowsPtyOptions(): WindowsPtyOptions {
  return { backend: 'conpty', buildNumber: CONSERVATIVE_CONPTY_BUILD_NUMBER }
}
