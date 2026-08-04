/**
 * Memory Store — 长期记忆持久化层
 *
 * 存储布局（local-first，对齐 Proma 惯例）：
 * ```text
 * ~/.proma/memory/
 *   index.json            # 元数据/版本/统计（原子写 + .bak 容错）
 *   profile.md            # L3 用户画像
 *   atoms/{YYYY-MM-DD}.jsonl   # L1 原子记忆，按天分文件（append-only）
 *   scenes/{sceneId}.md   # L2 场景块
 *   corrections.json      # 行为纠正候选（待审批）
 *   memory_log/{YYYY-MM-DD}.md # 每日记忆变更日志
 * ```
 *
 * 设计原则：
 * - 同步优先（对齐 automation-manager 的 read/write-through 缓存模式）
 * - 崩溃安全（复用 safe-file 的原子写 + .tmp/.bak 容错）
 * - atoms 只追加；去重/更新在读取层做（fingerprint 定位后标记 superseded 或直接替换）
 */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  getMemoryRootDir,
  getMemoryIndexPath,
  getMemoryAtomsDir,
  getMemoryAtomsDayPath,
  getMemoryScenesDir,
  getPersonaPath,
  getCorrectionsPath,
  getMemoryLogDir,
} from '../config-paths'
import { readJsonFileSafe, writeJsonFileAtomic, writeTextFileAtomic } from '../safe-file'
import type {
  MemoryAtom,
  MemoryAtomType,
  MemoryCorrection,
  MemoryStats,
  PersonaProfile,
  SceneBlock,
} from '@proma/shared'

/** 记忆索引文件格式 */
interface MemoryIndex {
  version: number
  /** 最近一次 L1 提取时间（epoch ms） */
  lastExtractionAt: number
  /** 记忆启用状态 */
  enabled: boolean
  /** 提取模式：llm=LLM 提取（外发）、rule=仅规则版（零外发）、off=关闭提取 */
  extractionMode?: 'llm' | 'rule' | 'off'
  /** 是否把 persona 画像注入系统提示（默认 true；用户可关闭） */
  personaInjectionEnabled?: boolean
}

const INDEX_VERSION = 1

// ===== 日期工具 =====

/** 返回本地日期 key：YYYY-MM-DD */
export function localDateKey(ts: number = Date.now()): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ===== ID / 指纹 =====

function generateAtomId(): string {
  return `atom_${Date.now()}_${randomUUID().slice(0, 8)}`
}

function generateCorrectionId(): string {
  return `corr_${Date.now()}_${randomUUID().slice(0, 8)}`
}

/** 归一化内容指纹：去除空白/标点差异，用于近似去重 */
export function fingerprintContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/[\s，。！？、；：""''（）《》【】,.!?;:"'()<>\[\]]/g, '')
    .slice(0, 120)
}

/** 判断两条记忆是否"实质重复"：指纹相同，或内容包含度 ≥ 0.9 */
export function isDuplicate(a: MemoryAtom, b: MemoryAtom): boolean {
  if (a.fingerprint && b.fingerprint && a.fingerprint === b.fingerprint) return true
  const ac = a.content.toLowerCase()
  const bc = b.content.toLowerCase()
  if (ac.length === 0 || bc.length === 0) return false
  const short = ac.length <= bc.length ? ac : bc
  const long = ac.length <= bc.length ? bc : ac
  if (short.length / long.length < 0.6) return false
  return long.includes(short) || short.includes(long)
}

// ===== 目录初始化 =====

