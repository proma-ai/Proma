/**
 * MentionSuggestions — Skill / MCP 的 TipTap Mention Suggestion 统一配置
 *
 * 泛型工厂 createMentionSuggestion 封装公共逻辑（渲染、定位、键盘导航），
 * 通过 MentionSuggestionConfig 注入差异部分（触发字符、数据获取、行渲染）。
 */

import type React from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { CalendarDays, ListTodo, MessageSquareText, Sparkles, Server } from 'lucide-react'
import { MentionList } from './MentionList'
import type { MentionListRef } from './MentionList'
import { createDebouncedSuggestionLoader, createLatestSuggestionRequestGuard, createMentionPopup, positionPopup, isSuggestionTriggerPresent, shouldSuppressEscTrigger, shouldClearEscSuppressionOnExit, type EscSuppressedTrigger } from './mention-popup-utils'
import type { AgentSessionReferenceSearchResult } from '@proma/shared'
import { shouldAllowMentionTrigger, shouldShowMentionSuggestion } from '@/components/ai-elements/mention-utils'
import {
  buildPlanningReferenceItems,
  filterPlanningReferenceItems,
  getPlanningReferenceRange,
  type PlanningReferenceMenuItem,
  type PlanningReferenceType,
} from './planning-reference-state'

// ===== 泛型工厂 =====

interface MentionSuggestionConfig<T> {
  /** 触发字符 */
  char: string
  /** 标题栏左侧标签（面板类型） */
  headerLabel: string
  /** 空列表占位文字 */
  emptyText: string
  /** 异步获取列表项 */
  fetchItems: (slug: string, query: string) => Promise<T[]>
  /** 无需工作区上下文的全局引用（会话、规划）可跳过 context 校验。 */
  requiresContext?: boolean
  /** 提取唯一 key */
  keyExtractor: (item: T) => string
  /** 渲染列表项 */
  renderItem: (item: T) => React.ReactNode
  /** 选中后传给 command 的 Mention 属性 */
  toCommand: (item: T) => { id: string; label: string; referenceType?: PlanningReferenceType }
}

