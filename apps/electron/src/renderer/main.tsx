/**
 * 渲染进程入口
 *
 * 挂载 React 应用，初始化主题系统。
 */

// 引入 Inter Variable 自托管字体（含 400/500/600/700 等所有字重）
// index.css 声明了全部语言子集（latin/latin-ext/cyrillic/greek/vietnamese 等），
// 但每个 @font-face 都带 unicode-range，浏览器仅按需下载实际用到的子集（本应用主要是 latin）。
import '@fontsource-variable/inter/index.css'

import React, { useEffect, useMemo, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { useSetAtom, useAtomValue, useStore } from 'jotai'
import App from './App'
import {
  themeModeAtom,
  themeStyleAtom,
  interfaceVariantAtom,
  systemIsDarkAtom,
  resolvedThemeAtom,
  applyThemeToDOM,
  applyInterfaceVariantToDOM,
  initializeTheme,
} from './atoms/theme'
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
  agentWorkspacesAtom,
  agentSessionsAtom,
  currentAgentWorkspaceIdAtom,
  currentAgentSessionIdAtom,
  workspaceCapabilitiesVersionAtom,
  workspaceFilesVersionAtom,
  agentThinkingAtom,
  agentEffortAtom,
  agentMaxBudgetUsdAtom,
  agentMaxTurnsAtom,
  agentSettingsReadyAtom,
  automationGroupOrderAtom,
  dockBadgeCountAtom,
  unviewedCompletedSessionIdsAtom,
} from './atoms/agent-atoms'
import { updateStatusAtom, initializeUpdater } from './atoms/updater'
import { automationsAtom } from './atoms/automation-atoms'
import {
  notificationsEnabledAtom,
  notificationSoundEnabledAtom,
  notificationSoundsAtom,
  initializeNotifications,
} from './atoms/notifications'
import {
  stickyUserMessageEnabledAtom,
  initializeUiPreferences,
} from './atoms/ui-preferences'
import {
  markdownFontSizeAtom,
  initializeMarkdownFontSize,
} from './atoms/markdown-font-size'
import { useGlobalAgentListeners } from './hooks/useGlobalAgentListeners'
import { useGlobalChatListeners } from './hooks/useGlobalChatListeners'
import { tabsAtom, activeTabIdAtom, ensureScratchPadTab, getPersistableTabState, scratchPadContentAtom, scratchPadLoadedAtom, SCRATCH_PAD_ID } from './atoms/tab-atoms'
import type { TabItem } from './atoms/tab-atoms'
import { chatToolsAtom } from './atoms/chat-tool-atoms'
import { feishuBotStatesAtom } from './atoms/feishu-atoms'
import { dingtalkBotStatesAtom } from './atoms/dingtalk-atoms'
import { currentConversationIdAtom, channelsAtom, channelsLoadedAtom, selectedModelAtom } from './atoms/chat-atoms'
import { appModeAtom } from './atoms/app-mode'
import type { FeishuBotBridgeState, FeishuBridgeState, DingTalkBotBridgeState, DingTalkBridgeState } from '@proma/shared'
import { Toaster } from './components/ui/sonner'
import { toast } from 'sonner'
import { diffCapabilities } from '@proma/shared'
import type { WorkspaceCapabilities } from '@proma/shared'
import { showCapabilityChangeToasts } from './lib/capabilities-toast'
import { UpdateDialog } from './components/settings/UpdateDialog'
import { GlobalShortcuts } from './components/shortcuts/GlobalShortcuts'
import { TabSwitcher } from './components/tabs/TabSwitcher'
import { htmlToMarkdown, markdownToHtml } from './lib/markdown-rich-text'
import './styles/globals.css'
import 'katex/dist/katex.min.css'

// ===== 窗口类型检测 =====
const isQuickTaskWindow = new URLSearchParams(window.location.search).get('window') === 'quick-task'
const isVoiceDictationWindow = new URLSearchParams(window.location.search).get('window') === 'voice-dictation'
const isDetachedPreviewWindow = new URLSearchParams(window.location.search).get('window') === 'detached-preview'

/**
 * 主题初始化组件
 *
 * 负责从主进程加载主题设置、监听系统主题变化、
 * 并将最终主题同步到 DOM。
 */
