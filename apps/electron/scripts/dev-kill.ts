/**
 * 跨平台清理残留的 electronmon / electron 进程
 * 替代 pkill（Windows 不支持）
 *
 * 传入 --vite 时，额外清理占用 Vite 端口（5173）的残留进程。
 * 该清理仅应在 concurrently 拉起 dev:vite 之前跑一次（顶层 dev 脚本），
 * 不要在与 dev:vite 并发的 dev:electron 内部跑，否则会误杀本次刚启动的 vite。
 */
import { execSync } from 'child_process'

const isWin = process.platform === 'win32'
const killVite = process.argv.includes('--vite')
/** 与 vite.config.ts 的 server.port 保持一致 */
const VITE_PORT = 5173

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

/**
 * 清理占用 Vite 端口的残留进程。
 * vite.config.ts 设了 strictPort，端口被占就会直接报错退出，
 * 残留的孤儿 vite（如已注销 worktree 留下的）会反复阻塞 dev。
 * 仅当监听进程是 vite/node 时才杀，避免误伤占用同端口的其他服务。
 */
function killStaleVite(port: number): void {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const pids = new Set<string>()
      for (const line of out.split('\n')) {
        const m = line.trim().match(/(\d+)\s*$/)
        if (m) pids.add(m[1]!)
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore' }) } catch { /* 已退出 */ }
      }
    } else {
      const out = execSync(`lsof -ti:${port} 2>/dev/null`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      for (const pid of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
        try {
          const cmd = execSync(`ps -p ${pid} -o command=`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          })
          // 仅杀命令行包含 vite 的进程（dev server 由 node 运行 vite，命令行必含 vite 脚本路径），
          // 不匹配裸 node，避免误伤偶然占用该端口的其他 node 服务
          if (/vite/.test(cmd)) {
            execSync(`kill ${pid} 2>/dev/null`, { stdio: 'ignore' })
          }
        } catch {
          // 进程已退出或无权限，忽略
        }
      }
    }
  } catch {
    // 端口未被占用或命令不可用，忽略
  }
}

kill(isWin ? 'electronmon.exe' : 'electronmon \\.')
kill(isWin ? 'electron.exe' : 'electron.*dist/main')
if (killVite) killStaleVite(VITE_PORT)
