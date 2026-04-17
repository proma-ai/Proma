/**
 * 跨平台清理残留的 electronmon / electron 进程
 * 替代 pkill（Windows 不支持）
 */
import { execSync } from 'child_process'

const isWin = process.platform === 'win32'

function kill(pattern: string): void {
  try {
    if (isWin) {
      // Windows: taskkill 按进程名
      execSync(`taskkill /F /IM ${pattern} 2>nul`, { stdio: 'ignore' })
    } else {
      // Unix: pkill 按模式匹配
      execSync(`pkill -f '${pattern}' 2>/dev/null`, { stdio: 'ignore' })
    }
  } catch {
    // 没有匹配进程，忽略
  }
}

kill(isWin ? 'electronmon.exe' : 'electronmon \\.')
kill(isWin ? 'electron.exe' : 'electron.*dist/main')
