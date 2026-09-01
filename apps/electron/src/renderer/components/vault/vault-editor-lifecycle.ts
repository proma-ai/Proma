/** A deliberate reopen gets a new editor instance; passive external refreshes do not. */
export function getVaultEditorKey(relativePath: string, reopenVersion = 0): string {
  return `${relativePath}:${reopenVersion}`
}
