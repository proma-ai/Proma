import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const runtimeLibDir = import.meta.dir
const startupDetectionFiles = [
  'runtime-init.ts',
  'git-bash-detector.ts',
  'wsl-detector.ts',
  'git-detector.ts',
  'node-detector.ts',
  'windows-env.ts',
]

describe('Windows 异步启动探测', () => {
  test('Given 启动探测模块 When 检查外部命令调用 Then 不使用同步 child_process API', async () => {
    const sources = await Promise.all(startupDetectionFiles.map(async (file) => ({
      file,
      source: await readFile(join(runtimeLibDir, file), 'utf-8'),
    })))

    for (const { file, source } of sources) {
      expect(source).not.toContain('execSync')
      expect(source).not.toContain('execFileSync')
      expect(source).not.toContain('spawnSync')
      if (file !== 'runtime-init.ts') {
        expect(source).toContain('execFileAsync')
      }
    }
  })

  test('Given Windows shell initialization When Git Bash and WSL are detected Then both detections start concurrently', async () => {
    const source = await readFile(join(runtimeLibDir, 'runtime-init.ts'), 'utf-8')

    expect(source).toContain('await Promise.all([')
    expect(source).toContain('detectGitBash(),')
    expect(source).toContain('detectWsl(),')
  })
})
