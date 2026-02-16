import * as React from 'react'
import { cn } from '@/lib/utils'

interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 尺寸（通过 font-size 控制）
   * @default 'default' (1.5em)
   */
  size?: 'sm' | 'default' | 'lg'
}

/**
 * Spinner - 3x3 网格加载动画
 *
 * 基于 SpinKit Grid 动画实现。使用 em 单位，随 font-size 缩放。
 *
 * @example
 * ```tsx
 * <Spinner size="sm" className="text-muted-foreground/60" />
 * ```
 */
export function Spinner({
  size = 'default',
  className,
  ...props
}: SpinnerProps): React.ReactElement {
  const sizeClasses = {
    sm: 'text-sm',      // 14px → spinner 约 21px
    default: 'text-base', // 16px → spinner 约 24px
    lg: 'text-lg',      // 18px → spinner 约 27px
  }

  return (
    <div
      className={cn(
        'spinner text-muted-foreground',
        sizeClasses[size],
        className
      )}
      role="status"
      aria-label="加载中"
      {...props}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="spinner-cube" />
      ))}
    </div>
  )
}
