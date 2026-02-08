/**
 * 渲染进程入口
 *
 * 挂载 React 应用，初始化主题系统。
 */

import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { useSetAtom, useAtomValue } from 'jotai'
import App from './App'
import {
  themeModeAtom,
  systemIsDarkAtom,
  resolvedThemeAtom,
  applyThemeToDOM,
  initializeTheme,
} from './atoms/theme'
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  workspaceCapabilitiesVersionAtom,
  workspaceFilesVersionAtom,
} from './atoms/agent-atoms'
import { updateStatusAtom, initializeUpdater } from './atoms/updater'
import {
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
import './styles/globals.css'

/**
 * 主题初始化组件
 *
 * 负责从主进程加载主题设置、监听系统主题变化、
 * 并将最终主题同步到 DOM。
 */
function ThemeInitializer(): null {
  const setThemeMode = useSetAtom(themeModeAtom)
  const setSystemIsDark = useSetAtom(systemIsDarkAtom)
  const resolvedTheme = useAtomValue(resolvedThemeAtom)

  // 初始化：从主进程加载设置 + 订阅系统主题变化
  useEffect(() => {
    let isMounted = true
    let cleanup: (() => void) | undefined

    initializeTheme(setThemeMode, setSystemIsDark).then((fn) => {
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
  }, [setThemeMode, setSystemIsDark])

  // 响应式应用主题到 DOM
  useEffect(() => {
    applyThemeToDOM(resolvedTheme)
  }, [resolvedTheme])

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
  const setAgentWorkspaces = useSetAtom(agentWorkspacesAtom)
  const setCurrentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const bumpFiles = useSetAtom(workspaceFilesVersionAtom)

  useEffect(() => {
    // 加载设置
    window.electronAPI.getSettings().then((settings) => {
      if (settings.agentChannelId) {
        setAgentChannelId(settings.agentChannelId)
      }
      if (settings.agentModelId) {
        setAgentModelId(settings.agentModelId)
      }

      // 加载工作区列表并恢复上次选中的工作区
      window.electronAPI.listAgentWorkspaces().then((workspaces) => {
        setAgentWorkspaces(workspaces)
        if (settings.agentWorkspaceId) {
          // 验证工作区仍然存在
          const exists = workspaces.some((w) => w.id === settings.agentWorkspaceId)
          setCurrentWorkspaceId(exists ? settings.agentWorkspaceId! : workspaces[0]?.id ?? null)
        } else if (workspaces.length > 0) {
          setCurrentWorkspaceId(workspaces[0].id)
        }
      }).catch(console.error)
    }).catch(console.error)
  }, [setAgentChannelId, setAgentModelId, setAgentWorkspaces, setCurrentWorkspaceId])

  // 订阅主进程文件监听推送
  useEffect(() => {
    const unsubCapabilities = window.electronAPI.onCapabilitiesChanged(() => {
      bumpCapabilities((v) => v + 1)
    })
    const unsubFiles = window.electronAPI.onWorkspaceFilesChanged(() => {
      bumpFiles((v) => v + 1)
    })

    return () => {
      unsubCapabilities()
      unsubFiles()
    }
  }, [bumpCapabilities, bumpFiles])

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeInitializer />
    <CloudAuthInitializer />
    <BillingInitializer />
    <OfficialChannelInitializer />
    <AgentSettingsInitializer />
    <UpdaterInitializer />
    <App />
  </React.StrictMode>
)
