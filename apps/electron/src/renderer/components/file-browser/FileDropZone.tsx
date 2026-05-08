/**
 * FileDropZone — 文件拖拽上传区域
 *
 * 两个并排 drop zone：左侧接受文件上传（回形针），右侧接受文件夹附加（文件夹）。
 * 拖错区域会给出引导提示。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Paperclip, FolderPlus, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fileToBase64 } from '@/lib/file-utils'

interface FileDropZoneProps {
  workspaceSlug: string
  sessionId?: string
  target?: 'session' | 'workspace'
  onFilesUploaded: () => void
  onAttachFolder: () => void
  onFoldersDropped: (folderPaths: string[]) => void
}

export function FileDropZone({ workspaceSlug, sessionId, target = 'session', onFilesUploaded, onAttachFolder, onFoldersDropped }: FileDropZoneProps): React.ReactElement {
  const [isDragOver, setIsDragOver] = React.useState<'left' | 'right' | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)

  const isWorkspace = target === 'workspace'

  const saveFiles = React.useCallback(async (files: globalThis.File[]): Promise<void> => {
    if (files.length === 0) return
    if (!isWorkspace && !sessionId) {
      console.error('[FileDropZone] session 模式下 sessionId 不能为空')
      return
    }

    setIsUploading(true)
    try {
      const fileEntries: Array<{ filename: string; data: string }> = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        fileEntries.push({ filename: file.name, data: base64 })
      }

      if (isWorkspace) {
        await window.electronAPI.saveFilesToWorkspaceFiles({
          workspaceSlug,
          files: fileEntries,
        })
      } else {
        await window.electronAPI.saveFilesToAgentSession({
          workspaceSlug,
          sessionId: sessionId!,
          files: fileEntries,
        })
      }

      onFilesUploaded()
      toast.success(`已添加 ${files.length} 个文件`)
    } catch (error) {
      console.error('[FileDropZone] 文件上传失败:', error)
      toast.error('文件上传失败')
    } finally {
      setIsUploading(false)
    }
  }, [workspaceSlug, sessionId, isWorkspace, onFilesUploaded])

  const handleDrop = React.useCallback(async (e: React.DragEvent, side: 'left' | 'right'): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(null)
    if (isUploading) return

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) {
      if (side === 'right') {
        toast.info('无法识别拖入的内容，请使用按钮选择文件夹')
      }
      return
    }

    const pathMap = new Map<string, globalThis.File>()
    const paths: string[] = []
    for (const f of droppedFiles) {
      try {
        const p = window.electronAPI.getPathForFile(f)
        if (p) {
          paths.push(p)
          pathMap.set(p, f)
        }
      } catch { /* 无法获取路径时忽略 */ }
    }

    if (paths.length > 0) {
      try {
        const { directories, files: filePaths } = await window.electronAPI.checkPathsType(paths)

        // 左侧：只上传文件，忽略目录
        if (side === 'left') {
          if (directories.length > 0) {
            toast.info('文件夹请拖到右侧「附加文件夹」区')
          }
          const regularFiles = filePaths.flatMap((p) => {
            const f = pathMap.get(p)
            return f ? [f] : []
          })
          if (regularFiles.length > 0) {
            await saveFiles(regularFiles)
          }
        } else {
          // 右侧：只附加文件夹，不上传文件
          if (filePaths.length > 0) {
            toast.info('文件请拖到左侧「添加文件」区')
          }
          if (directories.length > 0) {
            onFoldersDropped(directories)
          }
        }
      } catch (error) {
        console.error('[FileDropZone] 路径检测失败，回退处理:', error)
        if (side === 'left') {
          await saveFiles(droppedFiles)
        } else {
          toast.warning('无法识别文件夹，请使用按钮选择')
        }
      }
    } else {
      if (side === 'left') {
        await saveFiles(droppedFiles)
      } else {
        toast.warning('无法识别文件夹，请使用按钮选择')
      }
    }
  }, [saveFiles, onFoldersDropped, isUploading])

  const handleDragOver = React.useCallback((e: React.DragEvent, side: 'left' | 'right'): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(side)
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    // 如果光标仍在同级容器内（切换到兄弟 zone），不清空 state；
    // 兄弟 zone 的 dragover 会把 side 切到正确值，避免 1 帧闪烁。
    const related = e.relatedTarget as Node | null
    const container = (e.currentTarget as HTMLElement).parentElement
    if (related && container && container.contains(related)) return
    setIsDragOver(null)
  }, [])

  const handleSelectFiles = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return

      setIsUploading(true)
      const fileEntries = result.files.map((f) => ({
        filename: f.filename,
        data: f.data,
      }))

      if (isWorkspace) {
        await window.electronAPI.saveFilesToWorkspaceFiles({
          workspaceSlug,
          files: fileEntries,
        })
      } else {
        await window.electronAPI.saveFilesToAgentSession({
          workspaceSlug,
          sessionId: sessionId!,
          files: fileEntries,
        })
      }

      onFilesUploaded()
      toast.success(`已添加 ${result.files.length} 个文件`)
    } catch (error) {
      console.error('[FileDropZone] 选择文件失败:', error)
      toast.error('文件上传失败')
    } finally {
      setIsUploading(false)
    }
  }, [workspaceSlug, sessionId, isWorkspace, onFilesUploaded])

  const zoneClass = (side: 'left' | 'right'): string =>
    cn(
      'flex-1 flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2.5 transition-colors duration-200 cursor-pointer',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      isDragOver === side
        ? 'bg-primary/25 ring-2 ring-primary/50'
        : 'bg-muted/40 hover:bg-muted/70',
      isUploading && 'pointer-events-none opacity-60',
    )

  const activateOnKey = (fn: () => void) => (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

  return (
    <div className="flex gap-2 px-3 pt-2 pb-1.5 flex-shrink-0">
      {isUploading ? (
        <div className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在上传...
        </div>
      ) : (
        <>
          {/* 添加文件 */}
          <Tooltip open={isDragOver === 'left' ? false : undefined}>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                aria-label={isWorkspace ? '添加文件到工作区文件目录' : '添加文件到会话文件夹'}
                className={zoneClass('left')}
                onDragOver={(e) => handleDragOver(e, 'left')}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, 'left')}
                onClick={handleSelectFiles}
                onKeyDown={activateOnKey(handleSelectFiles)}
              >
                <span className="text-[11px] text-muted-foreground/75">添加文件</span>
                <Paperclip className="size-4 text-muted-foreground/60" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{isWorkspace ? '添加文件到工作区文件目录' : '将文件放入 Agent 工作文件夹'}</p>
            </TooltipContent>
          </Tooltip>
          {/* 附加文件夹 */}
          <Tooltip open={isDragOver === 'right' ? false : undefined}>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                aria-label={isWorkspace ? '附加文件夹到工作区' : '附加文件夹到会话'}
                className={zoneClass('right')}
                onDragOver={(e) => handleDragOver(e, 'right')}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, 'right')}
                onClick={onAttachFolder}
                onKeyDown={activateOnKey(onAttachFolder)}
              >
                <span className="text-[11px] text-muted-foreground/75">附加文件夹</span>
                <FolderPlus className="size-4 text-muted-foreground/60" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{isWorkspace ? '附加文件夹供工作区所有会话访问' : '告知 Agent 你想处理的文件夹'}</p>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  )
}
