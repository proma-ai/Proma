/**
 * SuggestionBanner — 主动建议横幅
 *
 * 在 Agent 会话中展示主动建议（由 Suggest 引擎在会话结束后生成）。
 * 三态交互：
 * - 接受（✓）：执行建议动作（如写入纠正候选），并提示用户后续入口
 * - 忽略（×）：该建议降频，同类建议权重下调
 * - 不再建议这类（∞）：永久屏蔽该 duplicateKey，同类不再出现
 *
 * 复用 AgentRecommendBanner 的视觉模式（卡片 + Sparkles 图标 + 操作按钮）。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Sparkles, X, Check, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SuggestionRecord } from '@proma/shared'

interface SuggestionBannerProps {
  sessionId: string
}

export function SuggestionBanner({ sessionId }: SuggestionBannerProps): React.ReactElement | null {
  const [suggestion, setSuggestion] = React.useState<SuggestionRecord | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [actioning, setActioning] = React.useState(false)

  // 会话变化时拉取该会话的待展示建议
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSuggestion(null)
    window.electronAPI
      .listSuggestions('suggested')
      .then((records) => {
        if (cancelled) return
        // 优先展示当前会话的建议；无则展示最近一条其他会话的建议
        const mine = records.find((r) => r.sessionId === sessionId)
        const fallback = records[0]
        const target = mine ?? fallback ?? null
        setSuggestion(target)
      })
      .catch((error) => {
        console.warn('[SuggestionBanner] 拉取建议失败:', error)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (loading || !suggestion) return null

  const handleFeedback = async (feedback: 'accepted' | 'ignored' | 'never'): Promise<void> => {
    if (actioning) return
    setActioning(true)
    try {
      const result = await window.electronAPI.actOnSuggestion(suggestion.id, feedback)
      if (!result.ok) {
        toast.error(result.error ?? '操作失败')
        return
      }
      const labels: Record<string, string> = {
        accepted: '已接受建议',
        ignored: '已忽略，同类建议会减少',
        never: '已屏蔽这类建议',
      }
      toast.success(labels[feedback])
      setSuggestion(null)
    } catch (error) {
      console.warn('[SuggestionBanner] 反馈失败:', error)
      toast.error('操作失败')
    } finally {
      setActioning(false)
    }
  }

  const kindLabel: Record<string, string> = {
    correction: '记住这个纠正',
    followup: '跟进提醒',
    automation: '定时任务',
    skill: 'Skill 沉淀',
    todo: '待办记录',
  }

  return (
    <div className="mx-4 mb-3 rounded-xl bg-card shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200 border border-border/60">
      {/* 头部 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              主动建议 · {kindLabel[suggestion.kind] ?? suggestion.kind}
            </span>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            onClick={() => void handleFeedback('ignored')}
            disabled={actioning}
            aria-label="忽略"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 建议内容 */}
      <div className="px-4 pb-3">
        <p className="text-sm font-medium text-foreground">{suggestion.title}</p>
        <p className="mt-1 text-xs text-foreground/70 leading-relaxed">{suggestion.reason}</p>
        {suggestion.evidence && (
          <p className="mt-1.5 text-[11px] text-muted-foreground border-l-2 border-border pl-2">
            依据：{suggestion.evidence}
          </p>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between px-4 pb-3">
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          onClick={() => void handleFeedback('never')}
          disabled={actioning}
        >
          <Ban className="size-3" />
          不再建议这类
        </button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => void handleFeedback('ignored')}
            disabled={actioning}
          >
            忽略
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => void handleFeedback('accepted')}
            disabled={actioning}
          >
            <Check className="size-3 mr-1" />
            {actioning ? '处理中...' : '接受'}
          </Button>
        </div>
      </div>
    </div>
  )
}
