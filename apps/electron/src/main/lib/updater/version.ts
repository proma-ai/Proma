import { gt, valid } from 'semver'

/**
 * 比较发布版本号。
 *
 * 与 electron-updater 一样使用完整的 SemVer 规则：支持 v 前缀、预发布标记
 * 与 build metadata；无法解析的异常元数据不会替换已下载的更新。
 */
export function isNewerVersion(candidate: string, baseline: string): boolean {
  const candidateVersion = valid(candidate)
  const baselineVersion = valid(baseline)
  return candidateVersion !== null && baselineVersion !== null && gt(candidateVersion, baselineVersion)
}
