import type { VaultReadResult, VaultRenameInput } from '@proma/shared'

interface VaultTitleCommitOptions {
  name: string
  title: string
  relativePath: string
  flush: () => Promise<boolean>
  isVaultCurrent: () => boolean
  isNoteCurrent: () => boolean
  read: (path: string) => Promise<VaultReadResult>
  rename: (input: VaultRenameInput) => Promise<VaultReadResult>
}

/** 只协调文件提交；页面、焦点和错误提示由调用组件处理。null 表示已取消。 */
export async function commitVaultTitle(options: VaultTitleCommitOptions): Promise<{
  renamed?: VaultReadResult
  isNoteCurrent: boolean
} | null> {
  if (!options.isVaultCurrent() || !options.isNoteCurrent()) return null
  if (!await options.flush() || !options.isVaultCurrent()) return null
  let renamed: VaultReadResult | undefined
  if (options.name !== options.title) {
    const current = await options.read(options.relativePath)
    if (!options.isVaultCurrent()) return null
    renamed = await options.rename({ relativePath: current.relativePath, name: options.name, expectedSha256: current.sha256 })
  }
  // 同 Vault 导航不取消已发起的改名；晚到结果不得更新其他 Vault 或已卸载视图。
  return options.isVaultCurrent() ? { renamed, isNoteCurrent: options.isNoteCurrent() } : null
}
