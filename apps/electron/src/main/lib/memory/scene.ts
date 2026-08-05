/**
 * Memory Scene — L2 场景聚合与热度
 *
 * 从 L1 atoms 按主题聚类出「场景块」（scene）并计算热度：
 * - 场景 = 用户一段时间内的关注主题（如"CodeLens 开发"、"发版流程"）
 * - 热度 heat = 命中 atom 数 × 时间衰减权重（复用 half-life）× 抑制因子
 * - 热度是主动性的"时钟"：高频 ignore 的建议对应场景会被抑制（反馈回流闭环）
 *
 * 设计参考：
 * - TencentDB Agent Memory L2 Scene（主题聚合 + 场景热度）
 * - MemOS Next-Scene Prediction（场景 = 主动提议的时机信号）
 * - MineContext 六种上下文类型（activity/intent/semantic/state/procedural/entity）
 *
 * 实现原则（对齐 Proma 风格）：纯函数可测；实时聚类（atoms 量小，无需缓存）；
 * 不引入数据库/向量库依赖；只读不改写 atoms。
 */

import { randomUUID } from 'node:crypto'
import type { MemoryAtom, SceneBlock } from '@proma/shared'
import { readAllAtoms, writeSceneBlock, readAllScenes } from './store'
import { tokenize, timeDecay } from './recall'
import { getSuppressedSuggestionKeys } from '../suggest/service'

/** 场景聚合的时间窗口（默认 7 天：近期关注 = 当前场景） */
export const SCENE_WINDOW_DAYS = 7

/** 聚类相似度阈值：共享 ≥2 个非停用词 bigram/单词即视为同场景 */
export const SCENE_MERGE_MIN_SHARED = 2

/** 场景原子数上限（避免单一场景无限膨胀） */
export const SCENE_MAX_ATOMS = 30

/** 返回场景数上限 */
export const SCENE_MAX_SCENES = 8

// ===== 主题词提取 =====

/** 提取 atom 的主题词：过滤停用词后的 token（bigram/单词），排除单字噪声 */
export function atomTopicTerms(atom: MemoryAtom): string[] {
  const tokens = tokenize(`${atom.content} ${atom.metadata?.tags ?? ''}`.toLowerCase())
  // 只保留长度 ≥2 的 token（bigram 或英文单词），过滤单字
  const meaningful = tokens.filter((t) => t.length >= 2)
  return [...new Set(meaningful)]
}

// ===== 聚类（纯函数） =====

export interface SceneCluster {
  title: string
  atomIds: string[]
  terms: string[]
}

/**
 * 贪心聚类：按时间从新到旧遍历 atoms，与已有场景算共享词数；
 * 共享词 ≥ SCENE_MERGE_MIN_SHARED 则归入最匹配场景，否则新开场景。
 * 返回聚类结果（未排序，heat 由调用方计算）。
 */
export function clusterAtomsToScenes(atoms: MemoryAtom[], opts: { minShared?: number } = {}): SceneCluster[] {
  const minShared = opts.minShared ?? SCENE_MERGE_MIN_SHARED
  const scenes: SceneCluster[] = []

  // 新到旧
  const sorted = [...atoms].sort((a, b) => b.createdAt - a.createdAt)
  for (const atom of sorted) {
    const terms = atomTopicTerms(atom)
    if (terms.length === 0) continue

    // 找共享词最多的场景
    let bestIdx = -1
    let bestShared = 0
    for (let i = 0; i < scenes.length; i++) {
      const shared = terms.filter((t) => scenes[i]!.terms.includes(t)).length
      if (shared > bestShared) {
        bestShared = shared
        bestIdx = i
      }
    }

    if (bestIdx >= 0 && bestShared >= minShared && scenes[bestIdx]!.atomIds.length < SCENE_MAX_ATOMS) {
      const scene = scenes[bestIdx]!
      scene.atomIds.push(atom.id)
      scene.terms = [...new Set([...scene.terms, ...terms])]
    } else {
      scenes.push({ title: atom.content.slice(0, 24), atomIds: [atom.id], terms })
    }
  }
  return scenes
}

