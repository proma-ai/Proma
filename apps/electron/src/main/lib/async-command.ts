import { execFile } from 'node:child_process'
import type { ExecFileOptions } from 'node:child_process'

export interface AsyncCommandOptions {
  cwd?: string
  encoding?: BufferEncoding | 'buffer'
  env?: NodeJS.ProcessEnv
  timeout?: number
}

export interface AsyncCommandResult {
  stdout: string | Buffer
  stderr: string | Buffer
}

/**
 * 异步执行外部命令，避免在 Electron 主进程中阻塞事件循环。
 * Windows 下隐藏探测命令窗口，避免启动时闪现控制台。
 */
export function execFileAsync(
  file: string,
  args: readonly string[] = [],
  options: AsyncCommandOptions = {},
): Promise<AsyncCommandResult> {
  return new Promise((resolve, reject) => {
    const execOptions: ExecFileOptions = {
      ...options,
      windowsHide: true,
    }

    execFile(file, [...args], execOptions, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}
