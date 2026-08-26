import { chmodSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bun 安装 node-pty 预构建产物时可能丢失 spawn-helper 的执行位。
 * node-pty 会通过这个 helper 创建 Unix PTY；缺失执行位时只会抛出
 * "posix_spawnp failed"，使所有终端都无法启动。
 */
const nodePtyRoot = join(import.meta.dir, '..', '..', '..', 'node_modules', 'node-pty')
const helperPaths = [
  join(nodePtyRoot, 'build', 'Release', 'spawn-helper'),
  join(nodePtyRoot, 'build', 'Debug', 'spawn-helper'),
  join(nodePtyRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
]

for (const helperPath of helperPaths) {
  if (!existsSync(helperPath)) continue
  const mode = statSync(helperPath).mode
  if ((mode & 0o100) !== 0) continue
  chmodSync(helperPath, mode | 0o100)
  console.log(`[node-pty] 已恢复 spawn-helper 执行权限：${helperPath}`)
}
