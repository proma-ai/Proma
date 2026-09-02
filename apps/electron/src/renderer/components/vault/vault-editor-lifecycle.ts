/** A deliberate reopen gets a new editor instance; passive external refreshes do not. */
export function getVaultEditorKey(relativePath: string, reopenVersion = 0): string {
  return `${relativePath}:${reopenVersion}`
}

/**
 * A repeated click on the selected note is normal navigation, not recovery.
 * Only the explicit conflict-recovery action may recreate its editor instance.
 */
export function shouldRemountVaultEditor(
  currentPath: string | null,
  targetPath: string,
  forceReopen: boolean,
): boolean {
  return forceReopen && currentPath === targetPath
}
