import { useCallback, useEffect, useRef, useState } from 'react'
import memoryGenerateExample from '@/assets/onboarding/guide-memory-generate.png'
import memoryFilesExample from '@/assets/onboarding/guide-memory.png'

interface ImageSize {
  width: number
  height: number
}

/**
 * 记忆文件列表的放大镜独立观察截图容器，在不同图宽下保持与其他 onboarding 案例一致的尺寸。
 */
function MemoryFilesExampleImage() {
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameSize, setFrameSize] = useState<ImageSize>({ width: 0, height: 0 })

  const updateFrameSize = useCallback(() => {
    const frame = frameRef.current?.getBoundingClientRect()
    if (!frame) return

    setFrameSize((current) => {
      if (Math.abs(current.width - frame.width) < 0.5 && Math.abs(current.height - frame.height) < 0.5) {
        return current
      }

      return { width: frame.width, height: frame.height }
    })
  }, [])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    updateFrameSize()
    const observer = new ResizeObserver(updateFrameSize)
    observer.observe(frame)

    return () => observer.disconnect()
  }, [updateFrameSize])

  const hasDimensions = frameSize.width > 0 && frameSize.height > 0
  const lensZoom = 2.2
  // 外圈保持统一尺寸；内部略微缩小，完整保留记忆文件列表的三项自动记忆。
  const contentZoom = 1.9
  const sourceCropWidth = 0.1765
  const referenceDiameter = 320
  const magnifierDiameter = frameSize.width * lensZoom * sourceCropWidth
  const radius = magnifierDiameter / 2
  const focus = { x: 0.18, y: 0.35 }
  const focusX = focus.x * frameSize.width
  const focusY = focus.y * frameSize.height
  const zoomedWidth = frameSize.width * contentZoom
  const zoomedHeight = frameSize.height * contentZoom
  const scaledOffsetX = 20 * (magnifierDiameter / referenceDiameter)

  const clampToLens = (position: number, contentSize: number) =>
    Math.min(0, Math.max(magnifierDiameter - contentSize, position))
  const imageLeft = clampToLens(radius - focus.x * zoomedWidth, zoomedWidth)
  const imageTop = clampToLens(radius - focus.y * zoomedHeight, zoomedHeight)

  return (
    <div ref={frameRef} className="relative min-w-0">
      <figure className="m-0 overflow-hidden rounded-lg bg-[#f6f8f3] shadow-[0_14px_30px_rgba(27,63,45,0.12)]">
        <img
          src={memoryFilesExample}
          alt="项目记忆页面中显示记忆文件和自动记忆条目的示例"
          className="block h-auto w-full"
          onLoad={updateFrameSize}
        />
      </figure>

      {hasDimensions && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-20"
          style={{
            left: focusX - radius + scaledOffsetX,
            top: focusY - radius,
            width: magnifierDiameter,
            height: magnifierDiameter,
            backgroundColor: '#eef4ea',
            clipPath: `circle(${radius}px at ${radius}px ${radius}px)`,
            overflow: 'hidden',
            filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.25))',
          }}
        >
          <img
            src={memoryFilesExample}
            alt=""
            draggable={false}
            className="max-w-none"
            style={{
              position: 'absolute',
              left: imageLeft,
              top: imageTop,
              width: zoomedWidth,
              height: zoomedHeight,
              objectFit: 'fill',
            }}
          />
          <div
            className="absolute inset-0 rounded-full border-[3px] border-[#1b3f2d]"
            style={{ clipPath: `circle(${radius}px at ${radius}px ${radius}px)` }}
          />
          <div
            className="absolute bottom-[-6px] right-[-6px] h-8 w-8 rounded-full border-[4px] border-[#1b3f2d]"
            style={{
              background: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: 'transparent',
              transform: 'rotate(-45deg)',
            }}
          />
        </div>
      )}
    </div>
  )
}

/** 项目记忆章节的真实工作流示例；由父页面负责放入章节容器和导航。 */
export function MemoryGuideExamples() {
  return (
    <>
      <div className="max-w-2xl">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#1b3f2d]">真实示例</div>
        <h2 className="mt-4 text-3xl font-light tracking-tight text-neutral-900 md:text-4xl">复用已验证的经验</h2>
      </div>

      <div className="mt-14 space-y-16 md:mt-16 md:space-y-20">
        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
          <figure className="min-w-0 overflow-hidden rounded-lg bg-[#f6f8f3] shadow-[0_14px_30px_rgba(27,63,45,0.12)]">
            <img
              src={memoryGenerateExample}
              alt="在项目记忆页面为心理学研究项目点击生成项目记忆的示例"
              className="block h-auto w-full"
            />
          </figure>
          <div className="min-w-0">
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">一键生成项目记忆</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              项目使用一段时间后，在项目记忆处点击“生成项目记忆”。Agent 会开启一个会话整理选定范围内有代表性的工作，提炼项目偏好、规则与已确认结论。
            </p>
          </div>
        </article>

        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-center">
          <div className="min-w-0 lg:order-1">
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">
              Agent 整理好的<b className="font-medium text-neutral-900">偏好和记忆可以随时编辑</b>
            </h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              “记忆”下是 Agent 整理好的偏好和记忆。你可以手动编辑这些 md 文件；需要大规模重新梳理时，再一键生成或更新记忆即可。
            </p>
          </div>
          <div className="lg:order-2">
            <MemoryFilesExampleImage />
          </div>
        </article>
      </div>
    </>
  )
}
