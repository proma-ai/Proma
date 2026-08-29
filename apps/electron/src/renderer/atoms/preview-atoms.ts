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
  /** Workspace slug for a relocatable managed Skill path. */
  workspaceSkillSlug?: string
  /** Original absolute Skill entry path used only when the managed locator cannot resolve. */
  legacySkillFilePath?: string
  /** 文件是否落在当前会话的 diff scope 内（与 getUnstagedChanges 的 candidates 对齐） */
  inDiffScope?: boolean
  /** 基准 ref（如 "origin/main"），用于 worktree vs main 模式的 diff 对比 */
  baseRef?: string
}

// ===== Atoms =====

/** 预览 Tab 的稳定 key：同一文件在不同预览/比较上下文可独立打开。 */
export function getPreviewFileId(file: PreviewFile): string {
  return [file.filePath, file.previewOnly ? 'preview' : 'diff', file.gitRoot ?? '', file.baseRef ?? ''].join('\u0000')
}

/** 同一会话中单个预览文件的内容刷新版本。 */
export function getPreviewContentRefreshKey(sessionId: string, file: Pick<PreviewFile, 'filePath' | 'previewOnly' | 'gitRoot' | 'baseRef'>): string {
  return `${sessionId}\u0000${getPreviewFileId(file)}`
}

/**
 * 纯文件预览的内容刷新版本：按 session + 文件隔离。
 * 不复用 Git diff 的会话级版本，避免无关文件改动重载当前预览。
 */
export const previewContentRefreshVersionAtom = atom<Map<string, number>>(new Map())

/** 纯预览最后一次实际解析到的绝对路径，用于精确匹配相对路径 watcher 事件。 */
export const previewResolvedPathAtom = atom<Map<string, string>>(new Map())

/** 每会话预览面板开关 */
export const previewPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

/** 每会话已打开的预览文件；非激活项只保留轻量元数据。 */
export const previewFilesMapAtom = atom<Map<string, PreviewFile[]>>(new Map())

/** 每会话当前预览的文件（兼容旧调用方的激活文件投影）。 */
export const previewFileMapAtom = atom<Map<string, PreviewFile | null>>(new Map())

/** 分栏比例（对话占比），持久化 */
export const previewSplitRatioAtom = atomWithStorage<number>('proma-preview-split-ratio', 0.5, undefined, { getOnInit: true })

/** 代码预览换行偏好（默认不换行，保持现有横向滚动行为） */
export const previewCodeWrapAtom = atomWithStorage<boolean>(
  'proma-preview-code-wrap',
  false,
  undefined,
  { getOnInit: true },
)

/** 当前会话的预览面板是否打开（derived） */
export const currentSessionPreviewOpenAtom = atom<boolean>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  if (!sessionId) return false
  return get(previewPanelOpenMapAtom).get(sessionId) ?? false
})

// ===== 引用选中文本（Quoted Selection）=====

/** 选中文本引用的来源 */
export type QuotedSelectionSourceType = 'file' | 'agent-history'

/** 从预览面板或 Agent 历史中选中的文本引用 */
export interface QuotedSelection {
  /** 选中的文本内容 */
  text: string
  /** 来源文件路径；历史引用时作为兼容展示字段 */
  filePath: string
  /** 引用来源类型 */
  sourceType?: QuotedSelectionSourceType
  /** 面向用户展示的来源名称 */
  sourceLabel?: string
  /** Agent 历史消息 ID */
  messageId?: string
  /** Agent 历史消息角色 */
  messageRole?: 'user' | 'assistant' | 'system'
  /** 起始行号（1-based，代码文件可计算，markdown 等无法计算时为 undefined） */
  startLine?: number
  /** 结束行号（1-based） */
  endLine?: number
  /** Agent 历史消息内选区的起始字符偏移（0-based） */
  selectionStart?: number
  /** Agent 历史消息内选区的结束字符偏移（0-based、exclusive） */
  selectionEnd?: number
  /** Agent 历史中的所属轮次（1-based；用户消息和对应回复共用同一轮） */
  turn?: number
  /** 捕获时间戳 */
  capturedAt: number
}

/**
 * 每会话的单条外置选区引用（兼容 Chat 与输入框尚未挂载时的回退）。
 * Agent 主输入框的多条引用由 RichTextInput 内联 chip 持久化在草稿中。
 */
export const quotedSelectionMapAtom = atom<Map<string, QuotedSelection>>(new Map())

/** 当前会话的引用选中文本（派生） */
export const currentQuotedSelectionAtom = atom<QuotedSelection | null>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  if (!sessionId) return null
  return get(quotedSelectionMapAtom).get(sessionId) ?? null
})
