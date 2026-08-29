export type FileScope = 'project' | 'session'

export interface FileBrowserRoot {
  path: string
  scope: FileScope
}

/**
 * 将 FileBrowser 实际消费的根目录属性编码成稳定签名。
 * 调用方常在 render 中临时拼接 roots；同一组根目录不应因此触发目录重新加载。
 */
export function getFileBrowserRootsKey(roots: readonly FileBrowserRoot[] | undefined): string {
  return JSON.stringify(
    (roots ?? [])
      .filter((root) => Boolean(root.path))
      .map(({ scope, path }) => [scope, path]),
  )
}

/** 从稳定签名恢复目录列表，供 useMemo 避免捕获每次 render 都会新建的 roots 数组。 */
export function getFileBrowserRootsFromKey(rootsKey: string, rootPath: string | undefined): FileBrowserRoot[] {
  const roots = JSON.parse(rootsKey) as Array<[FileScope, string]>
  if (roots.length > 0) return roots.map(([scope, path]) => ({ scope, path }))
  return rootPath ? [{ path: rootPath, scope: 'project' }] : []
}
