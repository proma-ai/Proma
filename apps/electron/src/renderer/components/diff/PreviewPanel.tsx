/** 右侧工作区中的单个文件预览内容。标题与关闭由外层动态 Tab 承担。 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { PreviewFile } from '@/atoms/preview-atoms'
import { agentSessionPathMapAtom } from '@/atoms/agent-atoms'
import { DiffTabContent } from './DiffTabContent'
import { PreviewContentErrorBoundary } from './PreviewContentErrorBoundary'

interface PreviewPanelProps {
  sessionId: string
  file: PreviewFile
  onClose: () => void
}

export function PreviewPanel({ sessionId, file, onClose }: PreviewPanelProps): React.ReactElement {
  const sessionPath = useAtomValue(agentSessionPathMapAtom).get(sessionId) ?? ''
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-content-area titlebar-no-drag">
      <div className="min-h-0 flex-1 overflow-hidden">
        <PreviewContentErrorBoundary resetKey={`${sessionId}:${file.filePath}`}>
          <DiffTabContent
            key={`${sessionId}:${file.filePath}`}
            filePath={file.filePath}
            dirPath={file.dirPath || sessionPath}
            sessionId={sessionId}
            gitRoot={file.gitRoot}
            previewOnly={file.previewOnly}
            readOnly={file.readOnly}
            basePaths={file.basePaths}
            workspaceSkillSlug={file.workspaceSkillSlug}
            legacySkillFilePath={file.legacySkillFilePath}
            baseRef={file.baseRef}
            onEmptyDiff={onClose}
          />
        </PreviewContentErrorBoundary>
      </div>
    </div>
  )
}
