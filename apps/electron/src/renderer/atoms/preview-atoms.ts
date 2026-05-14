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
}

// ===== Atoms =====

/** 每会话预览面板开关 */
export const previewPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

/** 每会话当前预览的文件（null 时显示 DiffChangesList） */
export const previewFileMapAtom = atom<Map<string, PreviewFile | null>>(new Map())

/** 分栏比例（对话占比），持久化 */
export const previewSplitRatioAtom = atomWithStorage<number>('proma-preview-split-ratio', 0.5)

/** 自动预览开关，持久化 */
export const autoPreviewEnabledAtom = atomWithStorage<boolean>('proma-auto-preview-enabled', true)

/** 当前会话的预览面板是否打开（derived） */
export const currentSessionPreviewOpenAtom = atom<boolean>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  if (!sessionId) return false
  return get(previewPanelOpenMapAtom).get(sessionId) ?? false
})
