import { useCallback, useEffect, useRef, useState } from 'react'
import guideSubagentDelegation from '@/assets/onboarding/guide-subagent-delegation.png'
import guideSubagentWorkspace from '@/assets/onboarding/guide-subagent-workspace.png'
import guideSubagentSummary from '@/assets/onboarding/guide-subagent-summary.png'

interface ImageBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 聚焦自然语言启动多个子会话的 Prompt，尺寸随截图渲染宽度同步变化。 */
function SubagentDelegationExampleImage() {
  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [imageBounds, setImageBounds] = useState<ImageBounds | null>(null)

  const updateImageBounds = useCallback(() => {
    const frame = frameRef.current
    const image = imageRef.current
    if (!frame || !image) return

    const frameRect = frame.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    if (!imageRect.width || !imageRect.height) return

    const next = {
      x: imageRect.left - frameRect.left,
      y: imageRect.top - frameRect.top,
      width: imageRect.width,
      height: imageRect.height,
    }

    setImageBounds((current) => {
      if (
        current &&
        Math.abs(current.x - next.x) < 0.5 &&
        Math.abs(current.y - next.y) < 0.5 &&
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
      ) {
        return current
      }

      return next
    })
  }, [])

  useEffect(() => {
    const image = imageRef.current
    if (!image) return

    updateImageBounds()
    const observer = new ResizeObserver(updateImageBounds)
    observer.observe(image)

    return () => observer.disconnect()
  }, [updateImageBounds])

  const anchor = { x: 0.46, y: 0.212 }
  const imageZoom = 1.28
  const sourceCropWidth = 0.30375
  const magnifierDiameter = imageBounds ? imageBounds.width * imageZoom * sourceCropWidth : 0
  const radius = magnifierDiameter / 2
  const verticalOffset = magnifierDiameter * 0.14
  const focusX = imageBounds ? imageBounds.x + anchor.x * imageBounds.width : 0
  const focusY = imageBounds ? imageBounds.y + anchor.y * imageBounds.height : 0
  const zoomedWidth = imageBounds ? imageBounds.width * imageZoom : 0
  const zoomedHeight = imageBounds ? imageBounds.height * imageZoom : 0

  const clampToLens = (position: number, contentSize: number) =>
    Math.min(0, Math.max(magnifierDiameter - contentSize, position))
  const imageLeft = imageBounds ? clampToLens(radius - anchor.x * zoomedWidth, zoomedWidth) : 0
  const imageTop = imageBounds ? clampToLens(radius - verticalOffset - anchor.y * zoomedHeight, zoomedHeight) : 0

  return (
    <div ref={frameRef} className="relative min-w-0">
      <figure className="overflow-hidden rounded-lg bg-[#f6f8f3] shadow-[0_14px_30px_rgba(27,63,45,0.12)]">
        <img
          ref={imageRef}
          src={guideSubagentDelegation}
          alt="父会话用自然语言启动三个子会话研究大五人格"
          className="block h-auto w-full"
          onLoad={updateImageBounds}
        />
      </figure>

      {imageBounds && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-20"
          style={{
            left: focusX - radius,
            top: focusY - radius + verticalOffset,
            width: magnifierDiameter,
            height: magnifierDiameter,
            backgroundColor: '#eef4ea',
            clipPath: `circle(${radius}px at ${radius}px ${radius}px)`,
            overflow: 'hidden',
            filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.25))',
          }}
        >
          <img
            src={guideSubagentDelegation}
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

/** 子会话章节的真实工作流示例。 */
export function SubagentGuideExamples() {
  return (
    <section className="border-t border-[#1b3f2d]/20 py-16 md:py-20">
      <div className="max-w-2xl">
        <div className="text-xs font-medium uppercase text-[#1b3f2d]">真实示例</div>
        <h2 className="mt-4 text-3xl font-light text-neutral-900 md:text-4xl">从一个目标开始，由多个 Agent 一起推进</h2>
        <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
          子会话把复杂任务拆成独立方向：父会话负责组织，你仍然可以随时介入每一个研究过程。
        </p>
      </div>

      <div className="mt-14 space-y-16 md:mt-16 md:space-y-20">
        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
          <SubagentDelegationExampleImage />
          <div>
            <div className="text-xs font-medium uppercase text-[#1b3f2d]">示例 01 · 启动</div>
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">一句话，就能启动多个研究方向</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              直接说出目标，Agent 可以创建多个子会话并行推进。复杂任务中，它也可能主动建议或自动唤起子会话；你还可以用自然语言指定每个子会话使用的模型。
            </p>
            <div className="mt-5 border-l-2 border-[#1b3f2d]/35 pl-4">
              <div className="text-base font-medium leading-7 text-[#1b3f2d]">这样告诉 Agent</div>
              <p className="mt-1 text-base leading-7 text-neutral-500">“启动 3 个子会话研究大五人格，并让其中一个使用 DeepSeek。”</p>
            </div>
          </div>
        </article>

        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-center">
          <div className="lg:order-1">
            <div className="text-xs font-medium uppercase text-[#1b3f2d]">示例 02 · 深入</div>
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">进入子会话，继续完成自己的研究</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              每个子会话都是独立且完整的会话，拥有自己的上下文、任务边界和输出。打开后可像普通会话一样继续追问、补充方向，并检查它正在完成的工作。
            </p>
            <div className="mt-5 border-l-2 border-[#1b3f2d]/35 pl-4">
              <div className="text-base font-medium leading-7 text-[#1b3f2d]">这样告诉 Agent</div>
              <p className="mt-1 text-base leading-7 text-neutral-500">“补充大五人格在实际工作和人际关系中的应用，并用要点列出。”</p>
            </div>
          </div>
          <figure className="overflow-hidden rounded-lg bg-[#f6f8f3] shadow-[0_14px_30px_rgba(27,63,45,0.12)] lg:order-2">
            <img src={guideSubagentWorkspace} alt="子会话独立研究大五人格并可继续追问的示例" className="block h-auto w-full" />
          </figure>
        </article>

        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
          <figure className="overflow-hidden rounded-lg bg-[#f6f8f3] shadow-[0_14px_30px_rgba(27,63,45,0.12)]">
            <img src={guideSubagentSummary} alt="父会话汇总三个子会话研究结果的示例" className="block h-auto w-full" />
          </figure>
          <div>
            <div className="text-xs font-medium uppercase text-[#1b3f2d]">示例 03 · 汇总</div>
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">研究完成后，父会话负责整合交付</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              各个子会话完成研究后，结果会自动汇回父会话。父会话会把不同方向的发现整合成最终答案、报告或其他可交付成果。
            </p>
            <div className="mt-5 border-l-2 border-[#1b3f2d]/35 pl-4">
              <div className="text-base font-medium leading-7 text-[#1b3f2d]">这样告诉 Agent</div>
              <p className="mt-1 text-base leading-7 text-neutral-500">“等所有子会话完成后，整合为一份面向新手的简明研究报告。”</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}
