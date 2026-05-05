/**
 * VoiceInputSettings — 语音输入设置
 */

import * as React from 'react'
import { ExternalLink, Loader2, TestTube2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  SettingsCard,
  SettingsInput,
  SettingsSecretInput,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
} from './primitives'
import type { VoiceDictationSettings } from '../../../types'

const ENDPOINT_OPTIONS = [
  { value: 'async', label: '双向流式优化版' },
  { value: 'duplex', label: '双向流式标准版' },
]

const OUTPUT_OPTIONS = [
  { value: 'auto', label: '自动：Proma 激活时写入对话框，否则写入当前光标' },
  { value: 'clipboard', label: '仅复制到剪贴板' },
  { value: 'proma-input', label: '仅写入 Proma 输入框' },
]

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'zh-CN', label: '中文普通话' },
  { value: 'en-US', label: '英语' },
  { value: 'yue-CN', label: '粤语' },
  { value: 'ja-JP', label: '日语' },
  { value: 'ko-KR', label: '韩语' },
]

const VOLCENGINE_SPEECH_SERVICE_URL = 'https://console.volcengine.com/speech/service/'

export function VoiceInputSettings(): React.ReactElement {
  const [settings, setSettings] = React.useState<VoiceDictationSettings | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI.getVoiceDictationSettings()
      .then(setSettings)
      .catch((error) => {
        console.error('[语音输入] 加载设置失败:', error)
        toast.error('加载语音输入设置失败')
      })
  }, [])

  const update = React.useCallback(async (updates: Partial<VoiceDictationSettings>) => {
    if (!settings) return
    const optimistic = { ...settings, ...updates, provider: 'doubao' as const }
    setSettings(optimistic)
    setSaving(true)
    try {
      const saved = await window.electronAPI.updateVoiceDictationSettings(optimistic)
      setSettings(saved)
      window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
    } catch (error) {
      console.error('[语音输入] 保存设置失败:', error)
      toast.error('保存语音输入设置失败')
    } finally {
      setSaving(false)
    }
  }, [settings])

  const handleTest = React.useCallback(async () => {
    if (!settings) return
    setTesting(true)
    try {
      const result = await window.electronAPI.testVoiceDictationConnection(settings)
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error(`测试连接失败: ${message}`)
    } finally {
      setTesting(false)
    }
  }, [settings])

  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在加载语音输入设置...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="豆包流式语音输入"
        description="通过全局快捷键唤起浮窗，实时识别语音，停止后写入 Proma 输入框或当前光标位置。"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing || !settings.appId || !settings.accessToken || !settings.resourceId}
          >
            {testing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <TestTube2 className="mr-1.5 size-3.5" />}
            测试连接
          </Button>
        }
      >
        <div className="rounded-lg bg-muted/55 px-4 py-3 text-sm text-muted-foreground shadow-sm">
          <div className="mb-1.5 font-medium text-foreground">配置方式</div>
          <div className="space-y-1 leading-relaxed">
            <p>
              打开
              <a
                href={VOLCENGINE_SPEECH_SERVICE_URL}
                target="_blank"
                rel="noreferrer"
                className="mx-1 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                火山引擎语音服务控制台
                <ExternalLink className="size-3" />
              </a>
              ，选择旧版服务界面。
            </p>
            <p>找到“豆包流式语音识别模型2.0”类目，选择已申请对应权限的应用。</p>
            <p>在页面下方对照填写 APP ID、Access Token 和 Resource ID，然后点击“测试连接”。</p>
          </div>
        </div>
        <SettingsCard>
          <SettingsToggle
            label="启用语音输入"
            description="启用后可使用 Ctrl+～ 打开语音输入浮窗，再按一次停止。"
            checked={settings.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
          <SettingsInput
            label="豆包 APP ID"
            description="对应 X-Api-App-Key，请填写火山引擎控制台中的 APP ID。"
            value={settings.appId}
            onChange={(appId) => update({ appId })}
            placeholder="请输入 APP ID"
          />
          <SettingsSecretInput
            label="豆包 Access Token"
            description="对应 X-Api-Access-Key，保存时会加密。"
            value={settings.accessToken}
            onChange={(accessToken) => update({ accessToken })}
            placeholder="请输入 Access Token"
          />
          <SettingsInput
            label="Resource ID"
            description="默认使用豆包语音识别模型 2.0 小时版。"
            value={settings.resourceId}
            onChange={(resourceId) => update({ resourceId })}
            placeholder="volc.seedasr.sauc.duration"
          />
          <SettingsSelect
            label="连接模式"
            description="优化版只在结果变化时返回新包，实时体验更好。"
            value={settings.endpointMode}
            onValueChange={(endpointMode) => update({ endpointMode: endpointMode as VoiceDictationSettings['endpointMode'] })}
            options={ENDPOINT_OPTIONS}
          />
          <SettingsSelect
            label="识别语言"
            description="自动识别适合中英文和方言混合输入。"
            value={settings.language || 'auto'}
            onValueChange={(language) => update({ language: language === 'auto' ? '' : language })}
            options={LANGUAGE_OPTIONS}
          />
          <SettingsSelect
            label="输出方式"
            description="默认写入当前光标位置；如果唤起时 Proma 是当前激活窗口，会写入当前 Chat 或 Agent 输入框。自动粘贴失败时会保留到剪贴板。"
            value={settings.outputMode}
            onValueChange={(outputMode) => update({ outputMode: outputMode as VoiceDictationSettings['outputMode'] })}
            options={OUTPUT_OPTIONS}
          />
        </SettingsCard>
      </SettingsSection>

      {saving && (
        <p className="text-xs text-muted-foreground">正在保存语音输入设置...</p>
      )}
    </div>
  )
}