function createMentionSuggestion<T>(
  config: MentionSuggestionConfig<T>,
  workspaceSlugRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
  mentionItemCountRef: React.MutableRefObject<number>,
): Omit<SuggestionOptions<T>, 'editor'> {
  // Esc 抑制：记录被 Esc 关闭的触发片段文本。
  // TipTap suggestion 按 Esc 后会 dispatchExit 置 inactive，但触发符仍在文档中，
  // 继续输入会再次 onStart 弹窗；这里在 onStart 时对同一片段跳过建弹窗，
  // 直到用户重新触发（片段结束或内容变化）才恢复正常。
  // 用文本而非位置判断：删除触发符前的字符导致位置移动时，片段仍延续，继续抑制。
  let suppressedTrigger: EscSuppressedTrigger | null = null
  const requestGuard = createLatestSuggestionRequestGuard<T>()
  const queryLoader = createDebouncedSuggestionLoader(requestGuard)

  return {
    char: config.char,
    allowSpaces: false,
    // allowedPrefixes 为 null：允许任意字符前缀触发（含中文等无空格场景，如 `你好#`）。
    // 注意：设为 [' '] 不能阻止"空输入框触发"——TipTap 在块开头的前缀为空串，
    // 始终通过校验；却会让中文/单词后紧跟触发符无法触发，属回归。
    allowedPrefixes: null,
    shouldShow: ({ transaction }) => shouldShowMentionSuggestion(transaction.getMeta('uiEvent')),
    allow: ({ state, range }) => {
      const $trigger = state.doc.resolve(range.from)
      const paragraphStart = $trigger.start()
      const paragraphEnd = $trigger.end()
      const paragraphText = state.doc.textBetween(paragraphStart, paragraphEnd, '\n', '\n')
      const isCodeContext = $trigger.parent.type.name === 'codeBlock'
        || $trigger.marks().some((mark) => mark.type.name === 'code')

      return shouldAllowMentionTrigger({
        paragraphText,
        triggerOffset: range.from - paragraphStart,
        trigger: config.char,
        isCodeContext,
      })
    },

    items: ({ query }): Promise<T[]> => queryLoader.load(async () => {
      const slug = workspaceSlugRef.current
      if (config.requiresContext !== false && !slug) return []
      return config.fetchItems(slug ?? '', (query ?? '').toLowerCase())
    }),

    render: () => {
      let renderer: ReactRenderer<MentionListRef> | null = null
      let popup: HTMLDivElement | null = null
      let blurHandler: (() => void) | null = null
      let editorDom: HTMLElement | null = null

      function cleanup() {
        queryLoader.cancel()
        if (blurHandler && editorDom) {
          editorDom.removeEventListener('blur', blurHandler, true)
          blurHandler = null
        }
        editorDom = null
        mentionActiveRef.current = false
        mentionItemCountRef.current = 0
        popup?.remove()
        popup = null
        renderer?.destroy()
        renderer = null
      }

      return {
        onStart(props) {
          // TipTap 3.29 会在 items() 异步读取前以未登记的空数组调用 onStart。
          // 仅拒绝已知的旧请求，不能用 isLatest() 拒绝该初始生命周期，否则弹窗永远不会创建。
          if (requestGuard.isStale(props.items)) {
            return
          }
          if (popup || renderer) {
            cleanup()
          }

          // 防御异步竞态：await items() 期间触发符可能已被删除导致 suggestion 退出，
          // 插件仍会用过期 props 调用 onStart；过期则跳过建弹窗，避免残留幽灵弹窗。
          if (!isSuggestionTriggerPresent(props.editor, props.range, config.char)) {
            return
          }

          // Esc 抑制：同一触发片段（位置未后移且文本延续）不再弹窗，保持抑制；
          // 用户重新输入触发符（位置后移）、片段已结束或内容变化时清除抑制并正常弹窗。
          if (shouldSuppressEscTrigger(suppressedTrigger, { from: props.range.from, text: props.text })) {
            return
          }
          suppressedTrigger = null

          mentionActiveRef.current = true
          mentionItemCountRef.current = props.items.length
          editorDom = props.editor.view.dom
          renderer = new ReactRenderer(MentionList, {
            props: {
              items: props.items,
              emptyText: config.emptyText,
              headerLabel: config.headerLabel,
              keyExtractor: config.keyExtractor,
              renderItem: config.renderItem,
              onSelect: (item: T) => {
                const cmd = config.toCommand(item)
                props.command({ ...cmd, mentionSuggestionChar: config.char })
                props.editor.chain().insertContent(' ').run()
              },
            },
            editor: props.editor,
          })
          popup = createMentionPopup(renderer.element)
          positionPopup(popup, props.clientRect?.())

          blurHandler = () => {
            setTimeout(() => {
              if (!props.editor.view.hasFocus() && popup) {
                cleanup()
              }
            }, 100)
          }
          editorDom.addEventListener('blur', blurHandler, true)
        },

        onUpdate(props) {
          // 仅允许最新异步请求更新弹窗。
          if (!requestGuard.isLatest(props.items)) {
            return
          }
          mentionItemCountRef.current = props.items.length
          renderer?.updateProps({
            items: props.items,
            onSelect: (item: T) => {
              const cmd = config.toCommand(item)
              props.command({ ...cmd, mentionSuggestionChar: config.char })
              props.editor.chain().insertContent(' ').run()
            },
          })
          positionPopup(popup, props.clientRect?.())
        },

        onKeyDown(props) {
          // 记录 Esc 关闭时的触发片段文本与位置，onStart/onExit 据此判断同一片段
          if (props.event.key === 'Escape') {
            suppressedTrigger = {
              from: props.range.from,
              text: props.view.state.doc.textBetween(props.range.from, props.range.to, '', ''),
            }
          }
          return renderer?.ref?.onKeyDown({ event: props.event }) ?? false
        },

        onExit(props) {
          // TipTap 会在 await items() 后才调用 onExit；旧请求不能清理新弹窗。
          if (requestGuard.isStale(props.items)) {
            return
          }
          // 被抑制的触发符已从文档中删除 → 清除抑制，让用户重新输入触发符时恢复正常弹窗
          if (suppressedTrigger && shouldClearEscSuppressionOnExit(suppressedTrigger, props.editor, props.range, config.char)) {
            suppressedTrigger = null
          }
          cleanup()
        },
      }
    },
  }
}

// ===== Skill 配置 =====

export interface SkillMentionItem {
  id: string
  name: string
  description?: string
}

export function createSkillMentionSuggestion(
  workspaceSlugRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
  mentionItemCountRef: React.MutableRefObject<number>,
) {
  return createMentionSuggestion<SkillMentionItem>(
    {
      char: '/',
      headerLabel: '调用 skill',
      emptyText: '无匹配 Skill',
      fetchItems: async (slug, q) => {
        const caps = await window.electronAPI.getWorkspaceCapabilities(slug)
        return caps.skills
          .filter((s) => s.enabled)
          .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.slug ?? '').toLowerCase().includes(q))
          .map((s) => ({ id: s.slug, name: s.name, description: s.description }))
      },
      keyExtractor: (item) => item.id,
      renderItem: (item) => (
        <>
          <Sparkles className="size-3.5 text-violet-500 flex-shrink-0" />
          <span className="truncate font-medium flex-1 min-w-0">{item.name}</span>
          {item.description && (
            <span className="truncate text-[10px] text-muted-foreground/50 max-w-[120px]">{item.description}</span>
          )}
        </>
      ),
      toCommand: (item) => ({ id: item.id, label: item.name }),
    },
    workspaceSlugRef,
    mentionActiveRef,
    mentionItemCountRef,
  )
}

// ===== MCP 配置 =====

export interface McpMentionItem {
  id: string
  name: string
  type: string
}

