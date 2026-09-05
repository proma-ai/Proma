/**
 * Proma-managed Pi mode deliberately opts out of Pi's ambient local resources.
 *
 * Proma supplies the system prompt, Skills and product tools explicitly. Do not
 * let a user project's ancestor context files, extensions, or APPEND_SYSTEM.md
 * silently alter that managed runtime. Inline extension factories remain
 * available: Pi loads them independently of `noExtensions`.
 */
export interface PromaProjectInstructionFile {
  path: string
  content: string
}

export function createPromaManagedResourceLoaderOptions(options?: { additionalExtensionPaths?: string[] }) {
  return {
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    // An explicit empty source prevents Pi from discovering APPEND_SYSTEM.md.
    appendSystemPrompt: [],
    // Whitelisted extensions only: Pi still loads explicit paths when
    // `noExtensions` is true (resource-loader CLI/temporary path), so the
    // managed runtime stays free of ambient user/project settings discovery.
    ...(options?.additionalExtensionPaths?.length
      ? { additionalExtensionPaths: options.additionalExtensionPaths }
      : {}),
  }
}

/**
 * Pi still owns the final <project_context> formatting. Proma supplies this override only after validating explicit Proma-managed
 * workspace paths and user-authorized project paths, so no ambient context-file
 * discovery is re-enabled.
 */
export function createPromaProjectInstructionFilesOverride(files: PromaProjectInstructionFile[]) {
  const agentsFiles = files.map(({ path, content }) => ({ path, content }))
  return () => ({ agentsFiles })
}


/** Keep managed workspace rules ahead of user-project rules in Pi project context. */
export function combinePromaInstructionFiles(
  workspaceFile: PromaProjectInstructionFile | undefined,
  projectFiles: PromaProjectInstructionFile[],
): PromaProjectInstructionFile[] {
  return workspaceFile ? [workspaceFile, ...projectFiles] : projectFiles
}
