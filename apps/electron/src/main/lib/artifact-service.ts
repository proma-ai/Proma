import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { getConfigDir } from './config-paths'
import type { Artifact } from '@proma/shared'

const ARTIFACTS_DIR = join(getConfigDir(), 'artifacts')

function ensureDir(): void {
  if (!existsSync(ARTIFACTS_DIR)) {
    mkdirSync(ARTIFACTS_DIR, { recursive: true })
  }
}

function artifactPath(id: string): string {
  return join(ARTIFACTS_DIR, `${id}.json`)
}

export function listArtifacts(sessionId: string): Artifact[] {
  ensureDir()
  const artifacts: Artifact[] = []
  try {
    for (const entry of readdirSync(ARTIFACTS_DIR)) {
      if (!entry.endsWith('.json')) continue
      try {
        const raw = readFileSync(join(ARTIFACTS_DIR, entry), 'utf-8')
        const artifact = JSON.parse(raw) as Artifact
        if (artifact.sessionId === sessionId) {
          artifacts.push(artifact)
        }
      } catch {
        // skip corrupted files
      }
    }
  } catch {
    // directory may not exist yet
  }
  return artifacts.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getArtifact(id: string): Artifact | null {
  const path = artifactPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Artifact
  } catch {
    return null
  }
}

export function saveArtifact(artifact: Artifact): void {
  ensureDir()
  writeFileSync(artifactPath(artifact.id), JSON.stringify(artifact, null, 2), 'utf-8')
}

export function deleteArtifact(id: string): void {
  const path = artifactPath(id)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}
