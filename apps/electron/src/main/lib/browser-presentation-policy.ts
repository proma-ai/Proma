/**
 * 受管浏览器展示位纯策略（无 Electron 依赖，便于 bun 单测）。
 *
 * 方案 A：全局唯一展示位——主窗口槽 与 独立窗口 互斥；
 * 独立窗口 renderer 的 layout revision 计数起点独立于主窗口，必须按窗口域隔离。
 */

/** 主窗口 layout 在独立窗口在场期间应被忽略（主窗口槽整体禁用）。 */
export function shouldIgnoreMainLayout(detached: boolean): boolean {
  return detached
}

/** 独立窗口 layout 按窗口域 revision 拒绝旧值与非法值。 */
export function shouldIgnoreDetachedLayout(revision: number, lastRevision: number): boolean {
  return !Number.isSafeInteger(revision) || revision <= lastRevision
}
