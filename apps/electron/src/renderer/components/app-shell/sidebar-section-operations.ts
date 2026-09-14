/** 默认区包括未分类项目与引用失效分区的历史项目。 */
export function getWorkspaceSectionTargets(
  sectionId: string | undefined,
  sections: ReadonlyArray<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  const currentId = sections.some((section) => section.id === sectionId) ? sectionId : ''
  return [
    ...(currentId ? [{ id: '', name: '项目' }] : []),
    ...sections.filter((section) => section.id !== currentId),
  ]
}

/** 空字符串是合法的默认区目标；null 表示没有目标，二者不能混用。 */
export function resolveSectionTarget(
  selected: string | null,
  targets: ReadonlyArray<{ id: string }>,
): string | null {
  return targets.some((target) => target.id === selected) ? selected : targets[0]?.id ?? null
}

/** 在第一次 await/React 提交之前锁定；调用者必须在权威刷新完成后释放。 */
export function createSectionOperationGate() {
  let busy = false
  let revision = 0
  return {
    get busy() { return busy },
    get revision() { return revision },
    acquire(): (() => void) | null {
      if (busy) return null
      busy = true
      const current = ++revision
      let released = false
      return () => {
        if (released || current !== revision) return
        released = true
        busy = false
      }
    },
  }
}
