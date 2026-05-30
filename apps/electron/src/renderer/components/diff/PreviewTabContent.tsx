/**
 * PreviewTabContent — 会话绑定的临时预览 Tab。
 *
 * 复用内联预览的 PreviewFile 状态和 DiffTabContent 编辑能力，但不参与 Tab 持久化。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
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
import { DefaultAppOpenButton } from './DefaultAppOpenButton'
import { DiffTabContent } from './DiffTabContent'
import { getDefaultAppTargetPath, getPreviewFileAccess } from './preview-open-path'

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
