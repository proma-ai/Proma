/**
 * Memory Embedding — 语义向量通道（可插拔）
 *
 * 为召回提供语义检索能力，解决关键词无法处理的语义问句（"我是谁"）。
 *
 * 两种模式（通过环境变量切换）：
 * - `PROMA_MEMORY_EMBEDDING=local`：本地 node-llama-cpp + embeddinggemma-300m（离线，需安装）
 * - `PROMA_MEMORY_EMBEDDING=api`：OpenAI 兼容 embedding API（.env 配置）
 * - 默认 off：不启用，召回降级为 keyword + 规则加权（fail-open）
 *
 * 设计原则：
 * - **可选依赖**：node-llama-cpp 通过动态 import，主仓库不硬依赖
 * - **懒加载**：首次调用才初始化，避免拖慢启动
 * - **fail-open**：embedding 不可用时返回 null，不阻塞召回
 * - 单例：复用模型实例，避免重复加载
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getMemoryLlmConfig } from './extractor'

// ===== 配置 =====

export type EmbeddingMode = 'off' | 'local' | 'api'

/** 本地模型默认路径（复用 TencentDB 会话已下载的模型） */
export const LOCAL_EMBEDDING_MODEL = join(
  homedir(),
  '.node-llama-cpp',
  'models',
  'hf_ggml-org_embeddinggemma-300m-qat-Q8_0.gguf',
)

/** 本地模型向量维度 */
const LOCAL_DIMENSIONS = 768
/** 本地模型输入上限（字符级近似 256 token） */
const LOCAL_MAX_INPUT_CHARS = 500

/** 读取 embedding 模式 */
export function getEmbeddingMode(): EmbeddingMode {
  const mode = process.env.PROMA_MEMORY_EMBEDDING?.trim().toLowerCase()
  if (mode === 'local') return 'local'
  if (mode === 'api') return 'api'
  return 'off'
}

/** 本地 embedding 是否就绪（模型文件存在） */
export function isLocalEmbeddingReady(): boolean {
  return existsSync(LOCAL_EMBEDDING_MODEL)
}

// ===== 单例（本地） =====

interface LocalEmbeddingContext {
  getEmbeddingFor: (input: string) => Promise<{ vector: readonly number[] }>
  dispose: () => Promise<void>
}

let localContext: LocalEmbeddingContext | null = null
let localInitPromise: Promise<LocalEmbeddingContext | null> | null = null

/** 动态 import node-llama-cpp（可选依赖） */
async function importLlama(): Promise<{ getLlama: (opts: { logLevel: number; gpu?: boolean | string }) => Promise<unknown>; resolveModelFile: (path: string, cacheDir?: string) => Promise<string>; LlamaLogLevel: { error: number } }> {
  // node-llama-cpp 在 TencentDB 工作区已验证可用；此处从用户全局或工作区尝试加载
  const candidates = [
    'node-llama-cpp',
    join('/Users/moxianbao/.proma/agent-workspaces/tencentdb/workspace-files/TencentDB-Agent-Memory/node_modules/node-llama-cpp', 'dist', 'index.js'),
  ]
  for (const mod of candidates) {
    try {
      return await import(mod)
    } catch {
      // try next
    }
  }
  throw new Error('node-llama-cpp 未安装，无法使用本地 embedding')
}

/** 初始化本地 embedding（懒加载 + 单例） */
async function initLocalEmbedding(): Promise<LocalEmbeddingContext | null> {
  if (!isLocalEmbeddingReady()) {
    console.warn('[Memory] 本地 embedding 模型不存在:', LOCAL_EMBEDDING_MODEL)
    return null
  }
  if (localContext) return localContext
  if (localInitPromise) return localInitPromise

  localInitPromise = (async () => {
    try {
      const { getLlama, resolveModelFile, LlamaLogLevel } = await importLlama()
      // 强制 CPU：Metal GPU 编译在部分 macOS 环境失败；embeddinggemma-300m 在 CPU 上也足够快
      const llama = await getLlama({ logLevel: LlamaLogLevel.error, gpu: false }) as unknown as {
        loadModel: (opts: { modelPath: string }) => Promise<{ createEmbeddingContext: () => Promise<LocalEmbeddingContext> }>
      }
      const resolvedPath = await resolveModelFile(LOCAL_EMBEDDING_MODEL)
      const model = await llama.loadModel({ modelPath: resolvedPath })
      localContext = await model.createEmbeddingContext()
      console.log('[Memory] 本地 embedding 就绪 (embeddinggemma-300m, 768d)')
      return localContext
    } catch (error) {
      console.warn('[Memory] 本地 embedding 初始化失败:', error instanceof Error ? error.message : error)
      return null
    }
  })()

  return localInitPromise
}

// ===== API 模式 =====

/** 调用 OpenAI 兼容 embedding API（.env 配置） */
async function apiEmbed(texts: string[]): Promise<number[][] | null> {
  const config = getMemoryLlmConfig()
  if (!config) return null
  try {
    const resp = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: process.env.MEMORY_EMBEDDING_MODEL ?? 'text-embedding-3-small', input: texts }),
    })
    if (!resp.ok) return null
    const data = await resp.json() as { data?: Array<{ embedding: number[] }> }
    return data.data?.map((d) => d.embedding) ?? null
  } catch {
    return null
  }
}

// ===== 统一接口 =====

export interface EmbeddingProvider {
  /** 计算单条文本向量；失败返回 null（fail-open） */
  embed: (text: string) => Promise<number[] | null>
  /** 计算多条文本向量（批量） */
  embedBatch: (texts: string[]) => Promise<Array<number[] | null>>
  /** 是否可用 */
  ready: () => boolean
  dimensions: number
}

let cachedProvider: EmbeddingProvider | null | undefined = undefined

/** 获取 embedding provider（按模式选择；未启用返回 null） */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const mode = getEmbeddingMode()
  if (mode === 'off') return null
  if (cachedProvider !== undefined) return cachedProvider

  if (mode === 'local') {
    if (!isLocalEmbeddingReady()) {
      console.warn('[Memory] 本地 embedding 模型缺失，降级为 keyword 召回')
      cachedProvider = null
      return null
    }
    cachedProvider = {
      async embed(text) {
        const ctx = await initLocalEmbedding()
        if (!ctx) return null
        try {
          const trimmed = text.slice(0, LOCAL_MAX_INPUT_CHARS)
          const result = await ctx.getEmbeddingFor(trimmed)
          return Array.isArray(result) ? result : Array.from(result.vector ?? [])
        } catch {
          return null
        }
      },
      async embedBatch(texts) {
        return Promise.all(texts.map((t) => this.embed(t)))
      },
      ready: () => true,
      dimensions: LOCAL_DIMENSIONS,
    }
    return cachedProvider
  }

  if (mode === 'api') {
    cachedProvider = {
      async embed(text) {
        const result = await apiEmbed([text])
        return result?.[0] ?? null
      },
      async embedBatch(texts): Promise<Array<number[] | null>> {
        const result = await apiEmbed(texts)
        return result ?? texts.map(() => null)
      },
      ready: () => !!getMemoryLlmConfig(),
      dimensions: 1536,
    }
    return cachedProvider
  }

  return null
}

// ===== 向量工具 =====

/** 余弦相似度（0-1，越高越相似） */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
