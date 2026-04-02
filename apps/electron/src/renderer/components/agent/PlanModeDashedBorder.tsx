/**
 * PlanModeDashedBorder — 计划模式输入框虚线边框叠加层
 *
 * 用 SVG <rect> 精确控制虚线段长和间距，绝对定位不影响布局。
 * 使用 ResizeObserver 跟踪父容器尺寸。
 */

import * as React from 'react'

const DASH_LENGTH = 9    // 每段虚线长度
const DASH_GAP = 7       // 虚线间距
const STROKE_WIDTH = 2   // 线宽
const BORDER_RADIUS = 17 // 圆角半径，与输入框 rounded-[17px] 一致
const OFFSET = 2         // 向外偏移，避免遮盖原有 border

export function PlanModeDashedBorder(): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ w: 0, h: 0 })

  React.useEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ w: width, h: height })
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  const svgW = size.w + OFFSET * 2
  const svgH = size.h + OFFSET * 2

  return (
    <div
      ref={containerRef}
      className="absolute pointer-events-none"
      style={{
        inset: -OFFSET,
        zIndex: 10,
      }}
    >
      {size.w > 0 && size.h > 0 && (
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
            rx={BORDER_RADIUS + OFFSET}
            ry={BORDER_RADIUS + OFFSET}
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
