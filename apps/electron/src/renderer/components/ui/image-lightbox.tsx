/**
 * ImageLightbox - 图片预览弹窗
 *
 * 类似 macOS Quick Look 的全屏图片预览效果：
 * - 点击图片打开，点击遮罩层或按 Esc 关闭
 * - 深色半透明背景 + 居中大图
 * - 支持下载按钮
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Download, X } from 'lucide-react'
import { cn } from '@/lib/utils'

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
}

export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
  onSave,
}: ImageLightboxProps): React.ReactElement | null {
  if (!src) return null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* 遮罩层 — 点击关闭 */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[200] bg-black/20 titlebar-no-drag',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          )}
        />
        {/* 内容层 */}
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 z-[200] flex items-center justify-center titlebar-no-drag',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-200'
          )}
          /* 点击背景区域（非图片）关闭 */
          onClick={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false)
          }}
        >
          {/* 隐藏的标题（无障碍） */}
          <DialogPrimitive.Title className="sr-only">
            {alt || '图片预览'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            预览图片：{alt || '图片'}
          </DialogPrimitive.Description>

          {/* 大图 */}
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain shadow-2xl select-none"
            draggable={false}
          />

          {/* 右上角关闭按钮 */}
          <DialogPrimitive.Close
            className={cn(
              'absolute top-4 right-4 p-2 rounded-full',
              'bg-black/50 text-white/80 backdrop-blur-sm',
              'hover:bg-black/70 hover:text-white transition-colors',
              'focus:outline-none'
            )}
          >
            <X className="size-5" />
          </DialogPrimitive.Close>

          {/* 底部下载按钮（可选） */}
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              className={cn(
                'absolute bottom-6 right-6 p-2.5 rounded-full',
                'bg-black/50 text-white/80 backdrop-blur-sm',
                'hover:bg-black/70 hover:text-white transition-colors'
              )}
              title="保存图片"
            >
              <Download className="size-5" />
            </button>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
