export function getVaultEditorKey(relativePath: string, _contentHash?: string): string {
  return relativePath
}

export function shouldAdoptVaultReadContent(localDraft: string, previousReadContent: string): boolean {
  return localDraft === previousReadContent
}
