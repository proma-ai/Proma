/**
 * ImageLightbox - 图片预览弹窗
 *
 * 全屏图片预览：点击图片打开，点击遮罩层或按 Esc 关闭。
 * 遮罩层与 Dialog 完全统一，操作按钮收拢到图片正下方的悬浮岛。
 * 支持编辑模式（裁剪/旋转/绘制），编辑后可发送到对话。
 *
 * 多图导航（可选）：传入 images + index + onIndexChange 后，可在同一批图片间
 * 左右翻页（‹ › 按钮 / 方向键，首尾循环）。不传 images 时回退为单图行为，
 * 完全向后兼容。
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, Download, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageEditor } from '@/components/ui/image-editor'

/** 单张图片描述（多图导航时使用） */
export interface LightboxImage {
  /** 图片 src（data URL 或普通 URL） */
  src: string
  /** 图片 alt / 文件名 */
  alt?: string
  /** 下载回调（可选） */
  onSave?: () => void
  /** 编辑完成回调 — 提供则显示编辑按钮 */
  onEditComplete?: (editedDataUrl: string) => void
}

interface ImageLightboxProps {
  /** 图片 src（data URL 或普通 URL）— 单图模式使用 */
  src?: string | null
  /** 图片 alt / 文件名 */
  alt?: string
  /** 是否打开 */
  open: boolean
  /** 关闭回调 */
  onOpenChange: (open: boolean) => void
  /** 下载回调（可选，单图模式） */
  onSave?: () => void
  /** 编辑完成回调 — 提供则显示编辑按钮（单图模式） */
  onEditComplete?: (editedDataUrl: string) => void
  /** 多图列表（可选）— 提供则启用左右翻页 */
  images?: LightboxImage[]
  /** 当前展示的图片索引（多图模式，受控） */
  index?: number
  /** 翻页回调（多图模式） */
  onIndexChange?: (nextIndex: number) => void
  /** 打开时的初始模式（默认 'preview'） */
  initialMode?: 'preview' | 'editing'
}

export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
  onSave,
  onEditComplete,
  images,
  index,
  onIndexChange,
  initialMode = 'preview',
}: ImageLightboxProps): React.ReactElement | null {
  const [mode, setMode] = React.useState<'preview' | 'editing'>('preview')

  const hasImages = Array.isArray(images) && images.length > 0
  const total = hasImages ? images!.length : 0
  const hasMultiple = total > 1
  const safeIndex = hasImages ? Math.min(Math.max(index ?? 0, 0), total - 1) : 0

  React.useEffect(() => {
    if (open) setMode(initialMode)
    else setMode('preview')
  }, [open, initialMode])

  // 多图模式下监听方向键翻页（编辑模式禁用）
  React.useEffect(() => {
    if (!open || mode !== 'preview' || !hasMultiple || !onIndexChange) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        onIndexChange((safeIndex - 1 + total) % total)
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        onIndexChange((safeIndex + 1) % total)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, mode, hasMultiple, onIndexChange, safeIndex, total])

  // 当前展示的图片：多图取 images[index]，否则回退单图 src（值在渲染间不变，hooks 已在前声明）
  const current: LightboxImage | null = hasImages
    ? images![safeIndex] ?? null
    : src
      ? { src, alt, onSave, onEditComplete }
      : null
  if (!current) return null

  const handleEditSave = (editedDataUrl: string): void => {
    current.onEditComplete?.(editedDataUrl)
    onOpenChange(false)
    setMode('preview')
  }

  const handleEditCancel = (): void => {
    if (initialMode === 'editing') {
      onOpenChange(false)
    } else {
      setMode('preview')
    }
  }

  const goPrev = (): void => onIndexChange?.((safeIndex - 1 + total) % total)
  const goNext = (): void => onIndexChange?.((safeIndex + 1) % total)

  const showEdit = !!current.onEditComplete
  const showNav = mode === 'preview' && hasMultiple
  const navBtn = cn(
    'absolute top-1/2 -translate-y-1/2 z-10 rounded-full p-2',
    'bg-black/50 text-white/80 backdrop-blur-md shadow-lg transition-colors duration-150',
    'hover:bg-black/70 hover:text-white',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black'
  )

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
            {current.alt || '图片预览'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            预览图片：{current.alt || '图片'}
          </DialogPrimitive.Description>

          {/* 翻页按钮（多图，预览模式） */}
          {showNav && (
            <>
              <button type="button" onClick={goPrev} className={cn(navBtn, 'left-4')} title="上一张">
                <ChevronLeft className="size-6" /><span className="sr-only">上一张</span>
              </button>
              <button type="button" onClick={goNext} className={cn(navBtn, 'right-4')} title="下一张">
                <ChevronRight className="size-6" /><span className="sr-only">下一张</span>
              </button>
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/50 px-3 py-1 text-xs text-white/90 backdrop-blur-md">
                {safeIndex + 1} / {total}
              </div>
            </>
          )}

          {/* 双层都占位 — visibility 切换，无 unmount，Grid 单格叠加 */}
          <div className="grid" style={{ gridTemplate: '"layer" 1fr / 1fr' }}>
            {/* 预览层 */}
            <div style={{ gridArea: 'layer', visibility: mode === 'editing' ? 'hidden' : 'visible' }}>
              <div className="flex flex-col items-center">
              <img
                src={current.src}
                alt={current.alt}
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
                {current.onSave && (<><div className="mx-1.5 h-5 w-px bg-white/20" aria-hidden /><button type="button" onClick={current.onSave} className={cn('rounded-full p-1.5 text-white/80 transition-colors duration-150', 'hover:bg-white/15 hover:text-white', 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black')} title="保存图片"><Download className="size-5" /></button></>)}
              </div>
              </div>
            </div>

            {/* 编辑层 */}
            <div style={{ gridArea: 'layer', visibility: mode === 'preview' ? 'hidden' : 'visible' }}>
              <ImageEditor src={current.src} onSave={handleEditSave} onCancel={handleEditCancel} />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
