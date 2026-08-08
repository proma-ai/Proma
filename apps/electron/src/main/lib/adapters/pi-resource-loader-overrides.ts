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

export function createPromaManagedResourceLoaderOptions() {
  return {
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    // An explicit empty source prevents Pi from discovering APPEND_SYSTEM.md.
    appendSystemPrompt: [],
  }
}

/**
 * Pi still owns the final <project_context> formatting. Proma supplies this
 * override only after validating the file paths against the selected project
 * root, so no ambient context-file discovery is re-enabled.
 */
export function createPromaProjectInstructionFilesOverride(files: PromaProjectInstructionFile[]) {
  const agentsFiles = files.map(({ path, content }) => ({ path, content }))
  return () => ({ agentsFiles })
}