function ThemeInitializer(): null {
  const setThemeMode = useSetAtom(themeModeAtom)
  const setThemeStyle = useSetAtom(themeStyleAtom)
  const setInterfaceVariant = useSetAtom(interfaceVariantAtom)
  const setSystemIsDark = useSetAtom(systemIsDarkAtom)
  const themeMode = useAtomValue(themeModeAtom)
  const themeStyle = useAtomValue(themeStyleAtom)
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const systemIsDark = useAtomValue(systemIsDarkAtom)

  // 初始化：从主进程加载设置 + 订阅系统主题变化
  useEffect(() => {
    let isMounted = true
    let cleanup: (() => void) | undefined

    initializeTheme(setThemeMode, setSystemIsDark, setThemeStyle, setInterfaceVariant).then((fn) => {
      if (isMounted) {
        cleanup = fn
      } else {
        // 组件已卸载（StrictMode 场景），立即清理监听器
        fn()
      }
    })

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [setThemeMode, setSystemIsDark, setThemeStyle, setInterfaceVariant])

  // 响应式应用主题到 DOM
  // 用 useMemo 计算"实际会影响 DOM 的状态签名"作为唯一依赖：
  // special 模式下 systemIsDark 不影响最终 class，避免系统主题变化时触发无意义的
  // applyThemeToDOM 调用（配合 applyThemeToDOM 内部的幂等检查双重兜底）。
  const themeSignature = useMemo(() => {
    if (themeMode === 'special') {
      return `special:${themeStyle}`
    }
    if (themeMode === 'system') {
      return `system:${systemIsDark ? 'dark' : 'light'}`
    }
    return themeMode
  }, [themeMode, themeStyle, systemIsDark])

  useEffect(() => {
    applyThemeToDOM(themeMode, themeStyle, systemIsDark)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeSignature])

  useEffect(() => {
    applyInterfaceVariantToDOM(interfaceVariant)
  }, [interfaceVariant])

  return null
}

/**
 * Agent 设置初始化组件
 *
 * 从主进程加载 Agent 渠道/模型设置并写入 atoms。
 */
function AgentSettingsInitializer(): null {
  const setAgentChannelId = useSetAtom(agentChannelIdAtom)
  const setAgentModelId = useSetAtom(agentModelIdAtom)
  const setAgentChannelIds = useSetAtom(agentChannelIdsAtom)
  const setAgentWorkspaces = useSetAtom(agentWorkspacesAtom)
  const setCurrentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const bumpFiles = useSetAtom(workspaceFilesVersionAtom)
  const setThinking = useSetAtom(agentThinkingAtom)
  const setEffort = useSetAtom(agentEffortAtom)
  const setMaxBudget = useSetAtom(agentMaxBudgetUsdAtom)
  const setMaxTurns = useSetAtom(agentMaxTurnsAtom)
  const setAutomationGroupOrder = useSetAtom(automationGroupOrderAtom)

  const setAgentSettingsReady = useSetAtom(agentSettingsReadyAtom)
  const setChannels = useSetAtom(channelsAtom)
  const setChannelsLoaded = useSetAtom(channelsLoadedAtom)
  const store = useStore()

  // 读取当前工作区信息（用于能力变化 diff）
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 缓存上一次工作区能力（用于 diff 检测变化）
  const prevCapabilitiesRef = useRef<WorkspaceCapabilities | null>(null)
  // 初次加载标记 — 应用启动或切换工作区时不显示 toast
  const suppressToastRef = useRef(true)

  useEffect(() => {
    // 并行加载渠道列表和设置，确保两者都就绪后再验证渠道有效性
    Promise.all([
      window.electronAPI.listChannels(),
      window.electronAPI.getSettings(),
    ]).then(([channels, settings]) => {
      // 缓存渠道列表
      setChannels(channels)
      setChannelsLoaded(true)

      const channelIds = new Set(channels.map((c) => c.id))

      // 验证 Chat 模式的全局默认模型（localStorage 持久化的可能指向已删除渠道）
      const chatModel = store.get(selectedModelAtom)
      if (chatModel && !channelIds.has(chatModel.channelId)) {
        console.warn('[AgentSettings] Chat selectedModel 指向已删除的渠道，清除')
        store.set(selectedModelAtom, null)
      }

      // 验证并加载 Agent 渠道/模型
      if (settings.agentChannelId && channelIds.has(settings.agentChannelId)) {
        setAgentChannelId(settings.agentChannelId)
      } else if (settings.agentChannelId && !channelIds.has(settings.agentChannelId)) {
        // 渠道已删除，清除无效设置
        console.warn('[AgentSettings] agentChannelId 指向已删除的渠道，清除')
        window.electronAPI.updateSettings({ agentChannelId: undefined, agentModelId: undefined }).catch(console.error)
      }
      if (settings.agentModelId && (!settings.agentChannelId || channelIds.has(settings.agentChannelId))) {
        setAgentModelId(settings.agentModelId)
      }

      // 加载 Agent 启用渠道列表，过滤已删除的渠道
      if (settings.agentChannelIds && settings.agentChannelIds.length > 0) {
        const validIds = settings.agentChannelIds.filter((id) => channelIds.has(id))
        setAgentChannelIds(validIds)
        // 如果有渠道被清理，持久化更新后的列表
        if (validIds.length !== settings.agentChannelIds.length) {
          console.warn('[AgentSettings] 清理了已删除的 agentChannelIds')
          window.electronAPI.updateSettings({ agentChannelIds: validIds }).catch(console.error)
        }
      } else if (settings.agentChannelId && channelIds.has(settings.agentChannelId)) {
        // 迁移：旧版本只有 agentChannelId，自动转为数组
        const migrated = [settings.agentChannelId]
        setAgentChannelIds(migrated)
        window.electronAPI.updateSettings({ agentChannelIds: migrated }).catch(console.error)
      }

      // 兜底：agentChannelId 存在但不在 agentChannelIds 白名单中，自动修复不一致
      if (settings.agentChannelId && channelIds.has(settings.agentChannelId)) {
        const currentIds = settings.agentChannelIds?.filter((id) => channelIds.has(id)) ?? []
        if (!currentIds.includes(settings.agentChannelId)) {
          const fixedIds = [...currentIds, settings.agentChannelId]
          setAgentChannelIds(fixedIds)
          window.electronAPI.updateSettings({ agentChannelIds: fixedIds }).catch(console.error)
        }
      }

      if (settings.agentThinking) {
        setThinking(settings.agentThinking)
      }
      if (settings.agentEffort) {
        setEffort(settings.agentEffort)
      }
      if (settings.agentMaxBudgetUsd != null) {
        setMaxBudget(settings.agentMaxBudgetUsd)
      }
      if (settings.agentMaxTurns != null) {
        setMaxTurns(settings.agentMaxTurns)
      }
      if (typeof settings.agentAutomationGroupOrder === 'number') {
        setAutomationGroupOrder(settings.agentAutomationGroupOrder)
      }

      // 加载工作区列表并恢复上次选中的工作区
      window.electronAPI.listAgentWorkspaces().then((workspaces) => {
        setAgentWorkspaces(workspaces)
        if (settings.agentWorkspaceId) {
          // 验证工作区仍然存在
          const exists = workspaces.some((w) => w.id === settings.agentWorkspaceId)
          setCurrentWorkspaceId(exists ? settings.agentWorkspaceId! : workspaces[0]?.id ?? null)
        } else if (workspaces.length > 0) {
          setCurrentWorkspaceId(workspaces[0]!.id)
        }
        setAgentSettingsReady(true)
      }).catch((err) => {
        console.error(err)
        setAgentSettingsReady(true) // 即使出错也标记就绪，避免永远阻塞
      })
    }).catch((err) => {
      console.error(err)
      setAgentSettingsReady(true) // 即使出错也标记就绪，避免永远阻塞
    })
  }, [setAgentChannelId, setAgentModelId, setAgentChannelIds, setAgentWorkspaces, setCurrentWorkspaceId, setThinking, setEffort, setMaxBudget, setMaxTurns, setAutomationGroupOrder, setChannels, setChannelsLoaded, setAgentSettingsReady])

  // 工作区切换时重置能力缓存，预加载基线
  useEffect(() => {
    suppressToastRef.current = true
    prevCapabilitiesRef.current = null

    if (!currentWorkspaceId) return
    const ws = workspaces.find((w) => w.id === currentWorkspaceId)
    if (!ws) return

    window.electronAPI
      .getWorkspaceCapabilities(ws.slug)
      .then((caps) => {
        prevCapabilitiesRef.current = caps
        suppressToastRef.current = false
      })
      .catch(console.error)
  }, [currentWorkspaceId, workspaces])

  // 订阅主进程文件监听推送
  useEffect(() => {
    const unsubCapabilities = window.electronAPI.onCapabilitiesChanged(() => {
      // 查找当前工作区 slug
      const ws = workspaces.find((w) => w.id === currentWorkspaceId)
      if (ws) {
        window.electronAPI
          .getWorkspaceCapabilities(ws.slug)
          .then((newCaps) => {
            const prevCaps = prevCapabilitiesRef.current
            if (prevCaps && !suppressToastRef.current) {
              const changes = diffCapabilities(prevCaps, newCaps)
              showCapabilityChangeToasts(changes)
            }
            prevCapabilitiesRef.current = newCaps
            suppressToastRef.current = false
          })
          .catch(console.error)
      }

      bumpCapabilities((v) => v + 1)
    })
    const unsubFiles = window.electronAPI.onWorkspaceFilesChanged(() => {
      bumpFiles((v) => v + 1)
    })

    return () => {
      unsubCapabilities()
      unsubFiles()
    }
  }, [bumpCapabilities, bumpFiles, currentWorkspaceId, workspaces])

  return null
}

/**
 * 自动更新初始化组件
 *
 * 订阅主进程推送的更新状态变化事件。
 */
function UpdaterInitializer(): null {
  const setUpdateStatus = useSetAtom(updateStatusAtom)

  useEffect(() => {
    const cleanup = initializeUpdater(setUpdateStatus)
    return cleanup
  }, [setUpdateStatus])

  return null
}

/**
 * 定时任务初始化组件
 *
 * 加载全部定时任务，并订阅主进程的变更事件（运行完成/状态变化）刷新列表。
 */
function AutomationInitializer(): null {
  const setAutomations = useSetAtom(automationsAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)

  useEffect(() => {
    const load = (): void => {
      window.electronAPI.listAutomations().then(setAutomations).catch(console.error)
      window.electronAPI.listAgentSessions().then(setAgentSessions).catch(console.error)
    }
    load()
    const unsub = window.electronAPI.onAutomationChanged(load)
    return unsub
  }, [setAutomations, setAgentSessions])

  return null
}

/**
 * 通知初始化组件
 *
 * 从主进程加载通知开关设置。
 */
function NotificationsInitializer(): null {
  const setEnabled = useSetAtom(notificationsEnabledAtom)
  const setSoundEnabled = useSetAtom(notificationSoundEnabledAtom)
  const setSounds = useSetAtom(notificationSoundsAtom)

  useEffect(() => {
    initializeNotifications(setEnabled, setSoundEnabled, setSounds)
  }, [setEnabled, setSoundEnabled, setSounds])

  return null
}

/**
 * Dock/Launcher 角标同步组件
 *
 * 将需要用户处理或查看的事项数量同步到系统应用图标。
 */
function DockBadgeInitializer(): null {
  const count = useAtomValue(dockBadgeCountAtom)
  const notificationsEnabled = useAtomValue(notificationsEnabledAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const badgeCount = notificationsEnabled ? count : 0

  useEffect(() => {
    window.electronAPI.setDockBadgeCount(badgeCount).catch((error) => {
      console.error('[Dock 角标] 同步失败:', error)
    })
  }, [badgeCount])

  useEffect(() => {
    const clearCurrentSessionBadge = (): void => {
      if (!document.hasFocus() || !currentSessionId) return
      setUnviewedCompleted((prev) => {
        if (!prev.has(currentSessionId)) return prev
        const next = new Set(prev)
        next.delete(currentSessionId)
        return next
      })
    }

    clearCurrentSessionBadge()
    window.addEventListener('focus', clearCurrentSessionBadge)
    document.addEventListener('visibilitychange', clearCurrentSessionBadge)
    return () => {
      window.removeEventListener('focus', clearCurrentSessionBadge)
      document.removeEventListener('visibilitychange', clearCurrentSessionBadge)
    }
  }, [currentSessionId, setUnviewedCompleted])

  return null
}

/**
 * UI 偏好初始化组件
 *
 * 从主进程加载 UI 偏好设置（悬浮置顶条等）。
 */
function UiPreferencesInitializer(): null {
  const setStickyUserMessageEnabled = useSetAtom(stickyUserMessageEnabledAtom)

  useEffect(() => {
    initializeUiPreferences(setStickyUserMessageEnabled)
  }, [setStickyUserMessageEnabled])

  return null
}

/**
 * Markdown 字号初始化组件
 *
 * 从主进程加载字号档位，写入 :root CSS 变量驱动 Markdown 预览。
 */
function MarkdownFontSizeInitializer(): null {
  const setMarkdownFontSize = useSetAtom(markdownFontSizeAtom)

  useEffect(() => {
    initializeMarkdownFontSize(setMarkdownFontSize)
  }, [setMarkdownFontSize])

  return null
}

/**
 * Chat IPC 监听器初始化组件
 *
 * 全局挂载，永不销毁。确保 Chat 流式事件
 * 在页面切换时不丢失。
 */
function ChatListenersInitializer(): null {
  useGlobalChatListeners()
  return null
}

/**
 * Agent IPC 监听器初始化组件
 *
 * 全局挂载，永不销毁。确保 Agent 流式事件、权限请求
 * 在页面切换时不丢失。
 */
function AgentListenersInitializer(): null {
  useGlobalAgentListeners()
  return null
}

/**
 * Chat 工具初始化组件
 *
 * 启动时从主进程加载所有工具信息到 atom。
 * 订阅 chat-tools.json 文件变更通知，自动刷新工具列表。
 */
function ChatToolInitializer(): null {
  const setChatTools = useSetAtom(chatToolsAtom)

  useEffect(() => {
    window.electronAPI.getChatTools()
      .then(setChatTools)
      .catch((err: unknown) => console.error('[ChatToolInitializer] 加载工具列表失败:', err))
  }, [setChatTools])

  // 订阅自定义工具配置变更
  useEffect(() => {
    const cleanup = window.electronAPI.onCustomToolChanged(() => {
      window.electronAPI.getChatTools()
        .then((tools) => {
          setChatTools(tools)
          toast.success('Chat 工具已更新')
        })
        .catch((err: unknown) => console.error('[ChatToolInitializer] 刷新工具列表失败:', err))
    })
    return cleanup
  }, [setChatTools])

  return null
}

/**
 * 飞书集成初始化组件
 *
 * - 订阅飞书 Bridge 状态变化
 * - 定期上报用户在场状态（用于智能通知路由）
 * - 监听通知已发送事件（显示 Sonner + 桌面通知）
 */
function FeishuInitializer(): null {
  const store = useStore()

  useEffect(() => {
    // 加载初始多 Bot 状态
    window.electronAPI.getFeishuMultiStatus?.()
      .then((multiState: { bots: Record<string, FeishuBotBridgeState> }) => {
        store.set(feishuBotStatesAtom, multiState.bots)
      })
      .catch(() => {
        // 回退：使用旧 API 获取单 Bot 状态
        window.electronAPI.getFeishuStatus()
          .then((state: FeishuBridgeState) => {
            const s = state as FeishuBotBridgeState
            const botId = s.botId ?? 'default'
            store.set(feishuBotStatesAtom, { [botId]: { ...s, botId, botName: s.botName ?? '飞书助手' } })
          })
          .catch((err: unknown) => console.error('[FeishuInitializer] 加载状态失败:', err))
      })

    // 订阅状态变化（现在每次推送包含 botId）
    const cleanupStatus = window.electronAPI.onFeishuStatusChanged((raw: FeishuBridgeState) => {
      const state = raw as FeishuBotBridgeState
      const botId = state.botId ?? 'default'
      store.set(feishuBotStatesAtom, (prev) => ({
        ...prev,
        [botId]: { ...state, botId, botName: state.botName ?? '飞书助手' },
      }))
    })

    // 定期上报在场状态（5 秒间隔 + 焦点变化时即时上报）
    const reportPresence = (): void => {
      const activeSessionId = store.get(currentAgentSessionIdAtom) ?? store.get(currentConversationIdAtom)
      window.electronAPI.reportFeishuPresence({
        activeSessionId,
        lastInteractionAt: Date.now(),
      }).catch(() => { /* 忽略 */ })
    }
    const interval = setInterval(reportPresence, 5000)
    window.addEventListener('focus', reportPresence)
    window.addEventListener('blur', reportPresence)

    return () => {
      cleanupStatus()
      clearInterval(interval)
      window.removeEventListener('focus', reportPresence)
      window.removeEventListener('blur', reportPresence)
    }
  }, [store])

  return null
}

/**
 * DingTalkInitializer
 *
 * - 加载多 Bot 初始状态
 * - 订阅钉钉 Bridge 状态变化
 */
function DingTalkInitializer(): null {
  const store = useStore()

  useEffect(() => {
    // 加载初始多 Bot 状态
    window.electronAPI.getDingTalkMultiStatus?.()
      .then((multiState: { bots: Record<string, DingTalkBotBridgeState> }) => {
        store.set(dingtalkBotStatesAtom, multiState.bots)
      })
      .catch(() => {
        // 回退：使用旧 API 获取单 Bot 状态
        window.electronAPI.getDingTalkStatus()
          .then((state: DingTalkBridgeState) => {
            const s = state as DingTalkBotBridgeState
            const botId = s.botId ?? 'default'
            store.set(dingtalkBotStatesAtom, { [botId]: { ...s, botId, botName: s.botName ?? '钉钉助手' } })
          })
          .catch((err: unknown) => console.error('[DingTalkInitializer] 加载状态失败:', err))
      })

    // 订阅状态变化（现在每次推送包含 botId）
    const cleanupStatus = window.electronAPI.onDingTalkStatusChanged((raw: DingTalkBridgeState) => {
      const state = raw as DingTalkBotBridgeState
      const botId = state.botId ?? 'default'
      store.set(dingtalkBotStatesAtom, (prev) => ({
        ...prev,
        [botId]: { ...state, botId, botName: state.botName ?? '钉钉助手' },
      }))
    })

    return () => {
      cleanupStatus()
    }
  }, [store])

  return null
}

/**
 * 标签页持久化组件
 *
 * 启动时从 settings.tabState 恢复上次打开的标签页；
 * 运行时监听标签页变化，自动保存到 settings.json。
 */

/**
 * 旧版（分屏时代）持久化结构——仅用于向后兼容读取迁移。
 * 新版已扁平化为 { tabs, activeTabId }；旧版是 { tabs, splitLayout }。
 */
interface LegacyTabStateWithSplitLayout {
  splitLayout?: {
    focusedPanelIndex?: number
    panels?: Array<{ activeTabId?: string | null }>
  }
}

/** 从旧版 splitLayout 结构中提取原焦点面板的 activeTabId */
function extractLegacyActiveTabId(tabState: unknown): string | null {
  if (!tabState || typeof tabState !== 'object') return null
  const legacy = tabState as LegacyTabStateWithSplitLayout
  const panels = legacy.splitLayout?.panels
  if (!Array.isArray(panels) || panels.length === 0) return null
  const focusedIndex = legacy.splitLayout?.focusedPanelIndex ?? 0
  return panels[focusedIndex]?.activeTabId ?? panels[0]?.activeTabId ?? null
}

function TabStatePersistenceInitializer(): null {
  const store = useStore()
  const restoredRef = useRef(false)

  // 启动恢复：读取 settings.tabState + 校验会话有效性
  useEffect(() => {
    Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.listConversations(),
      window.electronAPI.listAgentSessions(),
    ]).then(([settings, conversations, agentSessions]) => {
      const tabState = settings.tabState
      if (!tabState?.tabs?.length) {
        restoredRef.current = true
        return
      }

      // 构建有效 sessionId 集合
      const validSessionIds = new Set([
        ...conversations.map((c) => c.id),
        ...agentSessions.map((s) => s.id),
      ])

      // 过滤 diff 类型 Tab（不持久化），同时过滤掉已被删除的会话
      const validTabs = tabState.tabs.filter(
        (t): t is TabItem =>
          typeof t === 'object' &&
          t !== null &&
          'id' in t &&
          'sessionId' in t &&
          'type' in t &&
          'title' in t &&
          (t.type === 'chat' || t.type === 'agent') &&
          validSessionIds.has(t.sessionId),
      )
      if (validTabs.length === 0) {
        restoredRef.current = true
        return
      }

      const validTabIds = new Set(validTabs.map((t) => t.id))

      // 恢复 activeTabId（校验有效性）
      let restoredActiveTabId: string | null = null
      if (tabState.activeTabId && validTabIds.has(tabState.activeTabId)) {
        restoredActiveTabId = tabState.activeTabId
      } else {
        // 向后兼容：从旧版 splitLayout 结构中恢复原焦点面板的 activeTabId
        const legacyId = extractLegacyActiveTabId(tabState)
        if (legacyId && validTabIds.has(legacyId)) {
          restoredActiveTabId = legacyId
        } else {
          restoredActiveTabId = validTabs[0]?.id ?? null
        }
      }

      const activeTab = validTabs.find((t) => t.id === restoredActiveTabId) ?? validTabs[0] ?? null
      store.set(tabsAtom, ensureScratchPadTab(activeTab ? [activeTab] : []))
      store.set(activeTabIdAtom, restoredActiveTabId)

      // 同步 appMode 和 currentSessionId
      if (activeTab) {
        if (activeTab.type === 'chat') {
          store.set(appModeAtom, 'chat')
          store.set(currentConversationIdAtom, activeTab.sessionId)
        } else {
          store.set(appModeAtom, 'agent')
          store.set(currentAgentSessionIdAtom, activeTab.sessionId)
        }
      }

      console.log(`[TabRestore] 已恢复当前会话入口，历史标签 ${validTabs.length} 个已收敛到左侧列表`)
    }).catch((err) => console.error('[TabRestore] 恢复标签页失败:', err))
      .finally(() => { restoredRef.current = true })
  }, [store])

  // 自动保存：监听 tabsAtom / activeTabIdAtom 变化，防抖写入 settings.json
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const save = (): void => {
      const tabs = store.get(tabsAtom)
      const activeTabId = store.get(activeTabIdAtom)
      const persistableTabState = getPersistableTabState(tabs, activeTabId)
      window.electronAPI.updateSettings({
        tabState: persistableTabState,
      }).catch(console.error)
    }

    const debouncedSave = (): void => {
      if (!restoredRef.current) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 500)
    }

    const unsub1 = store.sub(tabsAtom, debouncedSave)
    const unsub2 = store.sub(activeTabIdAtom, debouncedSave)

    // 窗口关闭前立即刷新，避免最后 500ms 内的变更丢失
    const handleBeforeUnload = (): void => {
      if (timer) clearTimeout(timer)
      // 使用同步 IPC 确保关闭前数据写入磁盘
      const tabs = store.get(tabsAtom)
      const activeTabId = store.get(activeTabIdAtom)
      const persistableTabState = getPersistableTabState(tabs, activeTabId)
      if (tabs.length > 0 && window.electronAPI.updateSettingsSync) {
        const ok = window.electronAPI.updateSettingsSync({ tabState: persistableTabState })
        if (!ok) {
          console.warn('[TabPersist] sync IPC failed, falling back to async save')
          save()
        }
      } else {
        save()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      unsub1()
      unsub2()
      if (timer) clearTimeout(timer)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [store])

  return null
}

