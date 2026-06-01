/**
 * FileMentionSuggestion — TipTap Mention Suggestion 配置
 *
 * 工厂函数，创建用于 @ 引用文件的 TipTap Suggestion 配置。
 * 输入 @ 后异步搜索工作区文件，弹出 FileMentionList 浮动列表。
 * 弹窗底部锚定在光标上方，展开文件夹时向上生长。
 */

import type React from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { toast } from 'sonner'
import { FileMentionList } from './FileMentionList'
import type { FileMentionRef } from './FileMentionList'
import type { FileIndexEntry, FileSearchResult } from '@proma/shared'
import { createMentionPopup, positionPopup } from '@/components/agent/mention-popup-utils'

export function createFileMentionSuggestion(
  workspacePathRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
  attachedDirsRef?: React.RefObject<string[]>,
  mentionItemCountRef?: React.MutableRefObject<number>,
  sessionAttachedDirsRef?: React.RefObject<string[]>,
): Omit<SuggestionOptions<FileIndexEntry>, 'editor'> {
  let lastResult: FileSearchResult | null = null
  let missingWorkspaceToastShown = false

  return {
    char: '@',
    allowSpaces: false,
    allowedPrefixes: null,

    items: async ({ query }): Promise<FileIndexEntry[]> => {
      const wsPath = workspacePathRef.current
      if (!wsPath) {
        console.warn('[FileMention] workspacePath is null, mention disabled')
        if (!missingWorkspaceToastShown) {
          toast.warning('暂时无法引用文件', {
            description: '当前 Agent 会话没有可用的工作区路径。请在顶部选择工作区，或新建 Agent 会话后重试。',
          })
          missingWorkspaceToastShown = true
        }
        return []
      }
      missingWorkspaceToastShown = false

      try {
        const additionalPaths = attachedDirsRef?.current ?? []
        const sessionPaths = sessionAttachedDirsRef?.current ?? []

        const result = await window.electronAPI.searchWorkspaceFiles(
          wsPath,
          query ?? '',
          200,
          additionalPaths.length > 0 ? additionalPaths : undefined,
          sessionPaths.length > 0 ? sessionPaths : undefined,
        )
        lastResult = result
        return result.entries
      } catch(e) {
        console.error('[FileMention] search failed:', e)
        lastResult = null
        return []
      }
    },

    render: () => {
      let renderer: ReactRenderer<FileMentionRef> | null = null
      let popup: HTMLDivElement | null = null
      let resizeObserver: ResizeObserver | null = null
      let latestClientRect: (() => DOMRect | null) | null | undefined = null
      let blurHandler: (() => void) | null = null
      let editorRef: SuggestionProps<FileIndexEntry>['editor'] | null = null

      function splitEntries(result: FileSearchResult | null) {
        return {
          sessionEntries: result?.sessionEntries ?? [],
          workspaceEntries: result?.workspaceEntries ?? [],
        }
      }

      function createRenderer(props: SuggestionProps<FileIndexEntry>) {
        const { sessionEntries, workspaceEntries } = splitEntries(lastResult)
        renderer = new ReactRenderer(FileMentionList, {
          props: {
            sessionEntries,
            workspaceEntries,
            onSelect: (item: { name: string; path: string; type: 'file' | 'dir' }) => {
              props.command({ id: item.path, label: item.name })
            },
          },
          editor: props.editor,
        })
      }

      function anchorPopup() {
        if (!popup) return
        positionPopup(popup, latestClientRect?.(), { anchorBottom: true })
      }

      function cleanup() {
        if (blurHandler && editorRef) {
          editorRef.view.dom.removeEventListener('blur', blurHandler, true)
          blurHandler = null
        }
        editorRef = null
        mentionActiveRef.current = false
        if (mentionItemCountRef) mentionItemCountRef.current = 0
        lastResult = null
        latestClientRect = null
        resizeObserver?.disconnect()
        resizeObserver = null
        popup?.remove()
        popup = null
        renderer?.destroy()
        renderer = null
      }

      return {
        onStart(props) {
          // 防御竞态：如果上一次弹窗未被正确清理，先清理残留
          if (popup || renderer) {
            cleanup()
          }

          mentionActiveRef.current = true
          if (mentionItemCountRef) mentionItemCountRef.current = props.items.length
          editorRef = props.editor

          try {
            latestClientRect = props.clientRect
            createRenderer(props)
            popup = createMentionPopup(renderer!.element)
            anchorPopup()

            resizeObserver = new ResizeObserver(() => {
              anchorPopup()
            })
            resizeObserver.observe(popup!)

            // 编辑器失焦时强制关闭弹窗（点击页面其他区域等场景）
            blurHandler = () => {
              // 延迟检查：点击弹窗本身不应关闭（焦点会回到编辑器）
              setTimeout(() => {
                if (!editorRef?.view.hasFocus() && popup) {
                  cleanup()
                }
              }, 100)
            }
            props.editor.view.dom.addEventListener('blur', blurHandler, true)
          } catch (e) {
            console.error('[FileMention] render popup failed:', e)
            cleanup()
          }
        },

        onUpdate(props) {
          if (mentionItemCountRef) mentionItemCountRef.current = props.items.length
          latestClientRect = props.clientRect

          const { sessionEntries, workspaceEntries } = splitEntries(lastResult)
          renderer?.updateProps({
            sessionEntries,
            workspaceEntries,
            onSelect: (item: { name: string; path: string; type: 'file' | 'dir' }) => {
              props.command({ id: item.path, label: item.name })
            },
          })
          anchorPopup()
        },

        onKeyDown(props) {
          if (renderer?.ref) {
            return renderer.ref.onKeyDown({ event: props.event })
          }
          return false
        },

        onExit() {
          cleanup()
        },
      }
    },
  }
}
