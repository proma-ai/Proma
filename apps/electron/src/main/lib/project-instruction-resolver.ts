import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const INSTRUCTION_FILE_CANDIDATES = [
  { name: 'AGENTS.md', kind: 'agents' },
  { name: 'AGENTS.MD', kind: 'agents' },
  { name: 'CLAUDE.md', kind: 'claude' },
  { name: 'CLAUDE.MD', kind: 'claude' },
] as const

const MAX_SOURCE_BYTES = 64 * 1024
const MAX_TOTAL_BYTES = 128 * 1024

export type ProjectInstructionKind = (typeof INSTRUCTION_FILE_CANDIDATES)[number]['kind']

export interface ProjectInstructionSource {
  /** Canonical path, used as the auditable source identifier. */
  path: string
  /** Path relative to the selected project root. */
  relativePath: string
  /** The directory subtree to which this source applies. */
  scopeRoot: string
  kind: ProjectInstructionKind
  content: string
  contentHash: string
}

export interface ProjectInstructionDiagnostic {
  path: string
  message: string
}

export interface ProjectInstructionManifest {
  projectRoot: string
  sources: ProjectInstructionSource[]
  diagnostics: ProjectInstructionDiagnostic[]
  totalBytes: number
}

export interface ResolveProjectInstructionsOptions {
  /** The user-authorized project root. Proma never walks above it. */
  projectRoot: string
  /**
   * Resolve the effective instructions for this path. Defaults to the project
   * root, which is appropriate when a session first starts.
   */
  targetPath?: string
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function instructionDirectories(projectRoot: string, targetPath: string): string[] {
  const targetDirectory = existsSync(targetPath) && statSync(targetPath).isFile()
    ? dirname(targetPath)
    : targetPath
  if (!isWithinRoot(projectRoot, targetDirectory)) {
    throw new Error('项目指令目标路径必须位于已授权的项目根目录内')
  }

  const directories = [projectRoot]
  let current = projectRoot
  const segments = relative(projectRoot, targetDirectory).split(/[\\/]/).filter(Boolean)
  for (const segment of segments) {
    current = join(current, segment)
    directories.push(current)
  }
  return directories
}

/**
 * Deterministically resolves project instructions without using Pi's ambient
 * context-file discovery. A directory contributes at most one file, using
 * Pi-compatible candidate priority. Only paths inside the selected project
 * root are eligible.
 */
export function resolveProjectInstructions(options: ResolveProjectInstructionsOptions): ProjectInstructionManifest {
  const requestedRoot = resolve(options.projectRoot)
  if (!existsSync(requestedRoot) || !statSync(requestedRoot).isDirectory()) {
    throw new Error('项目根目录不存在或不是文件夹')
  }
  const requestedTarget = resolve(options.targetPath ?? requestedRoot)
  if (!isWithinRoot(requestedRoot, requestedTarget)) {
    throw new Error('项目指令目标路径必须位于已授权的项目根目录内')
  }
  // macOS may expose the same directory through /var and /private/var. Keep
  // the requested target's relative path, but resolve it under the canonical
  // root so the root-boundary check stays stable across those aliases.
  const projectRoot = realpathSync(requestedRoot)
  const targetPath = resolve(projectRoot, relative(requestedRoot, requestedTarget))

  const sources: ProjectInstructionSource[] = []
  const diagnostics: ProjectInstructionDiagnostic[] = []
  let totalBytes = 0

  for (const directory of instructionDirectories(projectRoot, targetPath)) {
    for (const candidate of INSTRUCTION_FILE_CANDIDATES) {
      const logicalPath = join(directory, candidate.name)
      if (!existsSync(logicalPath)) continue

      try {
        const stat = lstatSync(logicalPath)
        const canonicalPath = stat.isSymbolicLink() ? realpathSync(logicalPath) : logicalPath
        if (!isWithinRoot(projectRoot, canonicalPath)) {
          diagnostics.push({ path: logicalPath, message: '已忽略指向项目根目录外的符号链接指令文件' })
          break
        }
        if (!statSync(canonicalPath).isFile()) {
          diagnostics.push({ path: logicalPath, message: '已忽略非普通文件的项目指令' })
          break
        }
        const size = statSync(canonicalPath).size
        if (size > MAX_SOURCE_BYTES) {
          diagnostics.push({ path: logicalPath, message: `已忽略超过 ${MAX_SOURCE_BYTES / 1024} KB 的项目指令文件` })
          break
        }
        if (totalBytes + size > MAX_TOTAL_BYTES) {
          diagnostics.push({ path: logicalPath, message: `已达到 ${MAX_TOTAL_BYTES / 1024} KB 的项目指令总大小上限` })
          break
        }

        const content = readFileSync(canonicalPath, 'utf8')
        sources.push({
          path: canonicalPath,
          relativePath: relative(projectRoot, logicalPath).split(/[\\/]/).join('/') || candidate.name,
          scopeRoot: relative(projectRoot, directory).split(/[\\/]/).join('/') || '.',
          kind: candidate.kind,
          content,
          contentHash: sha256(content),
        })
        totalBytes += Buffer.byteLength(content, 'utf8')
      } catch (error) {
        diagnostics.push({
          path: logicalPath,
          message: `无法读取项目指令: ${error instanceof Error ? error.message : '未知错误'}`,
        })
      }
      // Preserve Pi's one-candidate-per-directory semantics, including an
      // invalid higher-priority candidate which must not silently expose a
      // lower-priority CLAUDE.md instead.
      break
    }
  }

  return { projectRoot, sources, diagnostics, totalBytes }
}
