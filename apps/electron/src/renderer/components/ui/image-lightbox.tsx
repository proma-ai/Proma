/**
 * ImageLightbox - 图片预览弹窗
 *
 * 全屏图片预览：点击图片打开，点击遮罩层或按 Esc 关闭。
 * 遮罩层与 Dialog 完全统一，操作按钮收拢到图片正下方的悬浮岛。
 * 支持编辑模式（裁剪/旋转/绘制），编辑后可发送到对话。
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Download, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageEditor } from '@/components/ui/image-editor'

interface ImageLightboxProps {
  /** 图片 src（data URL 或普通 URL） */
  src: string | null
  /** 图片 alt / 文件名 */
  alt?: string
  /** 是否打开 */
  open: boolean
  /** 关闭回调 */
  onOpenChange: (open: boolean) => void
  /** 下载回调（可选） */
  onSave?: () => void
  /** 编辑完成回调 — 提供则显示编辑按钮 */
  onEditComplete?: (editedDataUrl: string) => void
}

export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
  onSave,
  onEditComplete,
}: ImageLightboxProps): React.ReactElement | null {
  const [mode, setMode] = React.useState<'preview' | 'editing'>('preview')

  // 关闭时重置模式
  React.useEffect(() => {
    if (!open) setMode('preview')
  }, [open])

  // hooks 必须在条件 return 前声明，以遵守 React 规则（src 为 prop，值在渲染间不变）
  if (!src) return null

  const handleEditSave = (editedDataUrl: string) => {
    onEditComplete?.(editedDataUrl)
    onOpenChange(false)
    setMode('preview')
  }

  const handleEditCancel = () => {
    setMode('preview')
  }

  const showEdit = !!onEditComplete

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* 遮罩层 — 与 DialogOverlay 完全一致 */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[200] bg-black/40 titlebar-no-drag',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 z-[200] flex flex-col items-center justify-center titlebar-no-drag',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-200'
          )}
          onClick={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false)
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {alt || '图片预览'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            预览图片：{alt || '图片'}
          </DialogPrimitive.Description>

          {/* 双层都占位 — visibility 切换，无 unmount，Grid 单格叠加 */}
          <div className="grid" style={{ gridTemplate: '"layer" 1fr / 1fr' }}>
            {/* 预览层 */}
            <div style={{ gridArea: 'layer', visibility: mode === 'editing' ? 'hidden' : 'visible' }}>
              <div className="flex flex-col items-center">
              <img
                src={src}
                alt={alt}
                className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain shadow-2xl select-none"
                draggable={false}
              />
              <div className={cn(
                'mt-3 flex items-center gap-0.5 rounded-full',
                'bg-black/50 backdrop-blur-md shadow-lg',
                'px-3 py-2.5'
              )}>
                <DialogPrimitive.Close className={cn('rounded-full p-1.5 text-white/80 transition-colors duration-150', 'hover:bg-white/15 hover:text-white', 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black')}>
                  <X className="size-5" /><span className="sr-only">关闭</span>
                </DialogPrimitive.Close>
                {showEdit && (<><div className="mx-1.5 h-5 w-px bg-white/20" aria-hidden /><button type="button" onClick={() => setMode('editing')} className={cn('rounded-full p-1.5 text-white/80 transition-colors duration-150', 'hover:bg-white/15 hover:text-white', 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black')} title="编辑图片"><Pencil className="size-5" /></button></>)}
                {onSave && (<><div className="mx-1.5 h-5 w-px bg-white/20" aria-hidden /><button type="button" onClick={onSave} className={cn('rounded-full p-1.5 text-white/80 transition-colors duration-150', 'hover:bg-white/15 hover:text-white', 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black')} title="保存图片"><Download className="size-5" /></button></>)}
              </div>
              </div>
            </div>

            {/* 编辑层 */}
            <div style={{ gridArea: 'layer', visibility: mode === 'preview' ? 'hidden' : 'visible' }}>
              <ImageEditor src={src} onSave={handleEditSave} onCancel={handleEditCancel} />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
