/**
 * Memory Extractor 单元测试（纯逻辑，不依赖真实 LLM）
 */

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { parseExtractionResponse, formatExtractionMessages, findDotEnvUpwards, getMemoryLlmConfig } from '../memory/extractor'

describe('memory/extractor 解析', () => {
  it('解析标准 JSON 数组', () => {
    const raw = '[{"content": "用户使用 DeepSeek", "type": "fact", "priority": 70}]'
    const result = parseExtractionResponse(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.content).toBe('用户使用 DeepSeek')
    expect(result[0]?.type).toBe('fact')
    expect(result[0]?.priority).toBe(70)
  })

  it('解析带 markdown 围栏的响应', () => {
    const raw = '```json\n[{"content": "偏好中文", "type": "preference", "priority": 60}]\n```'
    const result = parseExtractionResponse(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.type).toBe('preference')
  })

  it('过滤空 content，非法类型降级为 fact', () => {
    const raw = JSON.stringify([
      { content: '', type: 'fact', priority: 50 },
      { content: '有效记忆', type: 'hack', priority: 100 },
      { content: '正确类型', type: 'sop', priority: 80 },
    ])
    const result = parseExtractionResponse(raw)
    expect(result).toHaveLength(2)
    expect(result[0]?.type).toBe('fact') // 非法 hack 降级为 fact
    expect(result[0]?.priority).toBe(100)
    expect(result[1]?.type).toBe('sop')
    expect(result[1]?.priority).toBe(80)
  })

  it('priority 越界时钳制到 0-100', () => {
    const raw = '[{"content": "x", "type": "fact", "priority": 999}, {"content": "y", "type": "fact", "priority": -5}]'
    const result = parseExtractionResponse(raw)
    expect(result[0]?.priority).toBe(100)
    expect(result[1]?.priority).toBe(0)
  })

  it('非 JSON 响应返回空数组', () => {
    expect(parseExtractionResponse('不是 JSON')).toEqual([])
    expect(parseExtractionResponse('')).toEqual([])
    expect(parseExtractionResponse('[not valid')).toEqual([])
  })

  it('formatExtractionMessages 截断超长消息', () => {
    const long = 'x'.repeat(2000)
    const text = formatExtractionMessages([{ role: 'user', content: long }])
    expect(text.length).toBeLessThan(1200)
  })
})

describe('memory/extractor findDotEnvUpwards（dev 模式 cwd 在子目录）', () => {
  it('从子目录向上查找到仓库根 .env', () => {
    const tempRoot = mkdtempSync(join(os.tmpdir(), 'extractor-env-up-'))
    try {
      // 模拟：仓库根有 .env，cwd 在 apps/electron（子目录）
      const repoRoot = join(tempRoot, 'ProMa')
      const subDir = join(repoRoot, 'apps', 'electron')
      mkdirSync(subDir, { recursive: true })
      writeFileSync(
        join(repoRoot, '.env'),
        'MEMORY_LLM_API_KEY=sk-upward-test-key-123456\nMEMORY_LLM_BASE_URL=https://api.deepseek.com/anthropic\n',
        'utf-8',
      )

      const env = findDotEnvUpwards(subDir)
      expect(env.MEMORY_LLM_API_KEY).toBe('sk-upward-test-key-123456')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('cwd 即 .env 所在目录时直接命中', () => {
    const tempRoot = mkdtempSync(join(os.tmpdir(), 'extractor-env-direct-'))
    try {
      mkdirSync(tempRoot, { recursive: true })
      writeFileSync(join(tempRoot, '.env'), 'MEMORY_LLM_API_KEY=sk-direct-test-key\n', 'utf-8')
      const env = findDotEnvUpwards(tempRoot)
      expect(env.MEMORY_LLM_API_KEY).toBe('sk-direct-test-key')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('无 .env 时返回空', () => {
    const tempRoot = mkdtempSync(join(os.tmpdir(), 'extractor-env-none-'))
    try {
      const env = findDotEnvUpwards(tempRoot)
      expect(Object.keys(env).length).toBe(0)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('getMemoryLlmConfig 在子目录 cwd 下能读到上级 .env（模拟 dev 模式）', () => {
    const tempRoot = mkdtempSync(join(os.tmpdir(), 'extractor-llm-up-'))
    const originalCwd = process.cwd()
    try {
      const repoRoot = join(tempRoot, 'ProMa')
      const subDir = join(repoRoot, 'apps', 'electron')
      mkdirSync(subDir, { recursive: true })
      writeFileSync(
        join(repoRoot, '.env'),
        'MEMORY_LLM_API_KEY=sk-llm-up-test-key-123456\nMEMORY_LLM_BASE_URL=https://api.deepseek.com/anthropic\nMEMORY_LLM_MODEL=deepseek-v4-flash\n',
        'utf-8',
      )
      // 清掉环境变量，确保走 .env 路径
      delete process.env.MEMORY_LLM_API_KEY
      delete process.env.MEMORY_LLM_BASE_URL
      delete process.env.MEMORY_LLM_MODEL
      delete process.env.PROMA_MEMORY_LLM_DISABLED
      process.chdir(subDir)

      const config = getMemoryLlmConfig()
      expect(config?.apiKey).toBe('sk-llm-up-test-key-123456')
      expect(config?.baseUrl).toBe('https://api.deepseek.com/anthropic')
      expect(config?.model).toBe('deepseek-v4-flash')
    } finally {
      process.chdir(originalCwd)
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
