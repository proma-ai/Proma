/**
 * Normalize a file path for cross-platform comparison:
 * backslashes → forward slashes, trailing slashes stripped.
 */
export function normalizePathForCompare(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '')
}
