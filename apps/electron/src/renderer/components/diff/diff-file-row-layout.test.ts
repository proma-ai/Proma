import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const source = readFileSync(join(import.meta.dir, 'DiffChangesList.tsx'), 'utf-8')

describe('改动文件行布局', () => {
  test('given 文件行处于非 hover 状态 when 渲染图标 then 不为未查看与回退操作保留左侧空槽', () => {
    expect(source).not.toContain('flex w-3.5 shrink-0 items-center justify-center')
    expect(source).not.toContain('flex w-5 shrink-0 items-center justify-center')
    expect(source).toContain('absolute -left-1.5')
  })

  test('given 已追踪文件 when hover 或键盘聚焦还原操作 then 从右侧显示且不推动文件图标', () => {
    expect(source).toContain('absolute right-7 top-1/2')
    expect(source).toContain('group-hover/file:opacity-100')
    expect(source).toContain('focus-visible:opacity-100')
  })
})
