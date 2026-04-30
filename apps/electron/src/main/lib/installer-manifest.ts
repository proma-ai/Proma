/**
 * Installer Manifest 客户端
 *
 * 从 proma-api 的 /api/v1/installers/manifest 接口拉取第三方安装包清单，
 * 带 5 分钟缓存和内置 fallback——断网或接口不可用时至少能拿到官方上游 URL。
 */

import type { InstallerManifest, InstallerSource } from '@proma/shared'

const PROMA_API_BASE = 'https://api.proma.cool'
const MANIFEST_URL = `${PROMA_API_BASE}/api/v1/installers/manifest`
const CACHE_TTL_MS = 5 * 60 * 1000

interface ManifestCache {
  data: InstallerManifest
  timestamp: number
}

let cache: ManifestCache | null = null

/**
 * 内置 fallback manifest。
 *
 * 断网或 API 不可达时使用，此时没有 OSS 签名 URL，直接让客户端走 fallbackUrl
 * （官方上游）。sha256 留空，下载器在 sha256 为空时跳过校验并打 warning。
 */
const BUILTIN_FALLBACK: InstallerManifest = {
  installers: [
    {
      id: 'git-for-windows',
      platform: 'win32',
      arch: 'x64',
      version: '2.47.1',
      downloadUrl: '',
      fallbackUrl:
        'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe',
      sha256: '',
      sizeBytes: 66000000,
      filename: 'Git-2.47.1-64-bit.exe',
    },
    {
      id: 'git-for-windows',
      platform: 'win32',
      arch: 'arm64',
      version: '2.47.1',
      downloadUrl: '',
      fallbackUrl:
        'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-arm64.exe',
      sha256: '',
      sizeBytes: 66000000,
      filename: 'Git-2.47.1-arm64.exe',
    },
    {
      id: 'nodejs',
      platform: 'win32',
      arch: 'x64',
      version: '22.13.1',
      downloadUrl: '',
      fallbackUrl: 'https://nodejs.org/dist/v22.13.1/node-v22.13.1-x64.msi',
      sha256: '',
      sizeBytes: 28000000,
      filename: 'node-v22.13.1-x64.msi',
    },
    {
      id: 'nodejs',
      platform: 'win32',
      arch: 'arm64',
      version: '22.13.1',
      downloadUrl: '',
      fallbackUrl: 'https://nodejs.org/dist/v22.13.1/node-v22.13.1-arm64.msi',
      sha256: '',
      sizeBytes: 28000000,
      filename: 'node-v22.13.1-arm64.msi',
    },
  ],
}

/**
 * 拉取安装包清单（优先远程，失败回退内置）
 */
export async function fetchInstallerManifest(force = false): Promise<InstallerManifest> {
  if (!force && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data
  }

  try {
    const response = await fetch(MANIFEST_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proma-Desktop-App',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as InstallerManifest
    if (!data || !Array.isArray(data.installers)) {
      throw new Error('Manifest format invalid')
    }

    cache = { data, timestamp: Date.now() }
    console.log(`[Installer Manifest] 远程清单获取成功，共 ${data.installers.length} 项`)
    return data
  } catch (error) {
    console.warn(
      `[Installer Manifest] 远程清单获取失败，降级到内置 fallback:`,
      error,
    )
    // 不缓存 fallback，下一次仍然先试远程
    return BUILTIN_FALLBACK
  }
}

/**
 * 从清单中挑出匹配指定 (id, arch) 的条目
 */
export function findInstallerSource(
  manifest: InstallerManifest,
  id: string,
  arch: 'x64' | 'arm64',
): InstallerSource | undefined {
  return manifest.installers.find((s) => s.id === id && s.arch === arch)
}