function ensureMemoryDirs(): void {
  for (const dir of [getMemoryRootDir(), getMemoryAtomsDir(), getMemoryScenesDir(), getMemoryLogDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

// ===== 索引 =====

let cachedIndex: MemoryIndex | null = null

function readIndex(): MemoryIndex {
  if (cachedIndex) return cachedIndex
  const data = readJsonFileSafe<MemoryIndex>(getMemoryIndexPath())
  if (!data || typeof data.version !== 'number') {
    cachedIndex = { version: INDEX_VERSION, lastExtractionAt: 0, enabled: true, extractionMode: 'llm', personaInjectionEnabled: true }
    return cachedIndex
  }
  if (data.version > INDEX_VERSION) {
    cachedIndex = data
    return cachedIndex
  }
  cachedIndex = {
    version: INDEX_VERSION,
    lastExtractionAt: data.lastExtractionAt ?? 0,
    enabled: data.enabled ?? true,
    extractionMode: data.extractionMode ?? 'llm',
    personaInjectionEnabled: data.personaInjectionEnabled ?? true,
  }
  return cachedIndex
}

function writeIndex(index: MemoryIndex): void {
  try {
    ensureMemoryDirs()
    cachedIndex = index
    writeJsonFileAtomic(getMemoryIndexPath(), index)
  } catch (error) {
    cachedIndex = null
    console.error('[Memory] 写入索引失败:', error)
    throw new Error('写入记忆索引失败')
  }
}

/** 记忆是否启用（可在 index.json 中关闭） */
export function isMemoryEnabled(): boolean {
  return readIndex().enabled
}

/** 开关记忆 */
export function setMemoryEnabled(enabled: boolean): void {
  const index = readIndex()
  index.enabled = enabled
  writeIndex(index)
}

/** 当前提取模式 */
export function getExtractionMode(): 'llm' | 'rule' | 'off' {
  return readIndex().extractionMode ?? 'llm'
}

/** 设置提取模式 */
export function setExtractionMode(mode: 'llm' | 'rule' | 'off'): void {
  const index = readIndex()
  index.extractionMode = mode
  writeIndex(index)
}

/** persona 画像是否注入系统提示 */
export function isPersonaInjectionEnabled(): boolean {
  return readIndex().personaInjectionEnabled ?? true
}

/** 开关 persona 注入 */
export function setPersonaInjectionEnabled(enabled: boolean): void {
  const index = readIndex()
  index.personaInjectionEnabled = enabled
  writeIndex(index)
}

/** 最近一次提取时间 */
export function getLastExtractionAt(): number {
  return readIndex().lastExtractionAt
}

/** 标记提取完成 */
export function markExtractionCompleted(at: number = Date.now()): void {
  const index = readIndex()
  index.lastExtractionAt = at
  writeIndex(index)
}

// ===== L1 Atoms =====

/** 写入一条原子记忆（append 到当天文件） */
export function writeAtom(atom: Omit<MemoryAtom, 'id' | 'createdAt' | 'updatedAt' | 'confirmed'> & { id?: string; confirmed?: boolean }): MemoryAtom {
  ensureMemoryDirs()
  const now = Date.now()
  const full: MemoryAtom = {
    ...atom,
    id: atom.id ?? generateAtomId(),
    createdAt: now,
    updatedAt: now,
    confirmed: atom.confirmed ?? (atom.type !== 'correction'),
    fingerprint: atom.fingerprint ?? fingerprintContent(atom.content),
  }
  const filePath = getMemoryAtomsDayPath(localDateKey())
  const line = JSON.stringify(full)
  const content = (existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '') + line + '\n'
  const tmpPath = filePath + '.tmp'
  writeFileSync(tmpPath, content, 'utf-8')
  try {
    // POSIX rename 原子替换
    renameSync(tmpPath, filePath)
  } catch (error) {
    console.error('[Memory] 写入 atom 失败:', error)
    throw new Error('写入记忆条目失败')
  }
  return full
}

/** 读取全部 L1 atoms（跨天文件，按创建时间倒序） */
export function readAllAtoms(opts: { includeUnconfirmed?: boolean } = {}): MemoryAtom[] {
  if (!existsSync(getMemoryAtomsDir())) return []
  const atoms: MemoryAtom[] = []
  for (const file of readdirSync(getMemoryAtomsDir())) {
    if (!file.endsWith('.jsonl')) continue
    const filePath = join(getMemoryAtomsDir(), file)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const atom = JSON.parse(line) as MemoryAtom
          if (!opts.includeUnconfirmed && !atom.confirmed) continue
          atoms.push(atom)
        } catch {
          // 跳过损坏行
        }
      }
    } catch {
      // 跳过不可读文件
    }
  }
  return atoms.sort((a, b) => b.createdAt - a.createdAt)
}

/** 按 ID 查 atom */
export function getAtomById(id: string): MemoryAtom | undefined {
  return readAllAtoms({ includeUnconfirmed: true }).find((a) => a.id === id)
}

/**
 * 尝试写入 atom，若与已有条目重复则更新已有条目并返回 { deduplicated: true, atom: 已有条目 }
 * 用于提取管道，避免 LLM 每轮重复提取同一事实。
 */
