#!/usr/bin/env bun
/**
 * 下载 Cua Driver 到 resources/bin/cua-driver/<platform-arch>/。
 *
 * 版本来源默认取 npm @trycua/cua-driver@latest，再下载同版本的
 * trycua/cua GitHub release 资产。打包脚本会自动调用；开发时也可手动运行：
 * bun run scripts/download-cua-driver.ts --platform=win32 --arch=x64
 */

import AdmZip from 'adm-zip'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

type TargetPlatform = 'win32' | 'darwin' | 'linux'
type TargetArch = 'x64' | 'arm64'

interface NpmLatestPackage {
  version?: string
}

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name?: string
  assets?: GitHubReleaseAsset[]
}

interface LocalVersionFile {
  version?: string
  tag?: string
  installed?: string[]
}

const electronRoot = resolve(import.meta.dir, '..')
const defaultOutDir = join(electronRoot, 'resources', 'bin', 'cua-driver')
const repo = 'trycua/cua'

function normalizePlatform(value: string | undefined): TargetPlatform {
  const raw = value || process.platform
  if (raw === 'win' || raw === 'windows') return 'win32'
  if (raw === 'mac' || raw === 'macos') return 'darwin'
  if (raw === 'win32' || raw === 'darwin' || raw === 'linux') return raw
  throw new Error(`不支持的平台: ${raw}`)
}

