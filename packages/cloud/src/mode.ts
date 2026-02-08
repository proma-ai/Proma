/**
 * Cloud 模式辅助工具（主进程）
 */

/** 判断当前是否为 Cloud 模式 */
export function isCloudMode(): boolean {
  return process.env.PROMA_MODE === 'cloud'
}

/** 获取当前运行模式 */
export function getPromaMode(): 'local' | 'cloud' {
  return process.env.PROMA_MODE === 'cloud' ? 'cloud' : 'local'
}
