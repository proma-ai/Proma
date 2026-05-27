/**
 * PreviewPanel — 内联预览/Diff 面板
 *
 * 嵌入 AgentView 右侧，始终显示当前选中文件的 diff。
 * Agent 修改文件时自动切换到最新修改的文件。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useAtom } from 'jotai'
import { Maximize2, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  previewPanelOpenMapAtom,
  previewFileMapAtom,
} from '@/atoms/preview-atoms'
import {
  agentSessionPathMapAtom,
} from '@/atoms/agent-atoms'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { DiffTabContent } from './DiffTabContent'
import { DefaultAppOpenButton } from './DefaultAppOpenButton'

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

  const handleOpenDetachedPreview = React.useCallback(() => {
    if (!currentFile) return
    const lastSep = Math.max(currentFile.filePath.lastIndexOf('/'), currentFile.filePath.lastIndexOf('\\'))
    const fallbackDirPath = lastSep > 0 ? currentFile.filePath.slice(0, lastSep) : sessionPath
    window.electronAPI.openDetachedPreview({
      sessionId,
      filePath: currentFile.filePath,
      dirPath: currentFile.dirPath || sessionPath || fallbackDirPath,
      gitRoot: currentFile.gitRoot,
      previewOnly: currentFile.previewOnly,
      readOnly: currentFile.readOnly,
      basePaths: currentFile.basePaths,
      title: currentFile.filePath.split(/[\\/]/).pop(),
    }).catch((err) => {
      console.error('[PreviewPanel] 打开独立预览窗口失败:', err)
    })
  }, [currentFile, sessionId, sessionPath])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-content-area titlebar-no-drag">
      {/* 顶部栏：文件名 + 关闭 */}
      <div className="flex items-center h-[34px] px-3 flex-shrink-0 border-b border-border/30 titlebar-no-drag">
        <span className="text-xs text-muted-foreground truncate">
          {currentFile ? currentFile.filePath.split(/[\\/]/).pop() : '文件预览'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {currentFile && (
            <DefaultAppOpenButton
              filePath={currentFile.filePath}
              access={{ sessionId, candidateBasePaths: currentFile.basePaths }}
            />
          )}
          {currentFile && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleOpenDetachedPreview}
                  className="flex items-center justify-center size-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                  aria-label="在单独窗口打开预览"
                >
                  <Maximize2 className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>在单独窗口打开预览</p>
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleClosePanel}
                className="flex items-center justify-center size-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                aria-label="关闭预览面板"
              >
                <X className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>关闭预览面板 ({getAcceleratorDisplay(getActiveAccelerator('toggle-preview-panel'))})</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {currentFile ? (
          <DiffTabContent
            key={`${sessionId}:${currentFile.filePath}`}
            filePath={currentFile.filePath}
            dirPath={currentFile.dirPath || sessionPath}
            sessionId={sessionId}
            gitRoot={currentFile.gitRoot}
            previewOnly={currentFile.previewOnly}
            readOnly={currentFile.readOnly}
            basePaths={currentFile.basePaths}
            onEmptyDiff={handleClosePanel}
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