function normalizeArch(value: string | undefined): TargetArch | 'all' {
  const raw = value || process.arch
  if (raw === 'x64' || raw === 'arm64' || raw === 'all') return raw
  throw new Error(`不支持的架构: ${raw}`)
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function targetArchs(arch: TargetArch | 'all'): TargetArch[] {
  return arch === 'all' ? ['x64', 'arm64'] : [arch]
}

function platformDirName(platform: TargetPlatform): string {
  return platform === 'win32' ? 'windows' : platform
}

function platformKey(platform: TargetPlatform, arch: TargetArch): string {
  return `${platformDirName(platform)}-${arch}`
}

function executableName(platform: TargetPlatform): string {
  return platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
}

function githubCpu(arch: TargetArch): string {
  return arch === 'arm64' ? 'arm64' : 'x86_64'
}

function releaseAssetName(version: string, platform: TargetPlatform, arch: TargetArch): string {
  if (platform === 'darwin') return `cua-driver-rs-${version}-darwin-universal-binary.tar.gz`
  if (platform === 'linux') return `cua-driver-rs-${version}-linux-${githubCpu(arch)}-binary.tar.gz`
  return `cua-driver-rs-${version}-windows-${githubCpu(arch)}-binary.zip`
}

function downloadWithCommand(command: string, args: string[]): { ok: boolean; error?: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  return result.status === 0
    ? { ok: true }
    : { ok: false, error: result.stderr || result.stdout || result.error?.message || `${command} exit ${result.status}` }
}

function downloadToBuffer(url: string): Buffer {
  const tempDir = mkdtempSync(join(tmpdir(), 'proma-cua-driver-download-'))
  const outPath = join(tempDir, 'download')
  const attempts = process.platform === 'win32'
    ? [
        {
          command: 'powershell.exe',
          args: [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri $args[0] -OutFile $args[1] -Headers @{ 'User-Agent' = 'Proma-Build' }",
            url,
            outPath,
          ],
        },
        {
          command: 'pwsh',
          args: [
            '-NoProfile',
            '-Command',
            "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri $args[0] -OutFile $args[1] -Headers @{ 'User-Agent' = 'Proma-Build' }",
            url,
            outPath,
          ],
        },
        { command: 'curl.exe', args: ['-L', '--fail', '--silent', '--show-error', '--ssl-no-revoke', '-A', 'Proma-Build', '-o', outPath, url] },
      ]
    : [
        { command: 'curl', args: ['-L', '--fail', '--silent', '--show-error', '-A', 'Proma-Build', '-o', outPath, url] },
      ]

  const errors: string[] = []
  try {
    for (const attempt of attempts) {
      const result = downloadWithCommand(attempt.command, attempt.args)
      if (result.ok && existsSync(outPath)) return readFileSync(outPath)
      if (result.error) errors.push(`${attempt.command}: ${result.error.trim()}`)
    }
    throw new Error(`下载失败：${url}\n${errors.join('\n')}`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function fetchLatestCuaDriverVersion(): Promise<string> {
  const buffer = downloadToBuffer('https://registry.npmjs.org/@trycua%2Fcua-driver/latest')
  const pkg = JSON.parse(buffer.toString('utf8')) as NpmLatestPackage
  if (!pkg.version) throw new Error('无法从 npm registry 获取 @trycua/cua-driver 最新版本')
  return pkg.version
}

async function fetchRelease(version: string): Promise<GitHubRelease> {
  const tag = `cua-driver-rs-v${version.replace(/^v/, '')}`
  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`
  return JSON.parse(downloadToBuffer(url).toString('utf8')) as GitHubRelease
}

function readLocalVersion(outDir: string): LocalVersionFile | undefined {
  const path = join(outDir, 'version.json')
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LocalVersionFile
  } catch {
    return undefined
  }
}

function writeLocalVersion(outDir: string, version: string, tag: string | undefined, installed: string[]): void {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version, tag, installed: installed.sort() }, null, 2), 'utf8')
}

function targetExecutablePath(outDir: string, platform: TargetPlatform, arch: TargetArch): string {
  return join(outDir, platformKey(platform, arch), executableName(platform))
}

function hasAllTargets(outDir: string, platform: TargetPlatform, archs: TargetArch[]): boolean {
  return archs.every((arch) => existsSync(targetExecutablePath(outDir, platform, arch)))
}

function findExecutable(dir: string, name: string): string | undefined {
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (basename(entry).toLowerCase() === name.toLowerCase()) return fullPath
    }
  }
  return undefined
}

function installExecutable(sourcePath: string, targetPath: string, platform: TargetPlatform): void {
  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(sourcePath, targetPath)
  if (platform !== 'win32') chmodSync(targetPath, 0o755)
}

function installFromZip(buffer: Buffer, targetPath: string, platform: TargetPlatform): void {
  const zip = new AdmZip(buffer)
  const exeName = executableName(platform)
  const entry = zip.getEntries().find((item) =>
    !item.isDirectory && basename(item.entryName).toLowerCase() === exeName.toLowerCase()
  )
  if (!entry) throw new Error(`压缩包中没有找到 ${exeName}`)
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, entry.getData())
  if (platform !== 'win32') chmodSync(targetPath, 0o755)
}

function installFromTarGz(buffer: Buffer, targetPath: string, platform: TargetPlatform): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'proma-cua-driver-download-'))
  const archivePath = join(tempDir, 'asset.tar.gz')
  const extractDir = join(tempDir, 'extract')
  try {
    mkdirSync(extractDir, { recursive: true })
    writeFileSync(archivePath, buffer)
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir], {
      stdio: 'inherit',
      shell: false,
    })
    if (result.status !== 0) throw new Error('解压 tar.gz 失败，请确认本机有 tar 命令')
    const exe = findExecutable(extractDir, executableName(platform))
    if (!exe) throw new Error(`压缩包中没有找到 ${executableName(platform)}`)
    installExecutable(exe, targetPath, platform)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function installTarget(
  release: GitHubRelease,
  version: string,
  outDir: string,
  platform: TargetPlatform,
  arch: TargetArch,
): Promise<void> {
  const assetName = releaseAssetName(version, platform, arch)
  const asset = release.assets?.find((item) => item.name === assetName)
  if (!asset?.browser_download_url) throw new Error(`Release 中找不到资产: ${assetName}`)

  const targetPath = targetExecutablePath(outDir, platform, arch)
  console.log(`[download:cua-driver] downloading ${platformKey(platform, arch)}: ${asset.browser_download_url}`)
  const buffer = downloadToBuffer(asset.browser_download_url)
  if (assetName.endsWith('.zip')) {
    installFromZip(buffer, targetPath, platform)
  } else {
    installFromTarGz(buffer, targetPath, platform)
  }
  console.log(`[download:cua-driver] installed ${platformKey(platform, arch)}: ${targetPath}`)
}

async function main(): Promise<void> {
  const platform = normalizePlatform(argValue('platform'))
  const archs = targetArchs(normalizeArch(argValue('arch')))
  const outDir = resolve(argValue('out-dir') || defaultOutDir)
  const version = argValue('version') || await fetchLatestCuaDriverVersion()
  const release = await fetchRelease(version)
  const tag = release.tag_name ?? `cua-driver-rs-v${version.replace(/^v/, '')}`
  const local = readLocalVersion(outDir)

  console.log(`[download:cua-driver] repo=${repo}`)
  console.log(`[download:cua-driver] version=${version} tag=${tag}`)
  console.log(`[download:cua-driver] target=${platform}/${archs.join(',')} out=${outDir}`)

  if (local?.version === version && hasAllTargets(outDir, platform, archs)) {
    console.log(`[download:cua-driver] 本地 cua-driver 已是最新版本 ${version}，跳过下载`)
    return
  }

  const installed = new Set(local?.installed ?? [])
  for (const arch of archs) {
    const key = platformKey(platform, arch)
    if (local?.version === version && existsSync(targetExecutablePath(outDir, platform, arch))) {
      console.log(`[download:cua-driver] ${key} 已存在且版本一致，跳过`)
      installed.add(key)
      continue
    }
    await installTarget(release, version, outDir, platform, arch)
    installed.add(key)
  }

  writeLocalVersion(outDir, version, tag, [...installed])
}

main().catch((error) => {
  console.error('[download:cua-driver] 失败:', error instanceof Error ? error.message : error)
  process.exit(1)
})
