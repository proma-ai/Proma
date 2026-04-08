/**
 * AttachmentPreviewItem - 附件预览卡片
 *
 * 对标 Cherry Studio 的 AttachmentPreview 风格：
 * - 图片：紧凑缩略图 + 圆角
 * - 非图片：teal 色标签 + 文件名截断
 * - hover 显示关闭按钮
 */

import * as React from 'react'
import { X, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageLightbox } from '@/components/ui/image-lightbox'

interface AttachmentPreviewItemProps {
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** 本地预览 URL（blob URL / data URL，图片用） */
  previewUrl?: string
  /** 删除回调 */
  onRemove: () => void
  className?: string
}

/** 判断是否为图片类型 */
function isImage(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

/** 截断文件名显示 */
function truncateName(name: string, max: number = 20): string {
  return name.length > max ? name.slice(0, max - 3) + '...' : name
}

export function AttachmentPreviewItem({
  filename,
  mediaType,
  previewUrl,
  onRemove,
  className,
}: AttachmentPreviewItemProps): React.ReactElement {
  const [lightboxOpen, setLightboxOpen] = React.useState(false)

  if (isImage(mediaType) && previewUrl) {
    // 图片预览 — 紧凑缩略图，点击可预览大图
    return (
      <div
        className={cn(
          'group/attachment relative size-[72px] shrink-0 rounded-lg overflow-hidden',
          className
        )}
      >
        <img
          src={previewUrl}
          alt={filename}
          className="size-full object-cover cursor-pointer"
          onClick={() => setLightboxOpen(true)}
        />
        {/* hover 关闭按钮 */}
        <button
          type="button"
          onClick={onRemove}
          className={cn(
            'absolute top-1 right-1 size-[18px] rounded-full',
            'bg-black/50 text-white backdrop-blur-sm',
            'flex items-center justify-center',
            'opacity-0 group-hover/attachment:opacity-100 transition-opacity duration-200',
            'hover:bg-black/70'
          )}
        >
          <X className="size-3" />
        </button>
        <ImageLightbox
          src={previewUrl}
          alt={filename}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
      </div>
    )
  }

  // 文件预览 — teal 标签样式（对标 Cherry Studio）
  return (
    <div
      className={cn(
        'group/attachment relative flex items-center gap-2 shrink-0',
        'rounded-lg bg-[#37a5aa]/10 border border-[#37a5aa]/20',
        'pl-2.5 pr-7 py-1.5 text-[13px] text-[#37a5aa]',
        'transition-colors hover:bg-[#37a5aa]/15',
        className
      )}
    >
      <Paperclip className="size-4 shrink-0" />
      <span className="max-w-[160px] truncate">{truncateName(filename)}</span>
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'absolute top-1/2 right-1.5 -translate-y-1/2 size-[18px] rounded-full',
          'flex items-center justify-center',
          'text-[#37a5aa]/60 hover:text-[#37a5aa] hover:bg-[#37a5aa]/20',
          'opacity-0 group-hover/attachment:opacity-100 transition-all duration-200'
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
