/**
 * ReleaseNotesViewer - Release Notes 查看器
 *
 * 显示 GitHub Release 或公开更新日志的 Markdown 内容
 */

import * as React from 'react'
import type { ChangelogItem, GitHubRelease } from '@proma/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'
import { CodeBlock } from '@proma/ui'
import { cn } from '@/lib/utils'
import { copyTextToClipboard } from '@/lib/clipboard'

interface ReleaseNotesViewerProps {
  /** GitHub Release 或公共更新日志数据 */
  release: GitHubRelease | ChangelogItem
  /** 是否显示标题（默认 true） */
  showHeader?: boolean
  /** 是否紧凑模式（默认 false） */
  compact?: boolean
}

function isGitHubRelease(release: GitHubRelease | ChangelogItem): release is GitHubRelease {
  return 'body' in release
}

interface ReleaseNotesContent {
  title: string
  content: string
  publishedAt: string | null
  isPrerelease: boolean
  githubUrl?: string
}

function normalizeReleaseNotes(release: GitHubRelease | ChangelogItem): ReleaseNotesContent {
  if (isGitHubRelease(release)) {
    return {
      title: release.name || release.tag_name,
      content: release.body,
      publishedAt: release.published_at,
      isPrerelease: release.prerelease,
      githubUrl: release.html_url,
    }
  }

  return {
    title: release.title,
    content: release.content,
    publishedAt: release.publishedAt,
    isPrerelease: false,
  }
}

/**
 * 格式化发布日期
 */
function formatReleaseDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天发布'
  if (diffDays === 1) return '昨天发布'
  if (diffDays < 7) return `${diffDays} 天前发布`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前发布`

  // 超过 30 天，显示完整日期
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * ReleaseNotesViewer 组件
 */
export function ReleaseNotesViewer({
  release,
  showHeader = true,
  compact = false,
}: ReleaseNotesViewerProps): React.ReactElement {
  const releaseNotes = normalizeReleaseNotes(release)

  return (
    <div className="space-y-3">
      {/* 标题部分 */}
      {showHeader && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold truncate">
                {releaseNotes.title}
              </h3>
              {releaseNotes.isPrerelease && (
                <Badge variant="secondary" className="text-xs">
                  预发布
                </Badge>
              )}
            </div>
            {releaseNotes.publishedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatReleaseDate(releaseNotes.publishedAt)}
              </p>
            )}
          </div>

          {releaseNotes.githubUrl && (
            <a
              href={releaseNotes.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
              title="在 GitHub 上查看"
            >
              <ExternalLink className="h-3 w-3" />
              GitHub
            </a>
          )}
        </div>
      )}

      {/* Release Notes 内容 */}
      <div
        className={cn(
          'prose dark:prose-invert max-w-none',
          compact ? 'text-xs prose-sm' : 'text-sm',
          'prose-p:my-1.5 prose-p:leading-[1.6] prose-li:leading-[1.6]',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
        )}
      >
        {releaseNotes.content ? (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children: preChildren }) => <CodeBlock onCopy={copyTextToClipboard}>{preChildren}</CodeBlock>,
              a: ({ href, children: linkChildren, ...linkProps }) => (
                <a
                  {...linkProps}
                  href={href ?? undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                      window.electronAPI.openExternal(href)
                    }
                  }}
                  title={href ?? undefined}
                >
                  {linkChildren}
                </a>
              ),
            }}
          >
            {releaseNotes.content}
          </Markdown>
        ) : (
          <p className="text-muted-foreground italic">暂无更新说明</p>
        )}
      </div>
    </div>
  )
}
