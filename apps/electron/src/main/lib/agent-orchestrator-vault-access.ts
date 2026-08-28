import { resolve } from 'node:path'
import { normalizePathForCompare } from '@proma/shared'

function normalizeRuntimeDirectoryPath(directory: string): string {
  const normalized = normalizePathForCompare(resolve(directory))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Vault roots discovered from Obsidian are ambient local-file permissions.
 * Deduplicate by canonical comparable path so native Read and Write receive the
 * same stable root set as Browser and the attached-directories prompt.
 */
export function resolveRuntimeAdditionalDirectories(
  directories: string[],
  vaultRoots: string[],
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const directory of [...directories, ...vaultRoots]) {
    const trimmed = directory.trim()
    if (!trimmed) continue
    const normalized = normalizeRuntimeDirectoryPath(trimmed)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(trimmed)
  }
  return result
}
