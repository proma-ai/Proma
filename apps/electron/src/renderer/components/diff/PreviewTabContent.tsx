/**
 * PreviewTabContent — 会话绑定的临时预览 Tab。
 *
 * 复用内联预览的 PreviewFile 状态和 DiffTabContent 编辑能力，但不参与 Tab 持久化。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { PanelRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  agentSessionPathMapAtom,
} from '@/atoms/agent-atoms'
import {
  createPreviewTabId,
  getFileBaseName,
  getPreviewTabTitle,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { previewFileMapAtom } from '@/atoms/preview-atoms'
import { tearOffPreviewToSplit } from './preview-opener'
import { DefaultAppOpenButton } from './DefaultAppOpenButton'
import { DiffTabContent } from './DiffTabContent'
import { getDefaultAppTargetPath, getPreviewFileAccess } from './preview-open-path'

/** 切换为侧边分屏的小按钮 — 与拖拽 Tab 出 TabBar 触发的 tear-off 等价 */
function TearOffButton({ sessionId }: { sessionId: string }): React.ReactElement {
  const store = useStore()
  const onClick = React.useCallback(() => {
    tearOffPreviewToSplit(store, createPreviewTabId(sessionId))
  }, [store, sessionId])
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="flex items-center justify-center size-7 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
          aria-label="切换为侧边分屏"
        >
          <PanelRight className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>切换为侧边分屏（保留会话 Tab，文件预览移到右侧）</p>
      </TooltipContent>
    </Tooltip>
  )
}

interface PreviewTabContentProps {
  sessionId: string
}

function getFallbackDirPath(filePath: string, sessionPath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSep > 0 ? filePath.slice(0, lastSep) : sessionPath
}

export function PreviewTabContent({ sessionId }: PreviewTabContentProps): React.ReactElement {
  const fileMap = useAtomValue(previewFileMapAtom)
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const setTabs = useSetAtom(tabsAtom)

  const currentFile = fileMap.get(sessionId) ?? null
  const sessionPath = sessionPathMap.get(sessionId) ?? ''
  const fileName = currentFile ? getFileBaseName(currentFile.filePath) : '文件预览'

  React.useEffect(() => {
    const previewTabId = createPreviewTabId(sessionId)
    const title = getPreviewTabTitle(fileName)
    setTabs((prev) => {
      let changed = false
      const next = prev.map((tab) => {
        if (tab.id !== previewTabId || tab.title === title) return tab
        changed = true
        return { ...tab, title }
      })
      return changed ? next : prev
    })
  }, [fileName, sessionId, setTabs])

  if (!currentFile) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-content-area">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/30 px-3">
          <div className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
            预览已关闭
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          当前会话没有可预览的文件
        </div>
      </div>
    )
  }

  const dirPath = currentFile.dirPath || sessionPath || getFallbackDirPath(currentFile.filePath, sessionPath)
  const defaultAppTargetPath = getDefaultAppTargetPath(currentFile, sessionPath)
  const defaultAppAccess = getPreviewFileAccess(sessionId, currentFile, sessionPath)
  const toolbarActions = (
    <>
      <DefaultAppOpenButton
        filePath={defaultAppTargetPath}
        access={defaultAppAccess}
      />
      <TearOffButton sessionId={sessionId} />
    </>
  )

  return (
    <div className="flex h-full flex-col overflow-hidden bg-content-area">
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffTabContent
          key={`${sessionId}:${currentFile.filePath}`}
          filePath={currentFile.filePath}
          dirPath={dirPath}
          sessionId={sessionId}
          gitRoot={currentFile.gitRoot}
          previewOnly={currentFile.previewOnly}
          readOnly={currentFile.readOnly}
          basePaths={currentFile.basePaths}
          baseRef={currentFile.baseRef}
          toolbarActions={toolbarActions}
        />
      </div>
    </div>
  )
}