export function createMcpMentionSuggestion(
  workspaceSlugRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
  mentionItemCountRef: React.MutableRefObject<number>,
) {
  return createMentionSuggestion<McpMentionItem>(
    {
      char: '#',
      headerLabel: 'MCP 服务',
      emptyText: '无匹配 MCP 服务',
      fetchItems: async (slug, q) => {
        const caps = await window.electronAPI.getWorkspaceCapabilities(slug)
        return caps.mcpServers
          .filter((s) => s.enabled)
          .filter((s) => !q || s.name.toLowerCase().includes(q))
          .map((s) => ({ id: s.name, name: s.name, type: s.type }))
      },
      keyExtractor: (item) => item.id,
      renderItem: (item) => (
        <>
          <Server className="size-3.5 text-emerald-500 flex-shrink-0" />
          <span className="truncate font-medium flex-1 min-w-0">{item.name}</span>
          <span className="truncate text-[10px] text-muted-foreground/50 max-w-[120px]">{item.type}</span>
        </>
      ),
      toCommand: (item) => ({ id: item.id, label: item.name }),
    },
    workspaceSlugRef,
    mentionActiveRef,
    mentionItemCountRef,
  )
}

// ===== Agent 会话引用配置 =====

export type SessionMentionItem = AgentSessionReferenceSearchResult

// 空查询只读会话索引，可安全展示更多；搜索会读取 JSONL 消息，保持较小上限避免阻塞主进程。
const RECENT_SESSION_MENTION_LIMIT = 200
const SEARCHED_SESSION_MENTION_LIMIT = 20
const PLANNING_REFERENCE_LIMIT = 100

export function createSessionMentionSuggestion(
  currentSessionIdRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
  mentionItemCountRef: React.MutableRefObject<number>,
) {
  return createMentionSuggestion<SessionMentionItem>(
    {
      char: '&',
      headerLabel: '引用会话',
      emptyText: '无匹配会话',
      requiresContext: false,
      fetchItems: async (_context, q) => {
        return window.electronAPI.searchAgentSessionReferences({
          excludeSessionId: currentSessionIdRef.current ?? undefined,
          query: q,
          limit: q ? SEARCHED_SESSION_MENTION_LIMIT : RECENT_SESSION_MENTION_LIMIT,
        })
      },
      keyExtractor: (item) => item.sessionId,
      renderItem: (item) => (
        <>
          <MessageSquareText className="size-3.5 text-sky-500 flex-shrink-0" />
          <span className="truncate font-medium flex-1 min-w-0">{item.title}</span>
          {(item.workspaceName || item.workspaceSlug || item.snippet) && (
            <span className="truncate text-[10px] text-muted-foreground/50 max-w-[120px]">
              {formatSessionReferenceDescription(item)}
            </span>
          )}
        </>
      ),
      toCommand: (item) => ({ id: item.sessionId, label: item.title }),
    },
    currentSessionIdRef,
    mentionActiveRef,
    mentionItemCountRef,
  )
}

export function createPlanningMentionSuggestion(
  trigger: '~' | '～',
  currentSessionIdRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
  mentionItemCountRef: React.MutableRefObject<number>,
) {
  return createMentionSuggestion<PlanningReferenceMenuItem>(
    {
      char: trigger,
      headerLabel: '引用待办和日程',
      emptyText: '无匹配待办或日程',
      requiresContext: false,
      fetchItems: async (_context, query) => {
        const { from, toExclusive } = getPlanningReferenceRange()
        const [todos, events] = await Promise.all([
          window.electronAPI.listTodos({ status: 'open', limit: PLANNING_REFERENCE_LIMIT }),
          window.electronAPI.listCalendarEvents({ from, to: toExclusive, limit: PLANNING_REFERENCE_LIMIT }),
        ])
        return filterPlanningReferenceItems(
          buildPlanningReferenceItems(todos, events),
          query,
        )
      },
      keyExtractor: (item) => `${item.referenceType}:${item.id}`,
      renderItem: (item) => (
        <>
          {item.referenceType === 'todo'
            ? <ListTodo className="size-3.5 shrink-0 text-primary" />
            : <CalendarDays className="size-3.5 shrink-0 text-primary" />}
          <span className="truncate font-medium flex-1 min-w-0">{item.label}</span>
          <span className="truncate text-[10px] text-muted-foreground/50 max-w-[120px]">{item.description}</span>
        </>
      ),
      toCommand: (item) => ({
        id: item.id,
        label: item.label,
        referenceType: item.referenceType,
      }),
    },
    currentSessionIdRef,
    mentionActiveRef,
    mentionItemCountRef,
  )
}

function formatSessionReferenceDescription(input: AgentSessionReferenceSearchResult): string | undefined {
  const workspace = input.workspaceName
    ? input.workspaceSlug && input.workspaceSlug !== input.workspaceName
      ? `${input.workspaceName} (${input.workspaceSlug})`
      : input.workspaceName
    : input.workspaceSlug
  const parts = [workspace ? `项目：${workspace}` : undefined, input.snippet]
    .filter((part): part is string => Boolean(part))

  return parts.length > 0 ? parts.join(' · ') : undefined
}
