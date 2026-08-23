import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const startupPages = [
  {
    name: '静态启动页',
    filePath: join(import.meta.dir, '../../resources/startup-splash/index.html'),
  },
  {
    name: 'React 启动兜底页',
    filePath: join(import.meta.dir, 'App.tsx'),
  },
] as const

describe('启动页文案', () => {
  for (const page of startupPages) {
    test(`Given ${page.name}加载中，When 展示启动状态，Then 仅保留主状态文案`, () => {
      const source = readFileSync(page.filePath, 'utf-8')

      expect(source).toContain('正在启动 Proma')
      expect(source).not.toContain('正在初始化你的工作空间')
    })
  }
})
