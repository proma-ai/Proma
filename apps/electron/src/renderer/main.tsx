/**
 * 渲染进程入口
 *
 * 挂载 React 应用，初始化主题系统。
 */

import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { useSetAtom, useAtomValue, useStore } from 'jotai'
import App from './App'
import {
  themeModeAtom,
  themeStyleAtom,
  systemIsDarkAtom,
  resolvedThemeAtom,
  applyThemeToDOM,
  initializeTheme,
} from './atoms/theme'
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  currentAgentSessionIdAtom,
  workspaceCapabilitiesVersionAtom,
  workspaceFilesVersionAtom,
  agentPermissionModeAtom,
  agentThinkingAtom,
  agentEffortAtom,
  agentMaxBudgetUsdAtom,
  agentMaxTurnsAtom,
} from './atoms/agent-atoms'
import { updateStatusAtom, initializeUpdater } from './atoms/updater'
import {
// Cloud 模式专属
  cloudUserAtom,
  cloudAuthLoadingAtom,
  initializeCloudAuth,
} from './atoms/cloud-auth'
import {
  billingInfoAtom,
  billingLoadingAtom,
  quotaExceededDialogAtom,
  initializeBilling,
} from './atoms/cloud-billing'
import { isCloudMode } from './lib/mode'
// 通知
import {
  notificationsEnabledAtom,
  initializeNotifications,
} from './atoms/notifications'
import { useGlobalAgentListeners } from './hooks/useGlobalAgentListeners'
import { useGlobalChatListeners } from './hooks/useGlobalChatListeners'
import { tabsAtom, splitLayoutAtom } from './atoms/tab-atoms'
import type { TabItem, SplitLayoutState } from './atoms/tab-atoms'
import { chatToolsAtom } from './atoms/chat-tool-atoms'
import { feishuBridgeStateAtom } from './atoms/feishu-atoms'
import { currentConversationIdAtom, channelsAtom, channelsLoadedAtom, selectedModelAtom } from './atoms/chat-atoms'
import { ModelHealthInitializer } from './components/ModelHealthInitializer'
import type { FeishuBridgeState, FeishuNotificationSentPayload } from '@proma/shared'
import { Toaster } from './components/ui/sonner'
import { toast } from 'sonner'
import { diffCapabilities, migratePermissionMode } from '@proma/shared'
import type { WorkspaceCapabilities } from '@proma/shared'
import { showCapabilityChangeToasts } from './lib/capabilities-toast'
import { UpdateDialog } from './components/settings/UpdateDialog'
import { GlobalShortcuts } from './components/shortcuts/GlobalShortcuts'
import './styles/globals.css'
import 'katex/dist/katex.min.css'

// ===== 窗口类型检测 =====
const isQuickTaskWindow = new URLSearchParams(window.location.search).get('window') === 'quick-task'

/**
 * 主题初始化组件
 *
 * 负责从主进程加载主题设置、监听系统主题变化、
 * 并将最终主题同步到 DOM。
 */
function ThemeInitializer(): null {
  const setThemeMode = useSetAtom(themeModeAtom)
  const setThemeStyle = useSetAtom(themeStyleAtom)
  const setSystemIsDark = useSetAtom(systemIsDarkAtom)
  const themeMode = useAtomValue(themeModeAtom)
  const themeStyle = useAtomValue(themeStyleAtom)
  const systemIsDark = useAtomValue(systemIsDarkAtom)

  // 初始化：从主进程加载设置 + 订阅系统主题变化
  useEffect(() => {
    let isMounted = true
    let cleanup: (() => void) | undefined

    initializeTheme(setThemeMode, setSystemIsDark, setThemeStyle).then((fn) => {
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
  }, [setThemeMode, setSystemIsDark, setThemeStyle])

  // 响应式应用主题到 DOM
  useEffect(() => {
    applyThemeToDOM(themeMode, themeStyle, systemIsDark)
  }, [themeMode, themeStyle, systemIsDark])

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
  const setPermissionMode = useSetAtom(agentPermissionModeAtom)
  const setThinking = useSetAtom(agentThinkingAtom)
  const setEffort = useSetAtom(agentEffortAtom)
  const setMaxBudget = useSetAtom(agentMaxBudgetUsdAtom)
  const setMaxTurns = useSetAtom(agentMaxTurnsAtom)

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

      if (settings.agentPermissionMode) {
        // 迁移旧权限模式值（auto/smart/supervised → acceptEdits/bypassPermissions/plan）
        setPermissionMode(migratePermissionMode(settings.agentPermissionMode))
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
      }).catch(console.error)
    }).catch(console.error)
  }, [setAgentChannelId, setAgentModelId, setAgentChannelIds, setAgentWorkspaces, setCurrentWorkspaceId, setPermissionMode, setThinking, setEffort, setMaxBudget, setMaxTurns, setChannels, setChannelsLoaded])

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
/**
 * Cloud 认证初始化组件
 *
 * 仅在 Cloud 模式下从主进程恢复认证状态并订阅变化。
 * Local 模式下不执行任何操作。
 */
