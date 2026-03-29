/**
 * ExitPlanModeBanner — Agent ExitPlanMode 计划审批横幅
 *
 * 仿照 Claude Code 的计划审批 UI，提供 4 个选项：
 * 1. 批准并自动执行 — 切换到 bypassPermissions
 * 2. 批准，手动审批编辑 — 切换到 acceptEdits
 * 3. 拒绝计划 — deny
 * 4. 提供反馈 — 自由输入修改意见
 *
 * 键盘：↑↓ 选择，Enter 确认，数字键快速选择。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import {
  Check,
  ShieldCheck,
  X,
  MessageSquare,
  Send,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { allPendingExitPlanRequestsAtom } from '@/atoms/agent-atoms'
import type { ExitPlanModeAction, ExitPlanAllowedPrompt } from '@proma/shared'

/** 选项定义 */
interface PlanOption {
  action: ExitPlanModeAction
  label: string
  description: string
  icon: React.ReactNode
  variant: 'default' | 'secondary' | 'destructive'
}

const PLAN_OPTIONS: PlanOption[] = [
  {
    action: 'approve_auto',
    label: '批准并自动执行',
    description: '自动批准所有后续操作',
    icon: <Check className="size-3.5" />,
    variant: 'default',
  },
  {
    action: 'approve_edit',
    label: '批准，手动审批编辑',
    description: '后续文件修改需要逐一确认',
    icon: <ShieldCheck className="size-3.5" />,
    variant: 'secondary',
  },
  {
    action: 'deny',
    label: '拒绝计划',
    description: '直接拒绝，Agent 不会执行计划',
    icon: <X className="size-3.5" />,
    variant: 'destructive',
  },
  {
    action: 'feedback',
    label: '提供修改意见',
    description: '告诉 Agent 需要调整什么',
    icon: <MessageSquare className="size-3.5" />,
    variant: 'secondary',
  },
]

interface ExitPlanModeBannerProps {
  sessionId: string
}

export function ExitPlanModeBanner({ sessionId }: ExitPlanModeBannerProps): React.ReactElement | null {
  const [allRequests, setAllRequests] = useAtom(allPendingExitPlanRequestsAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [focusedIdx, setFocusedIdx] = React.useState(0)
  const [showFeedback, setShowFeedback] = React.useState(false)
  const [feedbackText, setFeedbackText] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const request = requests[0] ?? null

  // 重置状态
  React.useEffect(() => {
    setFocusedIdx(0)
    setShowFeedback(false)
    setFeedbackText('')
  }, [request?.requestId])

  // 键盘导航
  React.useEffect(() => {
    if (!request) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      // 反馈输入框内：仅 Enter 提交
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (feedbackText.trim()) {
            void handleAction('feedback')
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowFeedback(false)
          setFocusedIdx(3)
        }
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const count = PLAN_OPTIONS.length
        const next = e.key === 'ArrowDown'
          ? (focusedIdx + 1) % count
          : (focusedIdx - 1 + count) % count
        setFocusedIdx(next)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const option = PLAN_OPTIONS[focusedIdx]
        if (option) {
          if (option.action === 'feedback') {
            setShowFeedback(true)
          } else {
            void handleAction(option.action)
          }
        }
      } else if (e.key >= '1' && e.key <= '4') {
        const idx = parseInt(e.key) - 1
        const option = PLAN_OPTIONS[idx]
        if (option) {
          setFocusedIdx(idx)
          if (option.action === 'feedback') {
            setShowFeedback(true)
          } else {
            void handleAction(option.action)
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [request?.requestId, focusedIdx, feedbackText, showFeedback])

  if (!request) return null

  const handleAction = async (action: ExitPlanModeAction): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await window.electronAPI.respondExitPlanMode({
        requestId: request.requestId,
        action,
        feedback: action === 'feedback' ? feedbackText.trim() : undefined,
      })
      // 从队列移除
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
    } catch (error) {
      console.error('[ExitPlanModeBanner] 响应失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-4 mb-3 rounded-xl bg-card shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
      {/* 头部 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="size-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Agent 计划待审批</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Agent 已完成计划，请选择如何继续
        </p>
      </div>

      {/* allowedPrompts 展示 */}
      {request.allowedPrompts.length > 0 && (
        <AllowedPromptsList prompts={request.allowedPrompts} />
      )}

      {/* 选项列表 */}
      <div className="px-4 pb-2">
        <div className="flex flex-col gap-1">
          {PLAN_OPTIONS.map((option, idx) => {
            const isFocused = focusedIdx === idx
            return (
              <button
                key={option.action}
                type="button"
                className={`
                  flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all outline-none text-left
                  ${option.variant === 'destructive'
                    ? 'bg-muted/50 text-foreground/80 hover:bg-destructive/10 hover:text-destructive'
                    : 'bg-muted/50 text-foreground/80 hover:bg-muted'
                  }
                  ${isFocused ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-card' : ''}
                `}
                onClick={() => {
                  if (option.action === 'feedback') {
                    setShowFeedback(true)
                  } else {
                    void handleAction(option.action)
                  }
                }}
                disabled={submitting}
              >
                <span className="text-[10px] shrink-0 text-muted-foreground/50">
                  {idx + 1}
                </span>
                <span className="shrink-0 text-muted-foreground/70">{option.icon}</span>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-[11px] text-muted-foreground">{option.description}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 反馈输入框 */}
      {showFeedback && (
        <div className="px-4 pb-2">
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 rounded-lg text-xs bg-muted/40 focus:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/40 transition-colors"
              placeholder="输入修改意见..."
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (feedbackText.trim()) {
                    void handleAction('feedback')
                  }
                }
              }}
              autoFocus
              disabled={submitting}
            />
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleAction('feedback')}
              disabled={submitting || !feedbackText.trim()}
              className="h-8 px-3 text-xs shrink-0"
            >
              <Send className="size-3 mr-1" />
              发送
            </Button>
          </div>
        </div>
      )}

      {/* 底部提示 */}
      <div className="flex items-center px-4 pb-3">
        <span className="text-[10px] text-muted-foreground/40">
          ↑↓ 选择 · Enter 确认 · 1-4 快速选择
        </span>
      </div>
    </div>
  )
}

/** allowedPrompts 展示列表 */
function AllowedPromptsList({ prompts }: { prompts: ExitPlanAllowedPrompt[] }): React.ReactElement {
  return (
    <div className="px-4 pb-2">
      <p className="text-[11px] text-muted-foreground mb-1">计划需要的权限：</p>
      <div className="flex flex-wrap gap-1">
        {prompts.map((p, idx) => (
          <span
            key={idx}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/80"
          >
            {p.prompt}
          </span>
        ))}
      </div>
    </div>
  )
}
