/**
 * AskUserBanner — Agent AskUserQuestion 交互式问答横幅
 *
 * 多问题用顶部 Tab 切换，选项竖向排列。
 * 键盘：↑↓ 选择选项，Enter 确认当前问题（最后一题提交，否则翻页）。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Send, X } from 'lucide-react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import {
  allPendingAskUserRequestsAtom,
  agentStreamingStatesAtom,
  askUserDraftsAtom,
  finalizeStreamingActivities,
  type AskUserQuestionDraft,
  type AskUserRequestDraft,
} from '@/atoms/agent-atoms'
import type { AskUserQuestion } from '@proma/shared'

const EMPTY_ANSWER: AskUserQuestionDraft = { selected: [], customText: '', showCustom: false }

const PREVIEW_REMARK_PLUGINS = [remarkGfm]

function safeUrlTransform(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return defaultUrlTransform(url)
}

/** AskUserBanner 属性接口 */
interface AskUserBannerProps {
  sessionId: string
}

export function AskUserBanner({ sessionId }: AskUserBannerProps): React.ReactElement | null {
  const [allRequests, setAllRequests] = useAtom(allPendingAskUserRequestsAtom)
  const [drafts, setDrafts] = useAtom(askUserDraftsAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [submitting, setSubmitting] = React.useState(false)

  const request = requests[0] ?? null
  const questions = request?.questions ?? []
  const requestDraft = request ? drafts.get(request.requestId) : undefined
  const activeTab = questions.length > 0
    ? Math.min(Math.max(requestDraft?.activeTab ?? 0, 0), questions.length - 1)
    : 0
  const focusedOptIdx = requestDraft?.focusedOptIdx ?? -1
  const answers = requestDraft?.answers ?? createInitialDraft(questions).answers
  const isLastTab = activeTab >= questions.length - 1

  // ===== Refs：确保 keydown handler 始终读取最新值，消除闭包过期问题 =====
  const activeTabRef = React.useRef(activeTab)
  activeTabRef.current = activeTab
  const questionsRef = React.useRef(questions)
  questionsRef.current = questions
  const focusedOptIdxRef = React.useRef(focusedOptIdx)
  focusedOptIdxRef.current = focusedOptIdx
  const submitRef = React.useRef<(() => void) | null>(null)
  const autoAdvanceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAutoAdvanceTimer = React.useCallback((): void => {
    if (autoAdvanceTimerRef.current != null) {
      clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
  }, [])

  // 组件卸载时清理未触发的跳转定时器
  React.useEffect(() => clearAutoAdvanceTimer, [clearAutoAdvanceTimer])

  React.useEffect(() => {
    clearAutoAdvanceTimer()
    if (!request || questions.length === 0) return
    setDrafts((prev) => {
      const current = prev.get(request.requestId)
      if (current && current.activeTab >= 0 && current.activeTab < questions.length) return prev
      const map = new Map(prev)
      map.set(request.requestId, createInitialDraft(questions))
      return map
    })
  }, [request?.requestId, questions, clearAutoAdvanceTimer, setDrafts])

  // 键盘导航：只在 requestId 变化时重建 handler，内部通过 ref 读取最新值
  React.useEffect(() => {
    if (!request || questions.length === 0) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const curTab = activeTabRef.current
      const qs = questionsRef.current
      const curFocusIdx = focusedOptIdxRef.current
      const q = qs[curTab]
      if (!q) return
      const itemCount = q.options.length + 1
      const lastTab = curTab >= qs.length - 1

      // 自由文本输入框内：仅 Enter 生效（输入法组合中跳过）
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault()
          if (lastTab) submitRef.current?.()
          else setActiveTabByState((prev) => prev + 1)
        }
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const nextIdx = curFocusIdx === -1
          ? (e.key === 'ArrowDown' ? 0 : itemCount - 1)
          : e.key === 'ArrowDown'
            ? (curFocusIdx + 1) % itemCount
            : (curFocusIdx - 1 + itemCount) % itemCount
        setFocusedOptIdxByState(nextIdx)
        // 移动焦点同时选中
        if (nextIdx < q.options.length) {
          const opt = q.options[nextIdx]
          if (opt) toggleOptionByState(curTab, q, opt.label)
        } else {
          toggleCustomByState(curTab)
        }
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (lastTab) submitRef.current?.()
        else setActiveTabByState((prev) => prev + 1)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [request?.requestId])

  /** 关闭问题 & 终止 Agent */
  const handleDismiss = (): void => {
    // 立即标记 streaming 停止，避免 UI 残留
    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current || !current.running) return prev
      const map = new Map(prev)
      map.set(sessionId, {
        ...current,
        running: false,
        ...finalizeStreamingActivities(current.toolActivities),
      })
      return map
    })
    // 清除当前 session 所有待处理的 AskUser 请求
    setAllRequests((prev) => {
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
    clearDrafts(requests.map((r) => r.requestId))
    // 终止 Agent
    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }

  if (!request) return null

  const getAnswer = (idx: number): AskUserQuestionDraft => answers.get(idx) ?? EMPTY_ANSWER

  function updateCurrentDraft(updater: (draft: AskUserRequestDraft) => AskUserRequestDraft): void {
    if (!request) return
    setDrafts((prev) => {
      const current = prev.get(request.requestId) ?? createInitialDraft(questions)
      const map = new Map(prev)
      map.set(request.requestId, updater(current))
      return map
    })
  }

  function updateAnswers(updater: (prev: Map<number, AskUserQuestionDraft>) => Map<number, AskUserQuestionDraft>): void {
    updateCurrentDraft((draft) => ({ ...draft, answers: updater(draft.answers) }))
  }

  function setActiveTabByState(update: number | ((prev: number) => number)): void {
    updateCurrentDraft((draft) => {
      const rawNext = typeof update === 'function' ? update(draft.activeTab) : update
      const maxTab = Math.max(questions.length - 1, 0)
      const nextTab = Math.min(Math.max(rawNext, 0), maxTab)
      return {
        ...draft,
        activeTab: nextTab,
        focusedOptIdx: -1,
        answers: ensureAnswerForTab(draft.answers, questions, nextTab),
      }
    })
  }

  function setFocusedOptIdxByState(nextIdx: number): void {
    updateCurrentDraft((draft) => ({ ...draft, focusedOptIdx: nextIdx }))
  }

  function clearDrafts(requestIds: string[]): void {
    setDrafts((prev) => {
      const map = new Map(prev)
      requestIds.forEach((requestId) => map.delete(requestId))
      return map
    })
  }

  function toggleOptionByState(qIdx: number, q: AskUserQuestion, label: string): void {
    updateAnswers((prev) => {
      const map = new Map(prev)
      const cur = map.get(qIdx) ?? EMPTY_ANSWER
      const selected = q.multiSelect
        ? (cur.selected.includes(label) ? cur.selected.filter((s) => s !== label) : [...cur.selected, label])
        : [label]
      map.set(qIdx, { ...cur, selected, showCustom: false, customText: '' })
      return map
    })
  }

  function toggleCustomByState(qIdx: number): void {
    updateAnswers((prev) => {
      const map = new Map(prev)
      const cur = map.get(qIdx) ?? EMPTY_ANSWER
      map.set(qIdx, { ...cur, showCustom: !cur.showCustom, selected: cur.showCustom ? cur.selected : [] })
      return map
    })
  }

  const handleSubmit = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      const answersRecord: Record<string, string> = {}
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]
        if (!q) continue
        const answer = getAnswer(i)
        const key = q.question || String(i)
        if (answer.showCustom && answer.customText.trim()) {
          answersRecord[key] = answer.customText.trim()
        } else if (answer.selected.length > 0) {
          answersRecord[key] = answer.selected.join(', ')
        }
      }
      await window.electronAPI.respondAskUser({ requestId: request.requestId, answers: answersRecord })
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
      clearDrafts([request.requestId])
    } catch (error) {
      console.error('[AskUserBanner] 响应失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  submitRef.current = handleSubmit

  const hasValidAnswers = questions.some((_, idx) => {
    const a = getAnswer(idx)
    return a.selected.length > 0 || (a.showCustom && a.customText.trim().length > 0)
  })

  const currentQuestion = questions[activeTab]
  if (!currentQuestion) return null

  const goNextTab = (): void => {
    if (!isLastTab) setActiveTabByState((prev) => prev + 1)
  }

  return (
    <div className="ask-user-banner mx-4 mb-3 rounded-xl bg-card shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
      {/* 头部 + Tab 栏 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">Proma Agent 需要你的输入</span>
          <div className="flex items-center gap-1.5">
            {requests.length > 1 && (
              <span className="text-xs text-muted-foreground">(+{requests.length - 1})</span>
            )}
            <button
              type="button"
              className="size-5 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
              onClick={handleDismiss}
              title="关闭并终止 Agent"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Tab 栏（多问题时显示） */}
        {questions.length > 1 && (
          <div className="flex gap-1">
            {questions.map((q, idx) => {
              const isActive = idx === activeTab
              const hasAnswer = getAnswer(idx).selected.length > 0
                || (getAnswer(idx).showCustom && getAnswer(idx).customText.trim().length > 0)
              return (
                <button
                  key={idx}
                  type="button"
                  className={`
                    px-2.5 py-1 rounded-lg text-xs font-medium transition-all outline-none
                    ${isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : hasAnswer
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }
                  `}
                  onClick={() => setActiveTabByState(idx)}
                >
                  {`${idx + 1}-${q.multiSelect ? '多选' : '单选'}：${q.header || `问题 ${idx + 1}`}`}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 当前问题内容 */}
      <div className="px-4 pb-2">
        <QuestionCard
          question={currentQuestion}
          questionIndex={activeTab}
          answer={getAnswer(activeTab)}
          focusedIndex={focusedOptIdx}
          showBadge={questions.length === 1}
          onToggleOption={(label) => {
            toggleOptionByState(activeTab, currentQuestion, label)
            if (!currentQuestion.multiSelect && !isLastTab) {
              clearAutoAdvanceTimer()
              autoAdvanceTimerRef.current = setTimeout(() => {
                autoAdvanceTimerRef.current = null
                setActiveTabByState((prev) => prev + 1)
              }, 150)
            }
          }}
          onToggleCustom={() => toggleCustomByState(activeTab)}
          onCustomTextChange={(text) => updateAnswers((prev) => {
            const map = new Map(prev)
            const cur = map.get(activeTab) ?? EMPTY_ANSWER
            map.set(activeTab, { ...cur, customText: text })
            return map
          })}
          onSubmit={isLastTab ? handleSubmit : goNextTab}
        />
      </div>

      {/* 底部 */}
      <div className="flex items-center justify-end gap-1.5 px-4 pb-3">
        <span className="text-[10px] text-muted-foreground/40 mr-auto">
          ↑↓ 选择 · Enter {isLastTab ? '确认' : '下一个'}
        </span>
        {isLastTab && (
          <Button
            variant="default"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !hasValidAnswers}
            className="h-7 px-3 text-xs"
          >
            <Send className="size-3 mr-1" />
            确认
          </Button>
        )}
      </div>
    </div>
  )
}

function createInitialDraft(questions: readonly AskUserQuestion[]): AskUserRequestDraft {
  return {
    activeTab: 0,
    focusedOptIdx: -1,
    answers: ensureAnswerForTab(new Map(), questions, 0),
  }
}

function ensureAnswerForTab(
  answers: Map<number, AskUserQuestionDraft>,
  questions: readonly AskUserQuestion[],
  tabIndex: number,
): Map<number, AskUserQuestionDraft> {
  if (answers.has(tabIndex)) return answers
  const firstOpt = questions[tabIndex]?.options[0]
  if (!firstOpt) return answers
  const map = new Map(answers)
  map.set(tabIndex, { ...EMPTY_ANSWER, selected: [firstOpt.label] })
  return map
}

/** 单个问题卡片（竖向选项） */
function QuestionCard({
  question,
  questionIndex,
  answer,
  focusedIndex,
  showBadge,
  onToggleOption,
  onToggleCustom,
  onCustomTextChange,
  onSubmit,
}: {
  question: AskUserQuestion
  questionIndex: number
  answer: AskUserQuestionDraft
  focusedIndex: number
  showBadge: boolean
  onToggleOption: (label: string) => void
  onToggleCustom: () => void
  onCustomTextChange: (text: string) => void
  onSubmit: () => void
}): React.ReactElement {
  const optionCount = question.options.length
  const previewOption = focusedIndex >= 0 && focusedIndex < optionCount
    ? question.options[focusedIndex]
    : question.options.find((o) => answer.selected.includes(o.label))
  const previewContent = previewOption?.preview

  return (
    <div className="space-y-2">
      {/* 问题标签 + 文本（分行显示） */}
      <div className="space-y-1">
        {showBadge && (
          <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-primary text-primary-foreground shadow-sm">
            {`${questionIndex + 1}-${question.multiSelect ? '多选' : '单选'}${question.header ? `：${question.header}` : ''}`}
          </span>
        )}
        <p className="text-sm text-foreground">{question.question}</p>
      </div>

      {/* 竖向选项 */}
      <div className="flex flex-col gap-1">
        {question.options.map((option, idx) => {
          const isSelected = answer.selected.includes(option.label)
          const isFocused = focusedIndex === idx
          return (
            <button
              key={option.label}
              type="button"
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all outline-none text-left
                ${isSelected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/50 text-foreground/80 hover:bg-muted'
                }
                ${isFocused ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-card' : ''}
              `}
              onClick={() => onToggleOption(option.label)}
            >
              <span className={`text-[10px] shrink-0 ${isSelected ? 'text-primary-foreground/60' : 'text-muted-foreground/50'}`}>
                {idx + 1}
              </span>
              <span className="font-medium">{option.label}</span>
              {option.description && (
                <span className={`text-[11px] ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                  {option.description}
                </span>
              )}
            </button>
          )
        })}

        {/* "其他" */}
        <button
          type="button"
          className={`
            flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all outline-none text-left
            ${answer.showCustom
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-muted/50 text-foreground/80 hover:bg-muted'
            }
            ${focusedIndex === optionCount ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-card' : ''}
          `}
          onClick={onToggleCustom}
        >
          <span className={`text-[10px] shrink-0 ${answer.showCustom ? 'text-primary-foreground/60' : 'text-muted-foreground/50'}`}>
            {optionCount + 1}
          </span>
          <span className="font-medium">其他...</span>
        </button>
      </div>

      {/* 自由文本输入 */}
      {answer.showCustom && (
        <input
          type="text"
          className="w-full px-3 py-2 rounded-lg text-xs bg-muted/40 focus:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/40 transition-colors"
          placeholder="输入自定义答案..."
          value={answer.customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation() // 阻止冒泡到 document handler，避免重复触发 setActiveTab
              onSubmit()
            }
          }}
          autoFocus
        />
      )}

      {/* 选项 Preview（聚焦或选中时展示） */}
      {previewContent && (
        <div className="mt-2 rounded-lg bg-muted/40 p-3 text-xs prose prose-sm dark:prose-invert max-w-none prose-p:my-0 prose-headings:my-0.5 prose-li:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <Markdown remarkPlugins={PREVIEW_REMARK_PLUGINS} urlTransform={safeUrlTransform}>
            {previewContent}
          </Markdown>
        </div>
      )}
    </div>
  )
}
