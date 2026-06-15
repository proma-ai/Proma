/**
 * PreviewPanel — 内联预览/Diff 面板
 *
 * 嵌入 AgentView 右侧，始终显示当前选中文件的 diff。
 * Agent 修改文件时自动切换到最新修改的文件。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Maximize2, PanelRight, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  previewPanelOpenMapAtom,
  previewFileMapAtom,
  previewModePreferenceAtom,
} from '@/atoms/preview-atoms'
import {
  agentSessionPathMapAtom,
  currentSessionSidePanelOpenAtom,
} from '@/atoms/agent-atoms'
import {
  activeTabIdAtom,
  getPreviewTabTitle,
  openTab,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { detectIsWindows } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { DiffTabContent } from './DiffTabContent'
import { DefaultAppOpenButton } from './DefaultAppOpenButton'
import { getDefaultAppTargetPath, getPreviewFileAccess } from './preview-open-path'

interface PreviewPanelProps {
  sessionId: string
}

const WINDOWS_WINDOW_CONTROLS_SAFE_AREA = 126

export function PreviewPanel({ sessionId }: PreviewPanelProps): React.ReactElement {
  const fileMap = useAtomValue(previewFileMapAtom)
  const setOpenMap = useSetAtom(previewPanelOpenMapAtom)
  const tabs = useAtomValue(tabsAtom)
  const setTabs = useSetAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const isSidePanelOpen = useAtomValue(currentSessionSidePanelOpenAtom)
  const [previewModePref, setPreviewModePref] = useAtom(previewModePreferenceAtom)

  const currentFile = fileMap.get(sessionId) ?? null

  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? ''
  const isWindows = React.useMemo(() => detectIsWindows(), [])
  const useStackedWindowsHeader = isWindows && !isSidePanelOpen

  const handleClosePanel = React.useCallback(() => {
    setOpenMap((prev) => { const m = new Map(prev); m.set(sessionId, false); return m })
  }, [sessionId, setOpenMap])

  const handleOpenPreviewTab = React.useCallback(() => {
    if (!currentFile) return
    const result = openTab(tabs, {
      type: 'preview',
      sessionId,
      title: getPreviewTabTitle(currentFile.filePath),
    })
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)
    setOpenMap((prev) => {
      const m = new Map(prev)
      m.set(sessionId, false)
      return m
    })
  }, [currentFile, sessionId, setActiveTabId, setOpenMap, setTabs, tabs])

  const fileName = currentFile ? currentFile.filePath.split(/[\\/]/).pop() || currentFile.filePath : '文件预览'
  const defaultAppTargetPath = currentFile ? getDefaultAppTargetPath(currentFile, sessionPath) : ''
  const defaultAppAccess = currentFile ? getPreviewFileAccess(sessionId, currentFile, sessionPath) : undefined

  const renderPreviewActions = (): React.ReactElement => (
    <div className="ml-auto flex items-center gap-0.5 shrink-0">
      {currentFile && (
        <DefaultAppOpenButton
          filePath={defaultAppTargetPath}
          access={defaultAppAccess}
        />
      )}
      {currentFile && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setPreviewModePref((p) => (p === 'split' ? 'tab' : 'split'))}
              className={cn(
                'flex items-center justify-center size-6 shrink-0 rounded transition-colors',
                previewModePref === 'split'
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              aria-label={previewModePref === 'split' ? '默认展开方式：侧边分屏，点击改为标签页' : '默认展开方式：标签页，点击改为侧边分屏'}
            >
              <PanelRight className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>
              {previewModePref === 'split'
                ? '默认展开方式：侧边分屏 · 点击改为「标签页」（仅影响下次打开，不改变当前预览）'
                : '默认展开方式：标签页 · 点击改为「侧边分屏」（仅影响下次打开，不改变当前预览）'}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
      {currentFile && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleOpenPreviewTab}
              className="flex items-center justify-center size-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
              aria-label="作为标签页打开预览"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>作为标签页打开预览</p>
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
  )

  return (
    <div className="flex flex-col h-full overflow-hidden bg-content-area titlebar-no-drag">
      {/* 顶部栏：文件名 + 预览操作 */}
      <div className={cn('flex-shrink-0 border-b border-border/30 titlebar-no-drag', useStackedWindowsHeader && 'bg-content-area')}>
        {useStackedWindowsHeader ? (
          <>
            <div
              className="flex items-center h-[34px] pl-3"
              style={{ paddingRight: WINDOWS_WINDOW_CONTROLS_SAFE_AREA }}
            >
              <span className="text-xs text-muted-foreground truncate">
                {fileName}
              </span>
            </div>
            <div className="flex items-center h-[30px] px-3 border-t border-border/20 bg-muted/20">
              {renderPreviewActions()}
            </div>
          </>
        ) : (
          <div className="flex items-center h-[34px] px-3">
            <span className="text-xs text-muted-foreground truncate">
              {fileName}
            </span>
            {renderPreviewActions()}
          </div>
        )}
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
            baseRef={currentFile.baseRef}
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
