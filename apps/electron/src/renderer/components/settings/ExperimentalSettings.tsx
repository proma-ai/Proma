/**
 * ExperimentalSettings - 实验性功能设置页
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { agentRuntimeAtom, experimentalAgentRuntimeSwitchEnabledAtom } from '@/atoms/agent-atoms'
import { SettingsCard, SettingsRow, SettingsSection } from './primitives'
import type { AgentRuntime } from '@proma/shared'

export function ExperimentalSettings(): React.ReactElement {
  const [experimentalRuntimeSwitchEnabled, setExperimentalRuntimeSwitchEnabled] = useAtom(experimentalAgentRuntimeSwitchEnabledAtom)
  const [agentRuntime, setAgentRuntime] = useAtom(agentRuntimeAtom)

  const handleRuntimeChange = async (runtime: AgentRuntime): Promise<void> => {
    if (!experimentalRuntimeSwitchEnabled && runtime !== 'claude') return
    setAgentRuntime(runtime)
    await window.electronAPI.updateSettings({ agentRuntime: runtime }).catch(console.error)
  }

  const handleExperimentalRuntimeSwitchChange = async (enabled: boolean): Promise<void> => {
    setExperimentalRuntimeSwitchEnabled(enabled)
    const updates: Parameters<typeof window.electronAPI.updateSettings>[0] = {
      experimentalAgentRuntimeSwitchEnabled: enabled,
    }
    if (!enabled) {
      setAgentRuntime('claude')
      updates.agentRuntime = 'claude'
    }
    await window.electronAPI.updateSettings(updates).catch(console.error)
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title="实验性功能"
        description="这些能力仍在验证中，默认关闭。"
      >
        <SettingsCard>
          <SettingsRow
            label="Agent 内核切换"
            description="开启后可在 Agent 输入框下方切换 Claude / Pi；关闭时始终使用 Claude Agent SDK"
          >
            <Switch
              checked={experimentalRuntimeSwitchEnabled}
              onCheckedChange={handleExperimentalRuntimeSwitchChange}
            />
          </SettingsRow>
          {experimentalRuntimeSwitchEnabled && (
            <SettingsRow
              label="默认 Agent Runtime"
              description="选择新 Agent 会话默认使用的底层 runtime；当前会话也可在 Agent 输入框下方切换"
            >
              <div className="flex items-center rounded-lg bg-muted p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={agentRuntime === 'claude' ? 'default' : 'ghost'}
                  className="h-7 px-3 text-xs"
                  onClick={() => handleRuntimeChange('claude')}
                >
                  Claude SDK
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={agentRuntime === 'pi' ? 'default' : 'ghost'}
                  className="h-7 px-3 text-xs"
                  onClick={() => handleRuntimeChange('pi')}
                >
                  Pi SDK
                </Button>
              </div>
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