// ===== 热度计算 =====

/**
 * 场景热度：0-100。
 * - base = 场景内 atom 的 timeDecay 之和（correction/sop 稳定不衰减，其余按半衰期）
 * - 映射：sumDecay × 20 → 单条新鲜记忆约 20，多原子叠加，封顶 100
 * - 抑制因子：场景标题/主题词命中高频 ignore 建议 → ×0.5（反馈回流闭环）
 */
export function sceneHeat(scene: SceneCluster, atomsById: Map<string, MemoryAtom>, now = Date.now()): number {
  const members = scene.atomIds
    .map((id) => atomsById.get(id))
    .filter((a): a is MemoryAtom => !!a)
  if (members.length === 0) return 0

  const sumDecay = members.reduce((sum, a) => sum + timeDecay(a, now), 0)
  let heat = Math.min(100, Math.round(sumDecay * 20))

  // 高频 ignore 抑制：场景主题词命中被抑制建议关键词 → 减半
  const suppressedKeys = getSuppressedSuggestionKeys()
  if (suppressedKeys.length > 0) {
    const sceneText = scene.title.toLowerCase()
    const hit = suppressedKeys.some((key) => {
      const keyWords = tokenize(key).filter((t) => t.length >= 2)
      return keyWords.some((k) => sceneText.includes(k))
    })
    if (hit) heat = Math.round(heat * 0.5)
  }
  return heat
}

// ===== 对外 API =====

/**
 * 计算最近 N 天的热点场景（实时聚类，不写盘）。
 * 返回按热度降序的 SceneBlock 列表（含 heat）。
 */
export function hotScenes(opts: { windowDays?: number; limit?: number; now?: number } = {}): SceneBlock[] {
  const windowDays = opts.windowDays ?? SCENE_WINDOW_DAYS
  const limit = Math.min(opts.limit ?? SCENE_MAX_SCENES, SCENE_MAX_SCENES)
  const now = opts.now ?? Date.now()

  const atoms = readAllAtoms({ includeUnconfirmed: false })
    .filter((a) => a.type !== 'todo_context') // 临时任务不构成场景
    .filter((a) => now - a.createdAt <= windowDays * 86_400_000)

  if (atoms.length === 0) return []

  const clusters = clusterAtomsToScenes(atoms)
  const atomsById = new Map(atoms.map((a) => [a.id, a]))

  return clusters
    .map((c) => {
      const members = c.atomIds
        .map((id) => atomsById.get(id))
        .filter((a): a is MemoryAtom => !!a)
      const heat = sceneHeat(c, atomsById, now)
      const updatedAt = members.reduce((max, a) => Math.max(max, a.updatedAt), members[0]?.updatedAt ?? now)
      return {
        id: `scene_${randomUUID().slice(0, 8)}`,
        title: c.title,
        atomIds: c.atomIds,
        heat,
        createdAt: now,
        updatedAt,
      } satisfies SceneBlock
    })
    .sort((a, b) => b.heat - a.heat || b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

/** 持久化热点场景到 scenes/ 目录（供审计/未来跨会话复用） */
export function persistHotScenes(opts: { windowDays?: number; now?: number } = {}): SceneBlock[] {
  const scenes = hotScenes(opts)
  for (const scene of scenes) {
    const markdown = [
      `# ${scene.title}`,
      '',
      `> heat: ${scene.heat} · atoms: ${scene.atomIds.length}`,
      '',
      ...scene.atomIds.map((id) => `- atom: \`${id}\``),
      '',
    ].join('\n')
    writeSceneBlock(scene, markdown)
  }
  return scenes
}

/** 读取已持久化的场景（按热度降序） */
export function readHotScenes(): SceneBlock[] {
  return readAllScenes().sort((a, b) => b.heat - a.heat || b.updatedAt - a.updatedAt)
}
