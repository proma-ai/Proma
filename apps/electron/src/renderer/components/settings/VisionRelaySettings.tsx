import * as React from 'react'
import { Eye, ShieldCheck } from 'lucide-react'
import type { VisionRelaySettings as VisionRelaySettingsValue } from '@/types/settings'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { Switch } from '@/components/ui/switch'
import { SettingsCard, SettingsRow, SettingsSection } from './primitives'

const DEFAULT_SETTINGS: VisionRelaySettingsValue = { enabled: false }

/** 为无视觉输入能力的 Agent 选择独立的视觉模型路由。 */
export function VisionRelaySettings(): React.ReactElement {
  const [settings, setSettings] = React.useState<VisionRelaySettingsValue>(DEFAULT_SETTINGS)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI.getSettings()
      .then((appSettings) => setSettings(appSettings.visionRelay ?? DEFAULT_SETTINGS))
      .catch(console.error)
  }, [])

  const save = async (next: VisionRelaySettingsValue): Promise<void> => {
    const previous = settings
    setSettings(next)
    setSaving(true)
    try {
      await window.electronAPI.updateSettings({ visionRelay: next })
    } catch (error) {
      console.error('[视觉助手设置] 保存失败:', error)
      setSettings(previous)
    } finally {
      setSaving(false)
    }
  }

  const selectedModel = settings.channelId && settings.modelId
    ? { channelId: settings.channelId, modelId: settings.modelId }
    : null
  const configured = Boolean(selectedModel)

  return (
    <div className="space-y-8">
      <SettingsSection
        title="视觉助手"
        description="为不支持原生视觉的 Agent（当前为 DeepSeek V4）接入独立视觉模型。图片不会发送给当前 DeepSeek 渠道。"
      >
        <SettingsCard>
          <SettingsRow
            label="启用视觉助手"
            icon={<Eye className="size-4 text-violet-500" />}
            description={configured
              ? 'Agent 在需要理解已授权图片时，会请求使用下方选择的视觉模型。'
              : '先选择一个支持图片输入的已配置模型。'}
          >
            <Switch
              checked={settings.enabled}
              disabled={saving || !configured}
              onCheckedChange={(enabled) => void save({ ...settings, enabled })}
            />
          </SettingsRow>
          <SettingsRow
            label="视觉模型"
            description="选择已有渠道中的视觉模型。Proma 继续复用该渠道加密保存的 API Key。"
          >
            <ModelSelector
              externalSelectedModel={selectedModel}
              excludedProviders={['openai-codex', 'xai']}
              showChannelInTrigger
              onModelSelect={(model) => void save({
                enabled: settings.enabled,
                channelId: model.channelId,
                modelId: model.modelId,
              })}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="隐私边界" description="视觉助手遵循最小外发原则。">
        <SettingsCard>
          <SettingsRow
            label="启用后自动使用视觉模型"
            icon={<ShieldCheck className="size-4 text-emerald-500" />}
            description="启用即授权 Agent 在需要时将当前会话或用户已附加目录中的 PNG、JPEG、GIF、WebP 图片，以及最多 1000 字符的视觉问题发送给所选模型；单张上限 10MB。视觉结果只会以文本 JSON 返回给 Agent。"
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