export function writeAtomWithDedup(atom: Omit<MemoryAtom, 'id' | 'createdAt' | 'updatedAt' | 'confirmed'> & { id?: string; confirmed?: boolean }): { deduplicated: boolean; atom: MemoryAtom } {
  const existing = readAllAtoms({ includeUnconfirmed: true })
  for (const prev of existing) {
    if (isDuplicate(prev, {
      ...atom,
      id: '',
      createdAt: 0,
      updatedAt: 0,
      confirmed: true,
    } as MemoryAtom)) {
      // 更新已有条目的优先级/内容（保留原 id 与创建时间）
      const updated: MemoryAtom = {
        ...prev,
        content: atom.content.length > prev.content.length ? atom.content : prev.content,
        priority: Math.max(prev.priority, atom.priority ?? 50),
        updatedAt: Date.now(),
        sessionId: atom.sessionId ?? prev.sessionId,
        workspaceSlug: atom.workspaceSlug ?? prev.workspaceSlug,
        metadata: { ...(prev.metadata ?? {}), ...(atom.metadata ?? {}) },
      }
      updateAtomById(prev.id, updated)
      return { deduplicated: true, atom: updated }
    }
  }
  return { deduplicated: false, atom: writeAtom(atom) }
}

/** 替换某条 atom（按 id；找不到则追加） */
/** 列出待确认的自动提取记忆（pending atoms） */
export function listPendingAtoms(): MemoryAtom[] {
  return readAllAtoms({ includeUnconfirmed: true })
    .filter((a) => !a.confirmed)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 分页浏览全部记忆（记忆看板视图）。
 * 支持按类型过滤、按时间/优先级排序。
 */
export function listAtomsPaged(opts: {
  page?: number
  pageSize?: number
  type?: MemoryAtomType | 'all'
  sort?: 'newest' | 'priority'
} = {}): { atoms: MemoryAtom[]; total: number; page: number; pageSize: number; totalPages: number } {
  const { page = 1, pageSize = 20, type = 'all', sort = 'newest' } = opts
  const safePage = Math.max(1, Math.floor(page))
  const safeSize = Math.min(Math.max(1, Math.floor(pageSize)), 100)
  let atoms = readAllAtoms({ includeUnconfirmed: true })
  if (type !== 'all') atoms = atoms.filter((a) => a.type === type)
  atoms = [...atoms].sort((a, b) =>
    sort === 'priority'
      ? (b.priority ?? 0) - (a.priority ?? 0) || b.createdAt - a.createdAt
      : b.createdAt - a.createdAt,
  )
  const total = atoms.length
  const totalPages = Math.max(1, Math.ceil(total / safeSize))
  const start = (safePage - 1) * safeSize
  return { atoms: atoms.slice(start, start + safeSize), total, page: safePage, pageSize: safeSize, totalPages }
}

/** 确认一条待确认记忆（用户认可后注入） */
export function confirmAtom(id: string): MemoryAtom | undefined {
  const atom = getAtomById(id)
  if (!atom) return undefined
  const updated: MemoryAtom = { ...atom, confirmed: true, updatedAt: Date.now() }
  updateAtomById(id, updated)
  return updated
}

/** 拒绝并删除一条待确认记忆 */
export function deleteAtom(id: string): boolean {
  const files = existsSync(getMemoryAtomsDir()) ? readdirSync(getMemoryAtomsDir()).filter((f) => f.endsWith('.jsonl')) : []
  for (const file of files) {
    const filePath = join(getMemoryAtomsDir(), file)
    const lines = readFileSync(filePath, 'utf-8').split('\n')
    const kept = lines.filter((line) => {
      if (!line?.trim()) return false
      try {
        const parsed = JSON.parse(line) as MemoryAtom
        return parsed.id !== id
      } catch {
        return true
      }
    })
    if (kept.length !== lines.length) {
      const tmpPath = filePath + '.tmp'
      writeFileSync(tmpPath, kept.join('\n'), 'utf-8')
      renameSync(tmpPath, filePath)
      return true
    }
  }
  return false
}

export function updateAtomById(id: string, atom: MemoryAtom): MemoryAtom {
  ensureMemoryDirs()
  // 找到该 atom 所在文件
  const files = existsSync(getMemoryAtomsDir()) ? readdirSync(getMemoryAtomsDir()).filter((f) => f.endsWith('.jsonl')) : []
  for (const file of files) {
    const filePath = join(getMemoryAtomsDir(), file)
    const lines = readFileSync(filePath, 'utf-8').split('\n')
    let changed = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line?.trim()) continue
      try {
        const parsed = JSON.parse(line) as MemoryAtom
        if (parsed.id === id) {
          lines[i] = JSON.stringify(atom)
          changed = true
          break
        }
      } catch {
        // 跳过损坏行
      }
    }
    if (changed) {
      const tmpPath = filePath + '.tmp'
      writeFileSync(tmpPath, lines.join('\n'), 'utf-8')
      renameSync(tmpPath, filePath)
      return atom
    }
  }
  return writeAtom(atom)
}