/**
 * Scratch Pad 初始化和持久化组件
 *
 * 启动时注入 scratch tab 到 tabsAtom 首位，
 * 从磁盘加载 scratch-pad.md 内容，自动保存到磁盘。
 */
function ScratchPadPersistence(): null {
  const store = useStore()
  const loadedRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // 启动：加载文件内容、注入 scratch tab、恢复激活状态
  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        // 加载 scratch-pad.md 内容（磁盘存的是 markdown，转为 HTML 给编辑器用）
        const [settings, loadedMd] = await Promise.all([
          window.electronAPI.getSettings(),
          window.electronAPI.loadScratchPad ? window.electronAPI.loadScratchPad() : Promise.resolve(''),
        ])

        const loadedHtml = loadedMd ? markdownToHtml(loadedMd) : ''
        store.set(scratchPadContentAtom, loadedHtml)
        store.set(scratchPadLoadedAtom, true)

        // 将 scratch tab 注入首位
        const currentTabs = store.get(tabsAtom)
        const newTabs = ensureScratchPadTab(currentTabs)

        // 如果 tabs 数组变了（新增了 scratch tab），写入 store
        if (newTabs.length > currentTabs.length || newTabs[0]?.id !== currentTabs[0]?.id) {
          store.set(tabsAtom, newTabs)
        }

        // 恢复 scratch 激活状态：如果上次关闭时在 scratch 页，则激活它
        // 不改变 appMode，保留原有的 chat/agent 侧边栏状态
        if (settings.scratchPadActive) {
          store.set(activeTabIdAtom, SCRATCH_PAD_ID)
        }

        console.log('[ScratchPad] 初始化完成，已加载内容:', !!loadedMd)
      } catch (err) {
        console.error('[ScratchPad] 初始化失败:', err)
      } finally {
        loadedRef.current = true
      }
    }

    init()
  }, [store])

  // 自动保存：监听 scratchPadContentAtom 变化，防抖写入磁盘
  useEffect(() => {
    const save = (): void => {
      const html = store.get(scratchPadContentAtom)
      if (window.electronAPI.saveScratchPad) {
        const md = htmlToMarkdown(html)
        window.electronAPI.saveScratchPad(md).then((ok) => {
          if (!ok) console.error('[ScratchPad] 保存失败')
        }).catch(console.error)
      }
    }

    const debouncedSave = (): void => {
      if (!loadedRef.current) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(save, 500)
    }

    const unsub = store.sub(scratchPadContentAtom, debouncedSave)

    // beforeunload 时同步写入
    const handleBeforeUnload = (): void => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const html = store.get(scratchPadContentAtom)
      if (window.electronAPI.saveScratchPadSync) {
        const md = htmlToMarkdown(html)
        window.electronAPI.saveScratchPadSync(md)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      unsub()
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [store])

  // 监听 activeTabIdAtom 变化，持久化 scratchPadActive 到 settings
  useEffect(() => {
    const unsub = store.sub(activeTabIdAtom, () => {
      const activeTabId = store.get(activeTabIdAtom)
      const isScratchActive = activeTabId === SCRATCH_PAD_ID
      window.electronAPI.updateSettings({
        scratchPadActive: isScratchActive,
      }).catch(() => {})
    })
    return unsub
  }, [store])

  return null
}

// ===== 快速任务窗口：轻量渲染 =====
if (isQuickTaskWindow) {
  import('./components/quick-task/QuickTaskApp').then(({ QuickTaskApp }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ThemeInitializer />
        <QuickTaskApp />
      </React.StrictMode>
    )
  })
} else if (isVoiceDictationWindow) {
  import('./components/voice-dictation/VoiceDictationApp').then(({ VoiceDictationApp }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ThemeInitializer />
        <VoiceDictationApp />
        <Toaster position="top-right" />
      </React.StrictMode>
    )
  })
} else if (isDetachedPreviewWindow) {
  import('./components/diff/DetachedPreviewApp').then(({ DetachedPreviewApp }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ThemeInitializer />
        <MarkdownFontSizeInitializer />
        <DetachedPreviewApp />
        <Toaster position="top-right" />
      </React.StrictMode>
    )
  })
} else {
  // ===== 主窗口：完整渲染 =====
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeInitializer />
      <AgentSettingsInitializer />
      <NotificationsInitializer />
      <DockBadgeInitializer />
      <UiPreferencesInitializer />
      <MarkdownFontSizeInitializer />
      <ChatListenersInitializer />
      <AgentListenersInitializer />
      <ChatToolInitializer />
      <UpdaterInitializer />
      <AutomationInitializer />
      <FeishuInitializer />
      <DingTalkInitializer />
      <TabStatePersistenceInitializer />
      <ScratchPadPersistence />
      <GlobalShortcuts />
      <TabSwitcher />
      <App />
      <UpdateDialog />
      <Toaster position="top-right" />
    </React.StrictMode>
  )
}
