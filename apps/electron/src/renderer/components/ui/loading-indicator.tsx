import * as React from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from './spinner'

/**
 * 将时长格式化为易读形式
 * @param ms 毫秒数
 * @returns 不足一分钟返回 "45s"，超过一分钟返回 "1:02"
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

interface LoadingIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 可选的标签文字，显示在 spinner 旁边 */
  label?: string
  /** 是否启用动画 */
  animated?: boolean
  /** 显示已用时间（传入开始时间戳或 true 自动追踪） */
  showElapsed?: boolean | number
  /** spinner 的额外 className（例如 "text-xs" 使其更小） */
  spinnerClassName?: string
  /** Spinner 尺寸 */
  size?: 'sm' | 'default' | 'lg'
}

/**
 * LoadingIndicator - 带可选标签和已用时间的加载指示器
 *
 * 继承父元素的文字颜色和尺寸。
 *
 * 特性:
 * - 3x3 点阵动画（纯 CSS）
 * - 可选的标签文字
 * - 可选的已用时间显示
 *
 * 使用示例:
 * ```tsx
 * // 基础 spinner
 * <LoadingIndicator />
 *
 * // 带标签
 * <LoadingIndicator label="正在思考..." />
 *
 * // 带已用时间（自动追踪）
 * <LoadingIndicator label="处理中" showElapsed />
 *
 * // 带已用时间（自定义开始时间）
 * <LoadingIndicator label="运行中" showElapsed={startTimestamp} />
 * ```
 */
export function LoadingIndicator({
  label,
  animated = true,
  showElapsed = false,
  className,
  spinnerClassName,
  size = 'default',
  ...props
}: LoadingIndicatorProps): React.ReactElement {
  const [elapsed, setElapsed] = React.useState(0)
  const startTimeRef = React.useRef<number | null>(null)

  // 已用时间追踪
  React.useEffect(() => {
    if (!showElapsed) return

    // 初始化开始时间
    if (typeof showElapsed === 'number') {
      startTimeRef.current = showElapsed
    } else if (!startTimeRef.current) {
      startTimeRef.current = Date.now()
    }

    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsed(Date.now() - startTimeRef.current)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [showElapsed])

  return (
    <span className={cn('inline-flex items-center gap-2', className)} {...props}>
      {/* 加载动画 */}
      {animated ? (
        <Spinner size={size} className={spinnerClassName} />
      ) : (
        <span className="inline-flex items-center justify-center w-[1em] h-[1em]">
          ●
        </span>
      )}

      {/* 标签 */}
      {label && <span className="text-xs font-normal text-muted-foreground">{label}</span>}

      {/* 已用时间 */}
      {showElapsed && elapsed >= 1000 && (
        <span className="text-xs font-normal text-muted-foreground/60 tabular-nums">
          ({formatDuration(elapsed)})
        </span>
      )}
    </span>
  )
}
