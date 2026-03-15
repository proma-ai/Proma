/**
 * FileMentionSuggestion — TipTap Mention Suggestion 配置
 *
 * 工厂函数，创建用于 @ 引用文件的 TipTap Suggestion 配置。
 * 输入 @ 后异步搜索工作区文件，弹出 FileMentionList 浮动列表。
 */

import type React from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { FileMentionList } from './FileMentionList'
import type { FileMentionRef } from './FileMentionList'
import type { FileIndexEntry } from '@proma/shared'
import { createMentionPopup, positionPopup } from '@/components/agent/mention-popup-utils'

/**
 * 创建文件 @ 引用的 Suggestion 配置
 *
 * @param workspacePathRef 当前工作区根路径引用
 * @param mentionActiveRef 是否正在 mention 模式（用于阻止 Enter 发送消息）
 * @param attachedDirsRef 附加目录路径列表引用（搜索时一并扫描）
 */
export function createFileMentionSuggestion(
  workspacePathRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
  attachedDirsRef?: React.RefObject<string[]>,
): Omit<SuggestionOptions<FileIndexEntry>, 'editor'> {
  return {
    char: '@',
    allowSpaces: false,

    // 异步搜索文件
    items: async ({ query }): Promise<FileIndexEntry[]> => {
      const wsPath = workspacePathRef.current
      if (!wsPath) return []

      try {
        const additionalPaths = attachedDirsRef?.current ?? []
        const result = await window.electronAPI.searchWorkspaceFiles(
          wsPath,
          query ?? '',
          20,
          additionalPaths.length > 0 ? additionalPaths : undefined,
        )
        return result.entries
      } catch {
        return []
      }
    },

    // 渲染下拉列表
    render: () => {
      let renderer: ReactRenderer<FileMentionRef> | null = null
      let popup: HTMLDivElement | null = null

      return {
        onStart(props) {
          mentionActiveRef.current = true
          renderer = new ReactRenderer(FileMentionList, {
            props: {
              items: props.items,
              selectedIndex: 0,
              onSelect: (item: FileIndexEntry) => {
                props.command({ id: item.path, label: item.name })
              },
            },
            editor: props.editor,
          })

          popup = createMentionPopup(renderer.element)
          positionPopup(popup, props.clientRect?.())
        },

        onUpdate(props) {
          renderer?.updateProps({ items: props.items })
          positionPopup(popup, props.clientRect?.())
        },

        onKeyDown(props) {
          return renderer?.ref?.onKeyDown({ event: props.event }) ?? false
        },

        onExit() {
          mentionActiveRef.current = false
          popup?.remove()
          popup = null
          renderer?.destroy()
          renderer = null
        },
      }
    },
  }
}
