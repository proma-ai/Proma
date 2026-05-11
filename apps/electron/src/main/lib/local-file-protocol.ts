/**
 * Token-gated local file protocol support for inline previews.
 *
 * The renderer never receives raw proma-file:// absolute paths. Main process
 * code registers an already-authorized file or directory and gets back an
 * opaque URL that the protocol handler can resolve.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net } from 'electron'

type RegisteredEntry = {
  root: string
  isDirectory: boolean
  createdAt: number
}

const registeredEntries = new Map<string, RegisteredEntry>()
const ENTRY_TTL_MS = 60 * 60 * 1000
const MAX_ENTRIES = 500

function pruneEntries(): void {
  const now = Date.now()
  for (const [token, entry] of registeredEntries) {
    if (now - entry.createdAt > ENTRY_TTL_MS) {
      registeredEntries.delete(token)
    }
  }

  while (registeredEntries.size > MAX_ENTRIES) {
    const oldest = registeredEntries.keys().next().value
    if (!oldest) break
    registeredEntries.delete(oldest)
  }
}

function realpathExisting(path: string): string {
  const resolved = realpathSync(resolve(path))
  if (!existsSync(resolved)) {
    throw new Error(`文件不存在: ${path}`)
  }
  return resolved
}

function isInsideDirectory(target: string, root: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}

function registerEntry(path: string, isDirectory: boolean): string {
  pruneEntries()
  const root = realpathExisting(path)
  const st = statSync(root)
  if (isDirectory && !st.isDirectory()) {
    throw new Error(`不是目录: ${path}`)
  }
  if (!isDirectory && !st.isFile()) {
    throw new Error(`不是文件: ${path}`)
  }

  const token = randomUUID()
  registeredEntries.set(token, { root, isDirectory, createdAt: Date.now() })
  return `proma-file://${token}`
}

export function registerPromaFilePath(path: string): string {
  return registerEntry(path, false)
}

export function registerPromaDirectoryPath(path: string): string {
  return registerEntry(path, true)
}

export function handlePromaFileRequest(request: Request): Promise<Response> | Response {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const token = url.hostname
  const entry = registeredEntries.get(token)
  if (!entry) {
    return new Response('Not Found', { status: 404 })
  }

  let target = entry.root
  if (entry.isDirectory) {
    const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    try {
      target = realpathSync(resolve(entry.root, relativePath))
    } catch {
      return new Response('Not Found', { status: 404 })
    }
    if (!isInsideDirectory(target, entry.root)) {
      return new Response('Forbidden', { status: 403 })
    }
  } else if (url.pathname && url.pathname !== '/') {
    return new Response('Not Found', { status: 404 })
  }

  return net.fetch(pathToFileURL(target).toString())
}
