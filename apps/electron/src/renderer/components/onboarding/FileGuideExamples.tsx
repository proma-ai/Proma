import { useCallback, useEffect, useRef, useState } from 'react'
import sessionFilesExample from '@/assets/onboarding/guide-session-files-example.png'
import projectFilesExample from '@/assets/onboarding/guide-project-files-example.png'

interface ImageSize {
  width: number
  height: number
}

interface FileExampleImageProps {
  imageSrc: string
  alt: string
  anchor: { x: number; y: number }
  /** 仅控制镜片内截图的放大倍数，不改变与首屏统一的镜片尺寸。 */
  imageZoom?: number
  /** 水平偏移以 320px 镜片为基准，避免靠近右缘的镜片越出窗口。 */
  offsetX?: number
}

/**
 * 截图上的标签位置以归一化坐标保存，ResizeObserver 会在容器尺寸变化时重算与首屏一致的镜片大小与取景位置。
 */
function FileExampleImage({ imageSrc, alt, anchor, imageZoom = 2.2, offsetX = 0 }: FileExampleImageProps) {
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
  const sourceCropWidth = 0.1765
  const referenceDiameter = 320
  const magnifierDiameter = frameSize.width * lensZoom * sourceCropWidth
  const radius = magnifierDiameter / 2
  const focusX = anchor.x * frameSize.width
  const focusY = anchor.y * frameSize.height
  const scaledOffsetX = offsetX * (magnifierDiameter / referenceDiameter)
  const zoomedWidth = frameSize.width * imageZoom
  const zoomedHeight = frameSize.height * imageZoom

  const clampToLens = (position: number, contentSize: number) =>
    Math.min(0, Math.max(magnifierDiameter - contentSize, position))
  const baseLeft = clampToLens(radius - anchor.x * zoomedWidth, zoomedWidth)
  const baseTop = clampToLens(radius - anchor.y * zoomedHeight, zoomedHeight)

  return (
    <div ref={frameRef} className="relative">
      <figure className="m-0 overflow-hidden rounded-lg bg-[#f6f8f3] shadow-[0_14px_30px_rgba(27,63,45,0.12)]">
        <img src={imageSrc} alt={alt} className="block h-auto w-full" onLoad={updateFrameSize} />
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
            src={imageSrc}
            alt=""
            draggable={false}
            className="max-w-none"
            style={{
              position: 'absolute',
              left: baseLeft,
              top: baseTop,
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
              clipPath: 'none',
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

/** 会话文件与项目文件的真实工作流示例；由父页面负责放入章节容器和导航。 */
export function FileGuideExamples() {
  return (
    <>
      <div className="max-w-2xl">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#1b3f2d]">真实示例</div>
        <h2 className="mt-4 text-3xl font-light tracking-tight text-neutral-900 md:text-4xl">让文件跟着工作流留在正确的位置</h2>
      </div>

      <div className="mt-14 space-y-16 md:mt-16 md:space-y-20">
        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
          <FileExampleImage
            imageSrc={sessionFilesExample}
            alt="Agent 将 RAG 研究结果写入会话文件的示例"
            anchor={{ x: 0.848, y: 0.071 }}
            imageZoom={1.9}
          />
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#1b3f2d]">示例 01 · 会话文件</div>
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">把当前对话的产出留在会话里</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              当结果只服务于这一次讨论，例如一份 RAG 调研报告，就让 Agent 把它保存到会话文件。它会紧贴当前上下文，方便在这段对话中继续引用和修改。
            </p>
            <div className="mt-5 border-l-2 border-[#1b3f2d]/35 pl-4">
              <div className="text-base font-medium leading-7 text-[#1b3f2d]">这样告诉 Agent</div>
              <p className="mt-1 text-base leading-7 text-neutral-500">“把这份 RAG 研究结果写入会话文件，方便我在当前对话继续引用。”</p>
            </div>
          </div>
        </article>

        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-center">
          <div className="lg:order-1">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#1b3f2d]">示例 02 · 项目文件</div>
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">把可复用的方法沉淀为项目资产</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              当内容可以跨会话复用，例如研究方法、工作模板或项目知识，把它保存到项目文件。同一项目中的其他对话都能找到并继续沿用这些成果。
            </p>
            <div className="mt-5 border-l-2 border-[#1b3f2d]/35 pl-4">
              <div className="text-base font-medium leading-7 text-[#1b3f2d]">这样告诉 Agent</div>
              <p className="mt-1 text-base leading-7 text-neutral-500">“把这套研究方法整理到项目文件，后面的会话都可以继续使用。”</p>
            </div>
          </div>
          <div className="lg:order-2">
            <FileExampleImage
              imageSrc={projectFilesExample}
              alt="Agent 将可复用的研究方法写入项目文件的示例"
              anchor={{ x: 0.942, y: 0.071 }}
              imageZoom={1.8}
              offsetX={-75}
            />
          </div>
        </article>
      </div>
    </>
  )
}
