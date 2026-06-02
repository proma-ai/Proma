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

import { execSync } from 'node:child_process'
import iconv from 'iconv-lite'
import type { WslStatus } from '@proma/shared'

/** WSL 不可用时返回的统一错误提示 */
const WSL_NOT_READY_ERROR = 'WSL 未就绪，如已安装 Git Bash 可不安装'

/**
 * 智能解码 Buffer：尝试 UTF-16 LE → UTF-8 → GBK
 * Windows 控制台命令输出可能是 UTF-16 LE 编码
 */
function smartDecode(buffer: Buffer): string {
  // 检测 UTF-16 LE BOM (FF FE) 或特征（大量 00 字节间隔）
  const isUtf16Le = buffer.length > 2 &&
    ((buffer[0] === 0xFF && buffer[1] === 0xFE) ||
     (buffer.length > 4 && buffer[1] === 0x00 && buffer[3] === 0x00))

  if (isUtf16Le) {
    try {
      const decoded = iconv.decode(buffer, 'utf-16le')
      if (decoded.length > 0 && !decoded.includes('')) {
        return decoded
      }
    } catch {
      // 解码失败，继续尝试其他编码
    }
  }

  // 尝试 UTF-8
  let output = iconv.decode(buffer, 'utf-8')
  // 如果包含替换字符（U+FFFD），说明不是 UTF-8
  if (!output.includes('')) {
    return output
  }

  // 回退 GBK
  output = iconv.decode(buffer, 'gbk')
  if (!output.includes('')) {
    return output
  }

  // 最后尝试 UTF-16 LE（无 BOM 的情况）
  return iconv.decode(buffer, 'utf-16le')
}

/**
 * 解析 WSL 发行版列表输出
 *
 * wsl.exe --list --verbose 输出示例：
 * ```
 *   NAME            STATE           VERSION
 * * Ubuntu          Running         2
 *   Debian          Stopped         1
 * ```
 *
 * @param output - wsl.exe 命令输出
 * @returns 解析结果 { version, defaultDistro, distros }
 */
function parseWslListOutput(output: string): {
  version: 1 | 2 | null
  defaultDistro: string | null
  distros: string[]
} {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)

  // 跳过标题行（包含 "NAME", "STATE", "VERSION"）
  const dataLines = lines.filter(
    (line) =>
      !line.includes('NAME') &&
      !line.includes('STATE') &&
      !line.includes('VERSION'),
  )

  let defaultDistro: string | null = null
  const distros: string[] = []
  let primaryVersion: 1 | 2 | null = null

  for (const line of dataLines) {
    // 检查是否为默认发行版（以 * 开头）
    const isDefault = line.startsWith('*')
    const cleanLine = line.replace(/^\*\s*/, '').trim()

    // 解析发行版名称和版本（格式：NAME STATE VERSION）
    const parts = cleanLine.split(/\s+/)
    if (parts.length < 3) continue

    const distroName = parts[0]
    const versionStr = parts[parts.length - 1] // 最后一个字段是 VERSION

    if (distroName) {
      distros.push(distroName)

      if (isDefault) {
        defaultDistro = distroName
      }

      // 提取默认发行版的版本号
      if (isDefault && (versionStr === '1' || versionStr === '2')) {
        primaryVersion = Number.parseInt(versionStr, 10) as 1 | 2
      }
    }
  }

  return {
    version: primaryVersion,
    defaultDistro,
    distros,
  }
}

/** 构建 WSL 不可用的返回结果 */
function createWslNotReadyResult(): WslStatus {
  return {
    available: false,
    version: null,
    defaultDistro: null,
    distros: [],
    error: WSL_NOT_READY_ERROR,
  }
}

/**
 * 检测 WSL 环境
 *
 * 通过执行 wsl.exe --list --verbose 获取 WSL 状态。
 * Windows 10 版本 1903 及以上支持 WSL 2。
 *
 * @returns WSL 状态
 */
export async function detectWsl(): Promise<WslStatus> {
  // 仅在 Windows 平台执行
  if (process.platform !== 'win32') {
    return {
      available: false,
      version: null,
      defaultDistro: null,
      distros: [],
      error: '非 Windows 平台',
    }
  }

  try {
    // 执行 wsl.exe --list --verbose
    // 不指定 encoding，接收原始 Buffer，然后用 smartDecode 做编码转换
    const buffer = execSync('wsl.exe --list --verbose', {
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as Buffer

    const output = smartDecode(buffer)
    const parsed = parseWslListOutput(output)

    // 检查是否有可用的发行版
    if (parsed.distros.length === 0) {
      console.warn('[WSL 检测] WSL 已安装但未安装任何发行版')
      return createWslNotReadyResult()
    }

    console.log(
      `[WSL 检测] 找到 WSL ${parsed.version || '未知版本'}: ${parsed.distros.join(', ')} (默认: ${parsed.defaultDistro || '未设置'})`,
    )

    return {
      available: true,
      version: parsed.version,
      defaultDistro: parsed.defaultDistro,
      distros: parsed.distros,
      error: null,
    }
  } catch (error) {
    // 所有异常场景统一返回 WSL 未就绪
    console.warn('[WSL 检测] WSL 未就绪')
    return createWslNotReadyResult()
  }
}
