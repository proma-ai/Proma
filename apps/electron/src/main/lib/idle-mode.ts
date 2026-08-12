import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppSettings } from '../../types'

const execAsync = promisify(exec)

/**
 * 挂机模式（息屏 + 防休眠）核心逻辑
 *
 * 开启后：
 * 1. 通过系统命令立即熄灭显示器（macOS pmset displaysleepnow /
 *    Windows SendMessage SC_MONITORPOWER / Linux xset dpms force off）；
 * 2. 通过 powerSaveBlocker('prevent-app-suspension') 阻止系统休眠（允许息屏），
 *    保证挂机任务持续运行；移动鼠标或按任意键即可唤醒屏幕。
 *
 * 本文件保持纯逻辑、不依赖 electron，便于单元测试；
 * electron 接线见 idle-mode-electron.ts。
 */

/** 构建 Windows 关屏命令：用 -EncodedCommand 传 Base64 编码的 PS 脚本，
 * 绕开 cmd.exe/CommandLineToArgvW 对嵌套双引号的剥离（直接拼 -Command 会
 * 导致 Add-Type 收到非法 C#，关屏静默失效）。 */
export function buildWindowsDisplayOffCommand(): string {
  const script = [
    'Add-Type -TypeDefinition \'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class MonitorOff { [DllImport("user32.dll")] public static extern int SendMessage(IntPtr hWnd, int msg, int wParam, int lParam); }',
    '\';',
    '[MonitorOff]::SendMessage([IntPtr]0xffff, 0x0112, 0xF170, 2)',
  ].join('')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return `powershell -NoProfile -EncodedCommand ${encoded}`
}

/** 各平台立即熄灭显示器的命令；不支持返回 null（尽力而为，失败仅记录） */
export function buildDisplayOffCommand(platform: NodeJS.Platform): string | null {
  switch (platform) {
    case 'darwin':
      return 'pmset displaysleepnow'
    case 'win32':
      return buildWindowsDisplayOffCommand()
    case 'linux':
      return 'xset dpms force off'
    default:
      return null
  }
}

export type SleepBlockerType = 'prevent-app-suspension'

export interface SleepBlockerAdapter {
  start(type: SleepBlockerType): number
  stop(id: number): void
  isStarted(id: number): boolean
}

export interface DisplayOffRunner {
  run(platform: NodeJS.Platform): Promise<void>
}

export const defaultDisplayOffRunner: DisplayOffRunner = {
  async run(platform: NodeJS.Platform): Promise<void> {
    const command = buildDisplayOffCommand(platform)
    if (command === null) {
      console.warn(`[挂机模式] 当前平台 ${platform} 暂不支持自动息屏命令，仅启用防休眠`)
      return
    }
    await execAsync(command)
  },
}

export function shouldEnableIdleMode(settings: Pick<AppSettings, 'idleMode'>): boolean {
  return settings.idleMode?.enabled === true
}

export class IdleModeManager {
  private activeBlockerId: number | null = null
  /** 每次 stop 自增，使在途的息屏命令完成后不再产生误导反馈 */
  private generation = 0

  constructor(
    private readonly adapter: SleepBlockerAdapter,
    private readonly displayOff: DisplayOffRunner = defaultDisplayOffRunner,
  ) {}

  sync(settings: Pick<AppSettings, 'idleMode'>): void {
    if (shouldEnableIdleMode(settings)) {
      this.start()
      return
    }

    this.stop()
  }

  stop(): void {
    this.generation += 1
    if (this.activeBlockerId === null) return

    const blockerId = this.activeBlockerId
    this.activeBlockerId = null

    if (this.adapter.isStarted(blockerId)) {
      this.adapter.stop(blockerId)
      console.log('[挂机模式] 已关闭，恢复系统休眠策略')
    }
  }

  private start(): void {
    if (this.activeBlockerId !== null) {
      if (this.adapter.isStarted(this.activeBlockerId)) return
      this.activeBlockerId = null
    }

    const generation = this.generation
    this.activeBlockerId = this.adapter.start('prevent-app-suspension')
    console.log('[挂机模式] 已启用：阻止系统休眠（允许息屏），正在熄灭显示器…')
    void this.displayOff
      .run(process.platform)
      .then(() => {
        // 期间已关闭：放弃反馈，避免误导
        if (this.generation !== generation) return
        console.log('[挂机模式] 显示器已熄灭（移动鼠标或按任意键可唤醒）')
      })
      .catch((error) => {
        if (this.generation !== generation) return
        console.error('[挂机模式] 熄灭显示器失败（防休眠仍生效）:', error)
      })
  }
}
