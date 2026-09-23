/**
 * ThirdPartyChannelRemovedDialog - 不再支持的渠道移除通知
 *
 * 商业版启动时清理不受支持的渠道（包含旧 OpenCode Go 配置及第三方中转站）。
 * 这个弹窗列出实际被移除的渠道；仅在包含中转站时提示开源版本选项。
 *
 * 由 App.tsx 中的 GlobalThirdPartyChannelRemovedDialog 负责在启动后调用一次
 * `consumeChannelRemovalNotice`（读取即清除），因此本组件本身不关心持久化。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { AlertTriangle, ExternalLink, Settings } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import type { ChannelRemovalNoticeEntry } from '@proma/shared'
import { PROVIDER_LABELS } from '@proma/shared'

const PROMA_OPEN_SOURCE_URL = 'https://github.com/proma-ai/Proma.git'

interface ThirdPartyChannelRemovedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channels: ChannelRemovalNoticeEntry[]
}

export function ThirdPartyChannelRemovedDialog({
  open,
  onOpenChange,
  channels,
}: ThirdPartyChannelRemovedDialogProps): React.ReactElement {
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const hasOpenCode = channels.some((channel) => channel.provider === 'opencode-go-openai')
  const onlyOpenCode = hasOpenCode && channels.every((channel) => channel.provider === 'opencode-go-openai')

  const handleOpenChannelSettings = (): void => {
    onOpenChange(false)
    setSettingsTab('channels')
    setSettingsOpen(true)
  }

  const handleOpenSourceLink = (): void => {
    void window.electronAPI.openExternal(PROMA_OPEN_SOURCE_URL)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <DialogTitle>{hasOpenCode ? '已移除不再支持的渠道' : '已移除第三方中转站渠道'}</DialogTitle>
          </div>
          <DialogDescription>
            {onlyOpenCode
              ? 'OpenCode Go 渠道已停止支持，存量配置已从本地渠道列表中移除。其他渠道不受影响。'
              : hasOpenCode
                ? 'OpenCode Go 渠道已停止支持；商业版同时禁用第三方中转站。以下存量渠道已从本地配置移除。'
                : '为进一步提升 Agent 的整体安全性，防止第三方中转站带来的设备劫持、隐私信息泄露、欺诈风险及 Proma Key 盗用等隐患，商业版已全面禁用第三方中转站，仅保留 Proma 官方渠道及各供应商的官方 API。'}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">本次已移除以下渠道：</p>
          <ul className="max-h-44 space-y-1 overflow-y-auto pr-2" aria-label="已移除渠道列表">
            {channels.map((channel) => (
              <li key={`${channel.provider}:${channel.name}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium" title={channel.name}>{channel.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{PROVIDER_LABELS[channel.provider] ?? channel.provider}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-muted-foreground">
          {onlyOpenCode
            ? '请切换到 Proma 官方渠道或其他受支持的供应商。'
            : '你可以迁移至 Proma 官方渠道或其他官方供应商；第三方中转站用户也可以考虑 Proma 开源版本。'}
        </p>

        <DialogFooter className="gap-2">
          {!onlyOpenCode && <Button variant="outline" onClick={handleOpenSourceLink}>
            <ExternalLink className="mr-1.5 h-4 w-4" />
            了解开源版本
          </Button>}
          <Button onClick={handleOpenChannelSettings}>
            <Settings className="mr-1.5 h-4 w-4" />
            查看渠道设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
