/**
 * Preview Atoms — 内联预览/Diff 面板状态管理
 *
 * 每个 Agent 会话拥有独立的预览面板状态（选中文件、开关）。
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { currentAgentSessionIdAtom } from './agent-atoms'

// ===== 类型定义 =====

/** 当前预览的文件信息 */
export interface PreviewFile {
  filePath: string
  dirPath?: string
  gitRoot?: string
  /** true = 纯文件预览（不显示 diff 控件），false/undefined = diff 模式 */
  previewOnly?: boolean
  /** true = 预览只读，不允许从预览面板写回临时/源文件 */
  readOnly?: boolean
  /** 候选基础目录（用于相对路径解析） */
  basePaths?: string[]
  /** 文件是否落在当前会话的 diff scope 内（与 getUnstagedChanges 的 candidates 对齐） */
  inDiffScope?: boolean
  /** 基准 ref（如 "origin/main"），用于 worktree vs main 模式的 diff 对比 */
  baseRef?: string
}

// ===== Atoms =====

/** 每会话预览面板开关 */
export const previewPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

/** 每会话当前预览的文件（null 时显示 DiffChangesList） */
export const previewFileMapAtom = atom<Map<string, PreviewFile | null>>(new Map())

/** 分栏比例（对话占比），持久化 */
export const previewSplitRatioAtom = atomWithStorage<number>('proma-preview-split-ratio', 0.5)

/** 自动预览开关，持久化（默认关闭以减轻设备性能负担，老用户保留已设置的偏好） */
export const autoPreviewEnabledAtom = atomWithStorage<boolean>('proma-auto-preview-enabled', false)

/**
 * 预览默认展开方式，持久化。
 * - 'tab'   = 以预览标签页形式打开（旧版默认）
 * - 'split' = 在主区域右侧分屏展开（可同时看到 Agent 输出与文件内容）
 *
 * 用户仍可通过拖拽 Tab 出区域、PreviewPanel 顶栏按钮等即时切换。
 */
export type PreviewModePreference = 'tab' | 'split'
export const previewModePreferenceAtom = atomWithStorage<PreviewModePreference>(
  'proma-preview-mode-pref',
  'tab',
)

/** 当前会话的预览面板是否打开（derived） */
export const currentSessionPreviewOpenAtom = atom<boolean>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  if (!sessionId) return false
  return get(previewPanelOpenMapAtom).get(sessionId) ?? false
})

// ===== 引用选中文本（Quoted Selection）=====

/** 从预览面板中选中的文本引用 */
export interface QuotedSelection {
  /** 选中的文本内容 */
  text: string
  /** 来源文件路径 */
  filePath: string
  /** 起始行号（1-based，代码文件可计算，markdown 等无法计算时为 undefined） */
  startLine?: number
  /** 结束行号（1-based） */
  endLine?: number
  /** 捕获时间戳 */
  capturedAt: number
}

/** 每会话的引用选中文本 Map（每次新选中覆盖旧值） */
export const quotedSelectionMapAtom = atom<Map<string, QuotedSelection>>(new Map())

/** 当前会话的引用选中文本（派生） */
export const currentQuotedSelectionAtom = atom<QuotedSelection | null>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  if (!sessionId) return null
  return get(quotedSelectionMapAtom).get(sessionId) ?? null
})
