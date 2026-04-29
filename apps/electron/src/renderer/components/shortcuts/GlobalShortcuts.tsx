/**
 * GlobalShortcuts — 全局快捷键注册 + 初始化组件
 *
 * 在 main.tsx 顶层挂载（类似 AgentListenersInitializer），永不销毁。
 * 负责：
 * 1. 初始化快捷键注册表
 * 2. 从 settings 加载用户自定义配置
 * 3. 注册所有应用级快捷键的 handler
 * 4. 监听菜单 IPC 事件（Cmd+W 关闭标签）
 */

import { useEffect, useCallback } from 'react'
import { useAtomValue, useSetAtom, useAtom, useStore } from 'jotai'
import { appModeAtom } from '@/atoms/app-mode'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import {
  tabsAtom,
  activeTabIdAtom,
  sidebarCollapsedAtom,
  openTab,
} from '@/atoms/tab-atoms'
import { shortcutOverridesAtom, sendWithCmdEnterAtom } from '@/atoms/shortcut-atoms'
import {
  agentPendingPromptAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentChannelIdAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import {
  chatPendingMessageAtom,
  conversationsAtom,
  currentConversationIdAtom,
  selectedModelAtom,
} from '@/atoms/chat-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { useCreateSession } from '@/hooks/useCreateSession'
import { useShortcut } from '@/hooks/useShortcut'
import { useCloseTab } from '@/hooks/useCloseTab'
import {
  initShortcutRegistry,
  updateShortcutOverrides,
} from '@/lib/shortcut-registry'

/**
 * 快捷键初始化 + 全局 Handler 注册
 *
 * 挂载后从 settings 加载自定义配置，并注册所有应用级快捷键。
 */
export function GlobalShortcuts(): null {
  const [appMode, setAppMode] = useAtom(appModeAtom)
  const [settingsOpen, setSettingsOpen] = useAtom(settingsOpenAtom)
  const [searchOpen, setSearchOpen] = useAtom(searchDialogOpenAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const setShortcutOverrides = useSetAtom(shortcutOverridesAtom)
  const shortcutOverrides = useAtomValue(shortcutOverridesAtom)
  const setSendWithCmdEnter = useSetAtom(sendWithCmdEnterAtom)
  const { createChat, createAgent } = useCreateSession()

  // Tab 管理（用于关闭标签页）
  const activeTabId = useAtomValue(activeTabIdAtom)

  // 统一关闭逻辑：与 TabBar.handleClose 共用
  // 含 Agent 子进程 stop + 流式中的确认对话框（修复 Issue #357）
  const { requestClose } = useCloseTab()

  // 初始化：挂载注册表 + 加载用户配置
  useEffect(() => {
    initShortcutRegistry()

    window.electronAPI.getSettings().then((settings) => {
      if (settings.shortcutOverrides) {
        setShortcutOverrides(settings.shortcutOverrides)
        updateShortcutOverrides(settings.shortcutOverrides)
      }
      setSendWithCmdEnter(settings.sendWithCmdEnter ?? false)
    }).catch(console.error)
  }, [setShortcutOverrides, setSendWithCmdEnter])

  // 配置变更时同步到注册表
  useEffect(() => {
    updateShortcutOverrides(shortcutOverrides)
  }, [shortcutOverrides])

  // ===== 关闭标签页逻辑 =====

  const handleCloseTab = useCallback(() => {
    // 浮窗优先：有浮窗打开时 Cmd+W 先关闭浮窗而非 tab
    if (settingsOpen) {
      setSettingsOpen(false)
      return
    }
    if (searchOpen) {
      setSearchOpen(false)
      return
    }

    if (!activeTabId) return
    requestClose(activeTabId)
  }, [settingsOpen, setSettingsOpen, searchOpen, setSearchOpen, activeTabId, requestClose])

  // 监听菜单 IPC 事件（Cmd+W 被 Electron 菜单拦截后通过 IPC 转发）
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuCloseTab(handleCloseTab)
    return cleanup
  }, [handleCloseTab])

  // 同时注册到快捷键系统（用于设置面板展示和自定义，实际触发走 IPC）
  useShortcut('close-tab', handleCloseTab)

  // ===== 快捷键 Handler =====

  // Cmd+, → 打开设置
  useShortcut(
    'open-settings',
    useCallback(() => setSettingsOpen(true), [setSettingsOpen]),
  )

  // Cmd+F → 全局搜索
  useShortcut(
    'global-search',
    useCallback(() => setSearchOpen(true), [setSearchOpen]),
  )

  // Cmd+N → 新建对话/会话（根据当前模式）
  useShortcut(
    'new-session',
    useCallback(() => {
      if (appMode === 'agent') {
        createAgent({ draft: true })
      } else {
        createChat({ draft: true })
      }
    }, [appMode, createAgent, createChat]),
  )

  // Cmd+B → 切换侧边栏
  useShortcut(
    'toggle-sidebar',
    useCallback(
      () => setSidebarCollapsed(!sidebarCollapsed),
      [sidebarCollapsed, setSidebarCollapsed],
    ),
  )

  // Cmd+Shift+M → 切换模式
  useShortcut(
    'toggle-mode',
    useCallback(
      () => setAppMode(appMode === 'chat' ? 'agent' : 'chat'),
      [appMode, setAppMode],
    ),
  )

  // Cmd+K → 清除上下文（通过 CustomEvent 分发到 ChatInput）
  useShortcut(
    'clear-context',
    useCallback(() => {
      window.dispatchEvent(new CustomEvent('proma:clear-context'))
    }, []),
  )

  // Cmd+L → 聚焦输入框（通过 CustomEvent 分发到 ChatInput/AgentView）
  useShortcut(
    'focus-input',
    useCallback(() => {
      window.dispatchEvent(new CustomEvent('proma:focus-input'))
    }, []),
  )

  // Cmd+Shift+Backspace → 停止 Agent（通过 CustomEvent 分发到 ChatView/AgentView）
  useShortcut(
    'stop-generation',
    useCallback(() => {
      window.dispatchEvent(new CustomEvent('proma:stop-generation'))
    }, []),
  )

  // ===== 快速任务窗口 → 创建会话并自动发送 =====

  const store = useStore()

  useEffect(() => {
    const cleanup = window.electronAPI.onQuickTaskOpenSession(async (data) => {
      try {
        // 切换到对应模式
        store.set(appModeAtom, data.mode)
        store.set(activeViewAtom, 'conversations')

        if (data.mode === 'agent') {
          // Agent 模式：创建会话 + 保存附件到 session 目录
          const channelId = store.get(agentChannelIdAtom) || undefined
          const workspaceId = store.get(currentAgentWorkspaceIdAtom) || undefined
          const meta = await window.electronAPI.createAgentSession(
            undefined,
            channelId,
            workspaceId,
          )
          // 更新 atom 状态
          store.set(agentSessionsAtom, (prev) => [meta, ...prev])
          store.set(currentAgentSessionIdAtom, meta.id)

          // 处理附件：保存到 session 目录，构建 file references
          let fileReferences = ''
          if (data.files && data.files.length > 0 && workspaceId) {
            const workspaces = store.get(agentWorkspacesAtom)
            const workspace = workspaces.find((w) => w.id === workspaceId)
            if (workspace) {
              try {
                const filesToSave = data.files.map((f) => ({
                  filename: f.filename,
                  data: f.base64,
                }))
                const saved = await window.electronAPI.saveFilesToAgentSession({
                  workspaceSlug: workspace.slug,
                  sessionId: meta.id,
                  files: filesToSave,
                })
                const refs = saved.map((f) => `- ${f.filename}: ${f.targetPath}`).join('\n')
                fileReferences = `<attached_files>\n${refs}\n</attached_files>\n\n`
              } catch (error) {
                console.error('[快速任务] 保存 Agent 附件失败:', error)
              }
            }
          }

          // 打开新标签页
          const currentTabs = store.get(tabsAtom)
          const result = openTab(currentTabs, {
            type: 'agent',
            sessionId: meta.id,
            title: data.text.slice(0, 30),
          })
          store.set(tabsAtom, result.tabs)
          store.set(activeTabIdAtom, result.activeTabId)

          // 设置待发送消息（附件引用已内联到消息文本中）
          store.set(agentPendingPromptAtom, {
            sessionId: meta.id,
            message: fileReferences + data.text,
          })
        } else {
          // Chat 模式：创建对话 + 保存附件到磁盘
          const chatModel = store.get(selectedModelAtom)
          const meta = await window.electronAPI.createConversation(
            undefined,
            chatModel?.modelId,
            chatModel?.channelId,
          )
          // 更新 atom 状态
          store.set(conversationsAtom, (prev) => [meta, ...prev])
          store.set(currentConversationIdAtom, meta.id)

          // 处理附件：保存到磁盘，收集 FileAttachment[]
          const savedAttachments: import('@proma/shared').FileAttachment[] = []
          if (data.files && data.files.length > 0) {
            for (const file of data.files) {
              try {
                const result = await window.electronAPI.saveAttachment({
                  conversationId: meta.id,
                  filename: file.filename,
                  mediaType: file.mediaType,
                  data: file.base64,
                })
                savedAttachments.push(result.attachment)
              } catch (error) {
                console.error('[快速任务] 保存 Chat 附件失败:', error)
              }
            }
          }

          // 打开新标签页
          const currentTabs = store.get(tabsAtom)
          const tabResult = openTab(currentTabs, {
            type: 'chat',
            sessionId: meta.id,
            title: data.text.slice(0, 30),
          })
          store.set(tabsAtom, tabResult.tabs)
          store.set(activeTabIdAtom, tabResult.activeTabId)

          // 设置待发送消息（含已保存的附件）
          store.set(chatPendingMessageAtom, {
            conversationId: meta.id,
            message: data.text,
            attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
          })
        }
      } catch (error) {
        console.error('[快速任务] 创建会话失败:', error)
      }
    })
    return cleanup
  }, [store])

  return null
}