// ===== L2 Scenes =====

/** 写入/更新一个场景块（markdown 文件） */
export function writeSceneBlock(scene: SceneBlock, markdown: string): SceneBlock {
  ensureMemoryDirs()
  const filePath = join(getMemoryScenesDir(), `${scene.id}.md`)
  writeJsonFileAtomic(filePath, { scene, markdown })
  return scene
}

/** 读取全部场景块 */
export function readAllScenes(): SceneBlock[] {
  if (!existsSync(getMemoryScenesDir())) return []
  const scenes: SceneBlock[] = []
  for (const file of readdirSync(getMemoryScenesDir())) {
    if (!file.endsWith('.md')) continue
    try {
      const data = readJsonFileSafe<{ scene: SceneBlock; markdown: string }>(join(getMemoryScenesDir(), file))
      if (data?.scene) scenes.push(data.scene)
    } catch {
      // 跳过损坏
    }
  }
  return scenes.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ===== L3 Persona =====

/** 读取 persona 原文（不存在返回 undefined） */
export function readPersonaRaw(): string | undefined {
  const filePath = getPersonaPath()
  if (!existsSync(filePath)) return undefined
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return undefined
  }
}

/** 写入 persona（全文替换） */
export function writePersona(markdown: string): void {
  ensureMemoryDirs()
  writeTextFileAtomic(getPersonaPath(), markdown)
}

/** 删除 persona（用户控制：不再注入画像） */
export function deletePersona(): boolean {
  const filePath = getPersonaPath()
  if (!existsSync(filePath)) return false
  try {
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * 从 persona markdown 解析结构化摘要（供注入/展示）
 * 简易解析：一级标题 + 列表项；不追求完美，解析失败时返回空 profile。
 */
export function parsePersonaProfile(raw?: string): PersonaProfile {
  if (!raw) return { preferences: [], interactionRules: [], evolution: [], updatedAt: 0 }
  const preferences: string[] = []
  const interactionRules: string[] = []
  const evolution: string[] = []
  let section = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    // 识别一级与二级标题作为 section 名
    if (/^#{1,3}\s+/.test(trimmed)) {
      section = trimmed.replace(/^#{1,3}\s+/, '')
      continue
    }
    if (!trimmed.startsWith('- ') && !trimmed.startsWith('* ')) continue
    const item = trimmed.replace(/^[-*]\s+/, '').trim()
    if (!item) continue
    if (/偏好|preference|喜欢|偏好/i.test(section)) preferences.push(item)
    else if (/交互|协议|规则|protocol|rule|interaction/i.test(section)) interactionRules.push(item)
    else if (/演进|轨迹|evolution|阶段/i.test(section)) evolution.push(item)
  }
  // 粗取姓名与一句话定位
  let name: string | undefined
  let summary: string | undefined
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]?.trim() ?? ''
    const next = lines[i + 1]?.trim()
    if (!name && /^#+\s*用户/.test(t) && next && !next.startsWith('#')) {
      name = next.slice(0, 40)
    }
    if (!summary && /^#+\s*一句话/.test(t) && next && !next.startsWith('#')) {
      summary = next.slice(0, 120)
    }
  }
  return { name, summary, preferences, interactionRules, evolution, updatedAt: Date.now() }
}

// ===== Corrections =====

interface CorrectionsIndex {
  version: number
  corrections: MemoryCorrection[]
}

const CORRECTIONS_VERSION = 1

/** 纠正记录容量上限（防无限膨胀） */
const MAX_CORRECTIONS = 300

let cachedCorrections: CorrectionsIndex | null = null

function readCorrections(): CorrectionsIndex {
  if (cachedCorrections) return cachedCorrections
  const data = readJsonFileSafe<CorrectionsIndex>(getCorrectionsPath())
  if (!data || !Array.isArray(data.corrections)) {
    cachedCorrections = { version: CORRECTIONS_VERSION, corrections: [] }
    return cachedCorrections
  }
  // schema 校验：过滤非法纠正记录，限制数量上限
  data.corrections = data.corrections.filter(isValidCorrection).slice(0, MAX_CORRECTIONS)
  cachedCorrections = data
  return cachedCorrections
}

