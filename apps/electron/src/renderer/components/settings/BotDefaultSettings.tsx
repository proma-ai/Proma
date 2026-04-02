/**
 * BotDefaultSettings - 机器人用法与默认配置
 *
 * 跨平台共享的默认设置（如默认工作区）和通用机器人命令说明。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsCard } from './primitives/SettingsCard'
import { SettingsSelect } from './primitives/SettingsSelect'
import { Button } from '@/components/ui/button'

export function BotDefaultSettings(): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)

  const [defaultWorkspaceId, setDefaultWorkspaceId] = React.useState('')
  const [loading, setLoading] = React.useState(true)

  // 加载当前设置
  React.useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      setDefaultWorkspaceId(settings.agentWorkspaceId ?? '')
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const workspaceOptions = React.useMemo(
    () => workspaces.map((w) => ({ value: w.id, label: w.name })),
    [workspaces],
  )

  const handleSave = React.useCallback(async () => {
    try {
      await window.electronAPI.updateSettings({
        agentWorkspaceId: defaultWorkspaceId || undefined,
      })
      toast.success('默认配置已保存')
    } catch {
      toast.error('保存失败')
    }
  }, [defaultWorkspaceId])

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">加载中...</div>

  return (
    <>
      <SettingsSection
        title="默认配置"
        description="所有机器人平台发起新会话时使用的默认设置"
      >
        <SettingsCard>
          {workspaceOptions.length > 0 ? (
            <SettingsSelect
              label="默认工作区"
              description="通过机器人发起新会话时自动使用的工作区"
              value={defaultWorkspaceId}
              onValueChange={setDefaultWorkspaceId}
              options={workspaceOptions}
              placeholder="选择工作区"
            />
          ) : (
            <div className="py-3 text-sm text-muted-foreground">
              暂无工作区。请先在「配置」中创建工作区。
            </div>
          )}
        </SettingsCard>

        <div className="flex items-center mt-3">
          <Button size="sm" onClick={handleSave}>
            保存默认配置
          </Button>
        </div>
      </SettingsSection>

      <div className="my-6 border-t border-border/50" />

      <SettingsSection
        title="机器人命令"
        description="在任意机器人平台中发送以下命令"
      >
        <SettingsCard divided={false}>
          <div className="px-4 py-3 space-y-2 text-sm text-muted-foreground">
            <div className="grid grid-cols-[100px_1fr] gap-y-1.5 gap-x-4">
              <code className="text-foreground/80 font-mono">/help</code>
              <span>显示帮助</span>
              <code className="text-foreground/80 font-mono">/new</code>
              <span>创建新 Agent 会话</span>
              <code className="text-foreground/80 font-mono">/agent</code>
              <span>切换到 Agent 模式</span>
              <code className="text-foreground/80 font-mono">/list</code>
              <span>列出所有会话</span>
              <code className="text-foreground/80 font-mono">/stop</code>
              <span>停止当前 Agent</span>
              <code className="text-foreground/80 font-mono">/switch</code>
              <span>切换到已有会话（序号）</span>
              <code className="text-foreground/80 font-mono">/workspace</code>
              <span>设置默认工作区</span>
              <code className="text-foreground/80 font-mono">/now</code>
              <span>查看当前状态（工作区、会话、MCP、Skills）</span>
            </div>
            <p className="pt-2 text-xs">
              直接发送文本会自动创建新会话或发送到当前绑定的会话。
            </p>
          </div>
        </SettingsCard>
      </SettingsSection>
    </>
  )
}
