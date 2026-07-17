/**
 * PlanModeDashedBorder — 计划模式输入框虚线边框叠加层
 *
 * 用 SVG <rect> 精确控制虚线段长和间距，绝对定位不影响布局。
 * 使用 ResizeObserver 跟踪父容器尺寸。
 */

import * as React from 'react'

const DASH_LENGTH = 9  // 每段虚线长度
const DASH_GAP = 7     // 虚线间距
const STROKE_WIDTH = 2 // 线宽
const OFFSET = 2       // 向外偏移，避免遮盖原有 border

interface BorderMetrics {
  w: number
  h: number
  radius: number
  borderWidth: number
}

export function PlanModeDashedBorder(): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = React.useState<BorderMetrics>({
    w: 0,
    h: 0,
    radius: 17,
    borderWidth: 0,
  })

  React.useEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return

    const updateMetrics = () => {
      const rect = parent.getBoundingClientRect()
      const style = window.getComputedStyle(parent)
      setMetrics({
        w: rect.width,
        h: rect.height,
        radius: Number.parseFloat(style.borderTopLeftRadius) || 17,
        borderWidth: Number.parseFloat(style.borderTopWidth) || 0,
      })
    }

    updateMetrics()
    const ro = new ResizeObserver(updateMetrics)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  const wrapperInset = -(OFFSET + metrics.borderWidth)
  const svgW = metrics.w + OFFSET * 2
  const svgH = metrics.h + OFFSET * 2
  // SVG rect 已经内缩半个 stroke，虚线中心线只比输入框实线外扩
  // OFFSET - STROKE_WIDTH / 2；圆角按同样距离外扩，保持同心。
  const dashedRadius = metrics.radius + OFFSET - STROKE_WIDTH / 2

  return (
    <div
      ref={containerRef}
      className="absolute pointer-events-none"
      style={{
        inset: wrapperInset,
        zIndex: 10,
      }}
    >
      {metrics.w > 0 && metrics.h > 0 && (
        <svg
          width={svgW}
          height={svgH}
          className="block"
          style={{ overflow: 'visible' }}
        >
          <rect
            className="plan-mode-stroke"
            x={STROKE_WIDTH / 2}
            y={STROKE_WIDTH / 2}
            width={svgW - STROKE_WIDTH}
            height={svgH - STROKE_WIDTH}
            rx={dashedRadius}
            ry={dashedRadius}
            fill="none"
            stroke="hsl(var(--primary) / 0.45)"
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={`${DASH_LENGTH} ${DASH_GAP}`}
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  )
}