/** 合法纠正记录：必须有 id、rule、status，状态为已知枚举 */
function isValidCorrection(r: unknown): r is MemoryCorrection {
  if (!r || typeof r !== 'object') return false
  const rec = r as Record<string, unknown>
  return (
    typeof rec.id === 'string' && rec.id.length > 0 &&
    typeof rec.rule === 'string' &&
    (rec.status === 'pending' || rec.status === 'active' || rec.status === 'rejected' || rec.status === 'superseded')
  )
}

function writeCorrections(index: CorrectionsIndex): void {
  try {
    cachedCorrections = index
    writeJsonFileAtomic(getCorrectionsPath(), index)
  } catch (error) {
    cachedCorrections = null
    console.error('[Memory] 写入 corrections 失败:', error)
    throw new Error('写入行为纠正失败')
  }
}

/** 新增一条纠正候选（默认 pending） */
export function addCorrection(input: { raw: string; rule: string; sessionId?: string }): MemoryCorrection {
  ensureMemoryDirs()
  const index = readCorrections()
  const correction: MemoryCorrection = {
    id: generateCorrectionId(),
    raw: input.raw,
    rule: input.rule,
    sessionId: input.sessionId,
    createdAt: Date.now(),
    status: 'pending',
  }
  index.corrections.unshift(correction)
  writeCorrections(index)
  return correction
}

/** 读取纠正列表（可按状态过滤） */
export function listCorrections(status?: MemoryCorrection['status']): MemoryCorrection[] {
  const index = readCorrections()
  const list = status ? index.corrections.filter((c) => c.status === status) : index.corrections
  return [...list].sort((a, b) => b.createdAt - a.createdAt)
}

/** 更新纠正状态（确认/拒绝/替代） */
export function updateCorrectionStatus(id: string, status: MemoryCorrection['status']): MemoryCorrection | undefined {
  const index = readCorrections()
  const target = index.corrections.find((c) => c.id === id)
  if (!target) return undefined
  target.status = status
  writeCorrections(index)
  return target
}

/** 删除纠正（仅当用户明确要求时由上层调用） */
export function deleteCorrection(id: string): boolean {
  const index = readCorrections()
  const before = index.corrections.length
  index.corrections = index.corrections.filter((c) => c.id !== id)
  if (index.corrections.length === before) return false
  writeCorrections(index)
  return true
}

/** 清空全部记忆（atoms + corrections + persona，保留 index 与配置） */
export function clearAllMemory(): void {
  // 清空 atoms 按天文件
  if (existsSync(getMemoryAtomsDir())) {
    for (const file of readdirSync(getMemoryAtomsDir())) {
      if (file.endsWith('.jsonl')) {
        try {
          unlinkSync(join(getMemoryAtomsDir(), file))
        } catch {
          // 忽略单文件删除失败
        }
      }
    }
  }
  // 清空 corrections
  writeCorrections({ version: 1, corrections: [] })
  // 删除 persona（可重新生成）
  const profilePath = join(getMemoryRootDir(), 'profile.md')
  if (existsSync(profilePath)) {
    try {
      unlinkSync(profilePath)
    } catch {
      // 忽略
    }
  }
}

// ===== Stats / 清理 =====

/** 计算记忆统计 */
export function getMemoryStats(): MemoryStats {
  ensureMemoryDirs()
  const atoms = readAllAtoms({ includeUnconfirmed: true })
  const confirmed = atoms.filter((a) => a.confirmed)
  const byType: Record<MemoryAtomType, number> = {
    fact: 0,
    preference: 0,
    correction: 0,
    sop: 0,
    todo_context: 0,
  }
  for (const a of confirmed) {
    if (byType[a.type] !== undefined) byType[a.type] += 1
  }
  return {
    atomCount: confirmed.length,
    byType,
    sceneCount: readAllScenes().length,
    pendingCorrections: listCorrections('pending').length,
    pendingAtoms: atoms.filter((a) => !a.confirmed).length,
    personaExists: !!readPersonaRaw(),
    rootDir: getMemoryRootDir(),
    lastExtractionAt: getLastExtractionAt(),
  }
}

/** 追加一行记忆日志（markdown） */
export function appendMemoryLog(entry: string): void {
  ensureMemoryDirs()
  const filePath = join(getMemoryLogDir(), `${localDateKey()}.md`)
  const line = `- ${new Date().toISOString()} ${entry}\n`
  const content = (existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '') + line
  writeFileSync(filePath, content, 'utf-8')
}