function CloudAuthInitializer(): null {
  const setUser = useSetAtom(cloudUserAtom)
  const setLoading = useSetAtom(cloudAuthLoadingAtom)

  useEffect(() => {
    if (!isCloudMode()) {
      // local 模式直接结束加载
      setLoading(false)
      return
    }

    const cleanup = initializeCloudAuth(setUser, setLoading)
    return cleanup
  }, [setUser, setLoading])

  return null
}

/**
 * Cloud 账单初始化组件
 *
 * 仅在 Cloud 模式 + 已认证时：
 * - 获取账单信息
 * - 订阅额度不足事件
 */
function BillingInitializer(): null {
  const setBillingInfo = useSetAtom(billingInfoAtom)
  const setBillingLoading = useSetAtom(billingLoadingAtom)
  const setQuotaExceededDialog = useSetAtom(quotaExceededDialogAtom)
  const user = useAtomValue(cloudUserAtom)

  useEffect(() => {
    if (!isCloudMode() || !user) return

    const cleanup = initializeBilling(setBillingInfo, setBillingLoading, setQuotaExceededDialog)
    return cleanup
  }, [user, setBillingInfo, setBillingLoading, setQuotaExceededDialog])

  // 订阅余额变动事件（对话扣费后自动刷新）
  useEffect(() => {
    if (!isCloudMode() || !user) return

    const unsubBillingChanged = window.electronAPI.cloudBilling.onBillingChanged(() => {
      window.electronAPI.cloudBilling.getBilling().then((result) => {
        if (result.success && result.data) {
          setBillingInfo(result.data)
        }
      }).catch(() => {
        // 刷新失败不影响使用
      })
    })

    return unsubBillingChanged
  }, [user, setBillingInfo])

  return null
}

/**
 * Cloud 官方渠道初始化组件
 *
 * 仅在 Cloud 模式 + 已认证时：
 * - 触发同步官方渠道（拉取模型列表）
 * - 订阅官方渠道更新事件，刷新渠道列表
 */
function OfficialChannelInitializer(): null {
  const user = useAtomValue(cloudUserAtom)

  useEffect(() => {
    if (!isCloudMode() || !user) return

    // 登录后同步官方渠道
    window.electronAPI.cloudBilling.syncOfficialChannel().catch((err) => {
      console.warn('[官方渠道] 同步失败:', err)
    })

    // 订阅官方渠道更新事件（主进程初始化完成后会广播）
    const unsubOfficialChannel = window.electronAPI.cloudBilling.onOfficialChannelUpdated(() => {
      // 渠道更新后，依赖 listChannels 的组件会在下次渲染时刷新
      console.log('[官方渠道] 收到更新通知')
    })

    return () => {
      unsubOfficialChannel()
    }
  }, [user])

  return null
}

/**
 * 通知初始化组件
 *
 * 从主进程加载通知开关设置。
 */
function NotificationsInitializer(): null {
  const setEnabled = useSetAtom(notificationsEnabledAtom)

  useEffect(() => {
    initializeNotifications(setEnabled)
  }, [setEnabled])

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
    // 加载初始状态
    window.electronAPI.getFeishuStatus()
      .then((state: FeishuBridgeState) => store.set(feishuBridgeStateAtom, state))
      .catch((err: unknown) => console.error('[FeishuInitializer] 加载状态失败:', err))

    // 订阅状态变化
    const cleanupStatus = window.electronAPI.onFeishuStatusChanged((state: FeishuBridgeState) => {
      store.set(feishuBridgeStateAtom, state)
    })

    // 订阅通知已发送事件 → Sonner + 桌面通知
    const cleanupNotif = window.electronAPI.onFeishuNotificationSent((payload: FeishuNotificationSentPayload) => {
      toast('已发送到飞书', {
        description: `${payload.sessionTitle}: ${payload.preview.slice(0, 60)}`,
        duration: 3000,
      })
      // 桌面通知
      if (Notification.permission === 'granted') {
        new Notification('Proma → 飞书', {
          body: `${payload.sessionTitle} 的回复已发送到飞书`,
        })
      }
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
      cleanupNotif()
      clearInterval(interval)
      window.removeEventListener('focus', reportPresence)
      window.removeEventListener('blur', reportPresence)
    }
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
} else {
  // ===== 主窗口：完整渲染 =====
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeInitializer />
      <CloudAuthInitializer />
      <BillingInitializer />
      <OfficialChannelInitializer />
      <ModelHealthInitializer />
      <AgentSettingsInitializer />
      <NotificationsInitializer />
      <ChatListenersInitializer />
      <AgentListenersInitializer />
      <ChatToolInitializer />
      <UpdaterInitializer />
      <FeishuInitializer />
      <GlobalShortcuts />
      <App />
      <UpdateDialog />
      <Toaster position="top-right" />
    </React.StrictMode>
  )
}
