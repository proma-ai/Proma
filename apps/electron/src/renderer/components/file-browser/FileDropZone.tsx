/**
 * FileDropZone — 文件拖拽上传区域
 *
 * 引导用户通过拖拽或点击将文件添加到 Agent 会话目录或工作区文件目录。
 * 文件上传后直接保存到目标目录，FileBrowser 通过版本号自动刷新。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Upload, File, FolderPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fileToBase64 } from '@/lib/file-utils'

interface FileDropZoneProps {
  /** 当前工作区 slug（用于 IPC 调用） */
  workspaceSlug: string
  /** 当前会话 ID（session 模式必传） */
  sessionId?: string
  /** 上传目标：session（会话目录）或 workspace（工作区文件目录） */
  target?: 'session' | 'workspace'
  /** 上传成功后的回调（触发文件浏览器刷新） */
  onFilesUploaded: () => void
  /** 附加文件夹回调（点击按钮时打开对话框） */
  onAttachFolder?: () => void
  /** 拖拽文件夹回调（拖拽放下文件夹时直接附加） */
  onFoldersDropped?: (folderPaths: string[]) => void
}

export function FileDropZone({ workspaceSlug, sessionId, target = 'session', onFilesUploaded, onAttachFolder, onFoldersDropped }: FileDropZoneProps): React.ReactElement {
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)

  const isWorkspace = target === 'workspace'

  /** 保存文件到目标目录 */
  const saveFiles = React.useCallback(async (files: globalThis.File[]): Promise<void> => {
    if (files.length === 0) return

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

  // ===== 拖拽处理 =====

  const handleDragOver = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = React.useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    // 通过 preload 的 webUtils.getPathForFile 获取真实路径
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
        // 通过主进程检测目录 vs 文件
        const { directories, files: filePaths } = await window.electronAPI.checkPathsType(paths)

        if (directories.length > 0) {
          if (onFoldersDropped) {
            onFoldersDropped(directories)
          } else {
            toast.info('不支持拖拽文件夹', { description: '请使用「附加文件夹」按钮' })
          }
        }

        const regularFiles = filePaths.map((p) => pathMap.get(p)!).filter(Boolean)
        if (regularFiles.length > 0) {
          await saveFiles(regularFiles)
        }
      } catch (error) {
        console.error('[FileDropZone] 路径检测失败，回退处理:', error)
        await saveFiles(droppedFiles)
      }
    } else {
      // 无路径信息：回退，所有项按普通文件处理
      await saveFiles(droppedFiles)
    }
  }, [saveFiles, onFoldersDropped])

  // ===== 按钮点击处理 =====

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

  return (
    <div className="flex-shrink-0 px-3 pt-3 pb-1">
      <div
        className={cn(
          'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-4',
          'transition-colors duration-200 cursor-default',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/20 hover:border-muted-foreground/40',
          isUploading && 'pointer-events-none opacity-60',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isUploading ? (
          <>
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
            <span className="text-xs text-muted-foreground">正在上传...</span>
          </>
        ) : (
          <>
            <Upload className={cn(
              'size-5 transition-colors',
              isDragOver ? 'text-primary' : 'text-muted-foreground/75',
            )} />
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              拖拽文件到此处
              <br />
              <span className="text-[10px] text-muted-foreground/75">
                {isWorkspace ? '工作区内所有会话可访问' : '供 Agent 读取和处理'}
              </span>
            </p>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2 gap-1 text-muted-foreground hover:text-foreground"
                    onClick={handleSelectFiles}
                  >
                    <File className="size-3" />
                    选择文件
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{isWorkspace ? '添加文件到工作区文件目录' : '将文件放入 Agent 工作文件夹'}</p>
                </TooltipContent>
              </Tooltip>
              {onAttachFolder && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] px-2 gap-1 text-muted-foreground hover:text-foreground"
                      onClick={onAttachFolder}
                    >
                      <FolderPlus className="size-3" />
                      附加文件夹
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{isWorkspace ? '附加文件夹供工作区所有会话访问' : '告知 Agent 你想处理的文件夹'}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
