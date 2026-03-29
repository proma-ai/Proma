/**
 * TutorialViewer - 教程查看器
 *
 * 通过 IPC 从主进程获取教程 markdown 内容并渲染。
 * 复用 react-markdown + remarkGfm 渲染栈。
 * 支持外部图片、代码块高亮、链接跳转、内嵌视频。
 */

import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Loader2 } from 'lucide-react'
import { CodeBlock } from '@proma/ui'

/** 视频块信息 */
interface VideoBlock {
  id: string
  src: string
}

/** 占位符前缀 */
const VIDEO_PLACEHOLDER_PREFIX = '$$VIDEO_BLOCK_'

/**
 * 提取 markdown 中的 <video> 标签，替换为占位符。
 * react-markdown + rehype-raw 对多行 HTML 标签支持不稳定，
 * 改为手动提取后通过自定义组件渲染。
 */
function extractVideoBlocks(markdown: string): { processed: string; videos: VideoBlock[] } {
  const videos: VideoBlock[] = []
  const processed = markdown.replace(
    /<video[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/video>/gi,
    (_match, src: string) => {
      const id = `${VIDEO_PLACEHOLDER_PREFIX}${videos.length}`
      videos.push({ id, src })
      return `\n\n${id}\n\n`
    },
  )
  return { processed, videos }
}

export function TutorialViewer(): React.ReactElement {
  const [content, setContent] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    window.electronAPI
      .getTutorialContent()
      .then((text) => {
        setContent(text)
      })
      .catch((err: unknown) => {
        console.error('[TutorialViewer] 加载教程失败:', err)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">加载教程中...</span>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p className="text-sm">暂未找到教程内容</p>
      </div>
    )
  }

  const { processed, videos } = extractVideoBlocks(content)

  return (
    <div
      className="prose dark:prose-invert max-w-none text-[14px]
        prose-p:my-2 prose-p:leading-[1.75] prose-li:leading-[1.75]
        prose-headings:my-3 prose-pre:my-0
        prose-img:rounded-xl prose-img:shadow-md prose-img:max-w-full
        prose-blockquote:border-primary/30 prose-blockquote:text-muted-foreground
        [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          a: ({ href, children: linkChildren, ...linkProps }) => (
            <a
              {...linkProps}
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                  window.electronAPI.openExternal(href)
                }
              }}
              title={href}
              className="text-primary hover:underline cursor-pointer"
            >
              {linkChildren}
            </a>
          ),
          pre: ({ children: preChildren }) => {
            return <CodeBlock>{preChildren}</CodeBlock>
          },
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt || ''}
              className="rounded-xl shadow-md max-w-full"
              loading="lazy"
            />
          ),
          p: ({ children, ...pProps }) => {
            // 检查段落内容是否为视频占位符
            if (typeof children === 'string' && children.startsWith(VIDEO_PLACEHOLDER_PREFIX)) {
              const video = videos.find((v) => v.id === children)
              if (video) {
                return (
                  <video
                    src={video.src}
                    controls
                    playsInline
                    className="rounded-xl shadow-md max-w-full h-auto my-2"
                  />
                )
              }
            }
            // children 可能是数组，检查单个子元素
            if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string' && (children[0] as string).startsWith(VIDEO_PLACEHOLDER_PREFIX)) {
              const video = videos.find((v) => v.id === children[0])
              if (video) {
                return (
                  <video
                    src={video.src}
                    controls
                    playsInline
                    className="rounded-xl shadow-md max-w-full h-auto my-2"
                  />
                )
              }
            }
            return <p {...pProps}>{children}</p>
          },
        }}
      >
        {processed}
      </Markdown>
    </div>
  )
}
