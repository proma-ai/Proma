/**
 * WSL（Windows Subsystem for Linux）环境检测模块
 *
 * 负责检测 WSL 1/2 环境的可用性：
 * - 检测 WSL 是否安装
 * - 获取 WSL 版本（1 或 2）
 * - 列出已安装的 Linux 发行版
 * - 识别默认发行版
 *
 * 检测命令：wsl.exe --list --verbose
 */

import { execFileAsync } from './async-command'
import iconv from 'iconv-lite'
import type { WslStatus } from '@proma/shared'

const WSL_NOT_READY_ERROR = 'WSL 未就绪，如已安装 Git Bash 可不安装'

function smartDecode(buffer: Buffer): string {
  const isUtf16Le = buffer.length > 2 && (
    (buffer[0] === 0xFF && buffer[1] === 0xFE) ||
    (buffer.length > 4 && buffer[1] === 0x00 && buffer[3] === 0x00)
  )

  if (isUtf16Le) {
    try {
      const decoded = iconv.decode(buffer, 'utf-16le')
      if (decoded.length > 0 && !decoded.includes('\uFFFD')) return decoded
    } catch {
      // 解码失败，继续尝试其他编码
    }
  }

  let output = iconv.decode(buffer, 'utf-8')
  if (!output.includes('\uFFFD')) return output
  output = iconv.decode(buffer, 'gbk')
  if (!output.includes('\uFFFD')) return output
  return iconv.decode(buffer, 'utf-16le')
}

function parseWslListOutput(output: string): {
  version: 1 | 2 | null
  defaultDistro: string | null
  distros: string[]
} {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  const dataLines = lines.filter(
    (line) => !line.includes('NAME') && !line.includes('STATE') && !line.includes('VERSION'),
  )
  let defaultDistro: string | null = null
  const distros: string[] = []
  let primaryVersion: 1 | 2 | null = null

  for (const line of dataLines) {
    const isDefault = line.startsWith('*')
    const cleanLine = line.replace(/^\*\s*/, '').trim()
    const parts = cleanLine.split(/\s+/)
    if (parts.length < 3) continue
    const distroName = parts[0]
    const versionStr = parts[parts.length - 1]
    if (!distroName) continue
    distros.push(distroName)
    if (isDefault) defaultDistro = distroName
    if (isDefault && (versionStr === '1' || versionStr === '2')) {
      primaryVersion = Number.parseInt(versionStr, 10) as 1 | 2
    }
  }

  return { version: primaryVersion, defaultDistro, distros }
}

function createWslNotReadyResult(): WslStatus {
  return { available: false, version: null, defaultDistro: null, distros: [], error: WSL_NOT_READY_ERROR }
}

export async function detectWsl(): Promise<WslStatus> {
  if (process.platform !== 'win32') {
    return { available: false, version: null, defaultDistro: null, distros: [], error: '非 Windows 平台' }
  }

  try {
    const { stdout } = await execFileAsync('wsl.exe', ['--list', '--verbose'], {
      encoding: 'buffer',
      timeout: 10000,
    })
    const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
    const parsed = parseWslListOutput(smartDecode(buffer))
    if (parsed.distros.length === 0) {
      console.warn('[WSL 检测] WSL 已安装但未安装任何发行版')
      return createWslNotReadyResult()
    }
    console.log(
      `[WSL 检测] 找到 WSL ${parsed.version || '未知版本'}: ${parsed.distros.join(', ')} (默认: ${parsed.defaultDistro || '未设置'})`,
    )
    return { available: true, version: parsed.version, defaultDistro: parsed.defaultDistro, distros: parsed.distros, error: null }
  } catch {
    console.warn('[WSL 检测] WSL 未就绪')
    return createWslNotReadyResult()
  }
}
