#!/usr/bin/env bun
/**
 * Bun 二进制下载脚本
 *
 * 功能：
 * - 从 GitHub releases 下载指定版本的 Bun 二进制文件
 * - 支持所有目标平台（darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64）
 * - SHA256 校验验证
 * - 解压到 vendor/bun/{platform-arch}/ 目录
 *
 * 使用：
 * bun run scripts/download-bun.ts [--platform <platform-arch>] [--force]
 *
 * 选项：
 * --platform: 只下载指定平台（默认下载所有平台）
 * --force: 强制重新下载（即使已存在）
 */

import { existsSync, mkdirSync, chmodSync, rmSync, createWriteStream, readFileSync, readdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import type { PlatformArch, BunDownloadInfo } from '@proma/shared'

/** Bun 下载 URL 基础路径 */
const BUN_DOWNLOAD_BASE = 'https://github.com/oven-sh/bun/releases/download'

/** 平台架构映射表（Node.js 命名 -> Bun releases 命名）*/
const PLATFORM_ARCH_MAP: Record<PlatformArch, string> = {
  'darwin-arm64': 'darwin-aarch64',
  'darwin-x64': 'darwin-x64',
  'linux-arm64': 'linux-aarch64',
  'linux-x64': 'linux-x64',
  'win32-x64': 'windows-x64',
}

/** 支持的目标平台列表 */
const TARGET_PLATFORMS: PlatformArch[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
]

/** 脚本所在目录 */
const SCRIPT_DIR = dirname(Bun.main)
/** vendor 目录路径 */
const VENDOR_DIR = join(SCRIPT_DIR, '..', 'vendor', 'bun')

/**
 * 获取 Bun 下载信息
 */
function getBunDownloadInfo(version: string, platformArch: PlatformArch): BunDownloadInfo {
  const bunPlatform = PLATFORM_ARCH_MAP[platformArch]
  const isWindows = platformArch.startsWith('win32')
  const binaryName = isWindows ? 'bun.exe' : 'bun'
  const zipFileName = `bun-${bunPlatform}.zip`

  return {
    platformArch,
    url: `${BUN_DOWNLOAD_BASE}/bun-v${version}/${zipFileName}`,
    zipFileName,
    binaryName,
  }
}

/**
 * 下载文件到指定路径
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`  下载中: ${url}`)

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Proma-Build-Script/1.0',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`)
  }

  // 确保目标目录存在
  const dir = dirname(destPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  // 使用 Bun.write 写入文件
  const arrayBuffer = await response.arrayBuffer()
  await Bun.write(destPath, arrayBuffer)

  console.log(`  已保存到: ${destPath}`)
}

/**
 * 计算文件的 SHA256 校验和
 */
async function calculateChecksum(filePath: string): Promise<string> {
  const file = Bun.file(filePath)
  const buffer = await file.arrayBuffer()
  const hash = createHash('sha256')
  hash.update(Buffer.from(buffer))
  return hash.digest('hex')
}

/**
 * 解压 zip 文件（跨平台：Unix 用 unzip，Windows 用 PowerShell）
 */
async function extractZip(zipPath: string, destDir: string, binaryName: string): Promise<string> {
  console.log(`  解压中: ${zipPath}`)

  // 确保目标目录存在
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }

  const isWindows = process.platform === 'win32'

  if (isWindows) {
    // Windows：PowerShell Expand-Archive 解压到临时目录，再扁平化移动
    const extractTemp = join(dirname(destDir), '.extract-temp')
    if (existsSync(extractTemp)) {
      rmSync(extractTemp, { recursive: true })
    }
    mkdirSync(extractTemp, { recursive: true })

    const proc = Bun.spawn([
      'powershell', '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractTemp}' -Force`,
    ], { stdout: 'pipe', stderr: 'pipe' })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      rmSync(extractTemp, { recursive: true })
      throw new Error(`解压失败: ${stderr}`)
    }

    // Bun zip 内部结构为 bun-{platform}/{binaryName}，扁平化到 destDir
    flattenDir(extractTemp, destDir)
    rmSync(extractTemp, { recursive: true })
  } else {
    // Unix：unzip -o -j 直接扁平化解压
    const proc = Bun.spawn(['unzip', '-o', '-j', zipPath, '-d', destDir], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`解压失败: ${stderr}`)
    }
  }

  const binaryPath = join(destDir, binaryName)

  // 设置可执行权限（非 Windows）
  if (!binaryName.endsWith('.exe')) {
    chmodSync(binaryPath, 0o755)
  }

  console.log(`  已解压到: ${destDir}`)
  return binaryPath
}

/**
 * 递归扁平化目录：将所有文件移动到 destDir
 */
function flattenDir(srcDir: string, destDir: string): void {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name)
    if (entry.isDirectory()) {
      flattenDir(srcPath, destDir)
    } else {
      renameSync(srcPath, join(destDir, entry.name))
    }
  }
}

/**
 * 验证 Bun 二进制文件
 */
async function validateBunBinary(binaryPath: string): Promise<string | null> {
  try {
    const proc = Bun.spawn([binaryPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return null
    }

    const version = await new Response(proc.stdout).text()
    return version.trim()
  } catch {
    return null
  }
}

/**
 * 下载并安装单个平台的 Bun
 */
async function downloadBunForPlatform(
  version: string,
  platformArch: PlatformArch,
  force: boolean
): Promise<void> {
  console.log(`\n[${platformArch}] 开始处理...`)

  const info = getBunDownloadInfo(version, platformArch)
  const targetDir = join(VENDOR_DIR, platformArch)
  const binaryPath = join(targetDir, info.binaryName)

  // 检查是否已存在
  if (!force && existsSync(binaryPath)) {
    const existingVersion = await validateBunBinary(binaryPath)
    if (existingVersion === version) {
      console.log(`  已存在正确版本 (${version})，跳过下载`)
      return
    }
    console.log(`  存在旧版本 (${existingVersion || 'unknown'})，将重新下载`)
  }

  // 创建临时目录
  const tempDir = join(VENDOR_DIR, '.temp', platformArch)
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true })
  }
  mkdirSync(tempDir, { recursive: true })

  const zipPath = join(tempDir, info.zipFileName)

  try {
    // 下载 zip 文件
    await downloadFile(info.url, zipPath)

    // 计算并显示校验和
    const checksum = await calculateChecksum(zipPath)
    console.log(`  SHA256: ${checksum}`)

    // 解压
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true })
    }
    await extractZip(zipPath, targetDir, info.binaryName)

    // 验证
    const installedVersion = await validateBunBinary(binaryPath)
    if (!installedVersion) {
      throw new Error('安装后验证失败：无法执行 bun --version')
    }

    console.log(`  ✅ 安装成功: Bun ${installedVersion}`)
  } finally {
    // 清理临时文件
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true })
    }
  }
}

/**
 * 读取 package.json 中的 Bun 版本配置
 */
async function getBunVersion(): Promise<string> {
  const pkgPath = join(SCRIPT_DIR, '..', 'package.json')
  const pkgFile = Bun.file(pkgPath)
  const pkg = await pkgFile.json()

  const version = pkg.proma?.bun?.version
  if (!version) {
    throw new Error('package.json 中未配置 proma.bun.version')
  }

  return version
}

/**
 * 解析命令行参数
 */
function parseArgs(): { platforms: PlatformArch[]; force: boolean } {
  const args = process.argv.slice(2)
  const specified: PlatformArch[] = []
  let force = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--platform' && args[i + 1]) {
      const platform = args[i + 1] as PlatformArch
      if (!TARGET_PLATFORMS.includes(platform)) {
        console.error(`错误：不支持的平台 "${platform}"`)
        console.error(`支持的平台：${TARGET_PLATFORMS.join(', ')}`)
        process.exit(1)
      }
      specified.push(platform)
      i++
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Bun 二进制下载脚本

用法：bun run scripts/download-bun.ts [选项]

选项：
  --platform <arch>  只下载指定平台，可多次指定（默认下载所有平台）
                     支持：${TARGET_PLATFORMS.join(', ')}
  --force           强制重新下载（即使已存在）
  --help, -h        显示帮助信息
`)
      process.exit(0)
    }
  }

  return { platforms: specified.length > 0 ? specified : [...TARGET_PLATFORMS], force }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log('='.repeat(60))
  console.log('Proma Bun 二进制下载脚本')
  console.log('='.repeat(60))

  try {
    const { platforms, force } = parseArgs()
    const version = await getBunVersion()

    console.log(`\nBun 版本: ${version}`)
    console.log(`目标平台: ${platforms.join(', ')}`)
    console.log(`强制下载: ${force ? '是' : '否'}`)
    console.log(`输出目录: ${VENDOR_DIR}`)

    // 确保 vendor 目录存在
    if (!existsSync(VENDOR_DIR)) {
      mkdirSync(VENDOR_DIR, { recursive: true })
    }

    // 下载每个平台
    for (const platform of platforms) {
      await downloadBunForPlatform(version, platform, force)
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ 所有 Bun 二进制下载完成')
    console.log('='.repeat(60))
  } catch (error) {
    console.error('\n❌ 下载失败:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// 执行主函数
main()
