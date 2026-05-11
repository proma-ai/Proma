/**
 * PreviewPanel — 内联预览/Diff 面板
 *
 * 嵌入 AgentView 右侧，始终显示当前选中文件的 diff。
 * Agent 修改文件时自动切换到最新修改的文件。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useAtom } from 'jotai'
import { X } from 'lucide-react'
import {
  previewPanelOpenMapAtom,
  previewFileMapAtom,
} from '@/atoms/preview-atoms'
import {
  agentSessionPathMapAtom,
} from '@/atoms/agent-atoms'
import { DiffTabContent } from './DiffTabContent'

interface PreviewPanelProps {
  sessionId: string
}

export function PreviewPanel({ sessionId }: PreviewPanelProps): React.ReactElement {
  const fileMap = useAtomValue(previewFileMapAtom)
  const setOpenMap = useSetAtom(previewPanelOpenMapAtom)

  const currentFile = fileMap.get(sessionId) ?? null

  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? ''

  const handleClosePanel = React.useCallback(() => {
    setOpenMap((prev) => { const m = new Map(prev); m.set(sessionId, false); return m })
  }, [sessionId, setOpenMap])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-content-area titlebar-no-drag">
      {/* 顶部栏：文件名 + 关闭 */}
      <div className="flex items-center h-[34px] px-3 flex-shrink-0 border-b border-border/30 titlebar-no-drag">
        <span className="text-xs text-muted-foreground truncate">
          {currentFile ? currentFile.filePath.split('/').pop() : '文件预览'}
        </span>
        <button
          type="button"
          onClick={handleClosePanel}
          className="ml-auto flex items-center justify-center size-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
          title="关闭预览面板"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {currentFile ? (
          <DiffTabContent
            filePath={currentFile.filePath}
            dirPath={currentFile.dirPath || sessionPath}
            sessionId={sessionId}
            gitRoot={currentFile.gitRoot}
            previewOnly={currentFile.previewOnly}
            basePaths={currentFile.basePaths}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            点击文件查看预览
          </div>
        )}
      </div>
    </div>
  )
}
