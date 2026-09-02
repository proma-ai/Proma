export const VAULT_SIDEBAR_COLLAPSED_WIDTH = 36

export function getVaultSidebarDisplayWidth(expandedWidth: number, collapsed: boolean): number {
  return collapsed ? VAULT_SIDEBAR_COLLAPSED_WIDTH : expandedWidth
}

export function getVaultSidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? '展开 Vault 文件目录' : '收起 Vault 文件目录'
}
