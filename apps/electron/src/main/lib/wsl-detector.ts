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
    // 不指定 encoding，接收原始 Buffer，然后用 iconv-lite 做编码转换
    const buffer = execSync('wsl.exe --list --verbose', {
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as Buffer

    // 先尝试 UTF-8 解码；若结果含替换字符（U+FFFD），说明原始数据非 UTF-8，回退 GBK
    let output = iconv.decode(buffer, 'utf-8')
    if (output.includes('�')) {
      output = iconv.decode(buffer, 'gbk')
    }

    const parsed = parseWslListOutput(output)

    // 检查是否有可用的发行版
    if (parsed.distros.length === 0) {
      console.warn('[WSL 检测] WSL 已安装但未安装任何发行版')
      return {
        available: false,
        version: null,
        defaultDistro: null,
        distros: [],
        error: 'WSL 已安装但未安装任何 Linux 发行版',
      }
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
    const errorMessage = error instanceof Error ? error.message : String(error)

    // 检测乱码（替换字符或不可见控制字符）— 无法确定具体原因，报告编码异常
    const hasGarbledText = errorMessage.includes('�') || /[\x00-\x08\x0b-\x0c\x0e-\x1f]/.test(errorMessage)
    if (hasGarbledText) {
      console.warn('[WSL 检测] 检测到编码乱码，无法解析命令输出')
      return {
        available: false,
        version: null,
        defaultDistro: null,
        distros: [],
        error: 'WSL 检测失败: 命令输出编码异常',
      }
    }

    // 判断是否为 WSL 未安装的错误
    if (
      errorMessage.includes('wsl.exe') &&
      (errorMessage.includes('not found') ||
        errorMessage.includes('not recognized'))
    ) {
      console.warn('[WSL 检测] WSL 未安装')
      return {
        available: false,
        version: null,
        defaultDistro: null,
        distros: [],
        error: 'WSL 未安装',
      }
    }

    // 其他错误
    console.warn('[WSL 检测] 检测失败:', errorMessage)
    return {
      available: false,
      version: null,
      defaultDistro: null,
      distros: [],
      error: `WSL 检测失败: ${errorMessage}`,
    }
  }
}
