/**
 * RightSidePanel — 右侧边栏容器
 *
 * 在 Agent 模式下显示文件面板，样式与 LeftSidebar 一致。
 * 从全局 atom 读取当前会话 ID 和路径。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { appModeAtom } from '@/atoms/app-mode'
import { currentAgentSessionIdAtom, agentSessionPathMapAtom } from '@/atoms/agent-atoms'
import { SidePanel } from '@/components/agent/SidePanel'

export function RightSidePanel(): React.ReactElement | null {
  const appMode = useAtomValue(appModeAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)

  // 仅在 Agent 模式且有当前会话时显示
  if (appMode !== 'agent' || !currentSessionId) {
    return null
  }

  const sessionPath = sessionPathMap.get(currentSessionId) ?? null

  return (
    <SidePanel sessionId={currentSessionId} sessionPath={sessionPath} />
  )
}
