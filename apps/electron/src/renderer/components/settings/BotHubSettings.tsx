/**
 * BotHubSettings - 多平台机器人连接设置 Hub
 *
 * 左侧平台选择栏 + 右侧配置面板。
 * 支持飞书、钉钉、微信（WeClaw）三个平台。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { feishuBotStatesAtom } from '@/atoms/feishu-atoms'
import { dingtalkBotStatesAtom } from '@/atoms/dingtalk-atoms'
import { wechatBridgeStateAtom } from '@/atoms/wechat-atoms'
import { FeishuSettings } from './FeishuSettings'
import { DingTalkSettings } from './DingTalkSettings'
import { WeChatSettings } from './WeChatSettings'
import { BotDefaultSettings } from './BotDefaultSettings'
import { PromaLogoSettings } from './PromaLogoSettings'
import feishuLogo from '@/assets/bots/feishu.png'
import dingtalkLogo from '@/assets/bots/dingding.png'
import wechatLogo from '@/assets/bots/wechat.png'
import promaLogo from '@/assets/models/proma.png'

// ===== 类型 =====

type BotPlatformId = 'feishu' | 'dingtalk' | 'wechat' | 'defaults' | 'logos'

interface BotPlatformDef {
  id: BotPlatformId
  name: string
  /** Logo 图片 src（有图片时使用） */
  iconSrc?: string
  /** 无图片时显示的字符 */
  iconChar?: string
  iconBgClass: string
  iconTextClass?: string
}

// ===== 平台定义 =====

const PLATFORMS: readonly BotPlatformDef[] = [
  {
    id: 'wechat',
    name: '微信',
    iconSrc: wechatLogo,
    iconBgClass: 'bg-green-500/15',
  },
  {
    id: 'feishu',
    name: '飞书',
    iconSrc: feishuLogo,
    iconBgClass: 'bg-blue-500/15',
  },
  {
    id: 'dingtalk',
    name: '钉钉',
    iconSrc: dingtalkLogo,
    iconBgClass: 'bg-orange-500/15',
  },
  {
    id: 'defaults',
    name: '用法',
    iconChar: '⚙',
    iconBgClass: 'bg-muted',
    iconTextClass: 'text-muted-foreground',
  },
  {
    id: 'logos',
    name: '品牌素材',
    iconSrc: promaLogo,
    iconBgClass: 'bg-muted',
  },
] as const

/** 连接状态颜色映射 */
const BRIDGE_STATUS_COLORS = {
  disconnected: 'bg-gray-400',
  connecting: 'bg-yellow-400 animate-pulse',
  connected: 'bg-green-500',
  error: 'bg-red-500',
} as const

// ===== 子组件 =====

/** 平台连接状态指示点 */
function PlatformStatusDot({ platformId }: { platformId: BotPlatformId }): React.ReactElement | null {
  const feishuBotStates = useAtomValue(feishuBotStatesAtom)
  const dingtalkBotStates = useAtomValue(dingtalkBotStatesAtom)
  const wechatState = useAtomValue(wechatBridgeStateAtom)

  if (platformId === 'defaults' || platformId === 'logos') return null

  const statusMap: Record<string, string> = {
    feishu: getPlatformStatus(feishuBotStates),
    dingtalk: getPlatformStatus(dingtalkBotStates),
    wechat: wechatState.status,
  }
  const status = statusMap[platformId] ?? 'disconnected'
  const colorClass = BRIDGE_STATUS_COLORS[status as keyof typeof BRIDGE_STATUS_COLORS] ?? 'bg-gray-400'

  return <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', colorClass)} />
}

/** 从多 Bot 状态推导平台级状态：任一 connected → connected，否则按 error > connecting > disconnected 优先级 */
function getPlatformStatus(states: Record<string, { status: string }>): string {
  const values = Object.values(states)
  if (values.length === 0) return 'disconnected'
  if (values.some((s) => s.status === 'connected')) return 'connected'
  if (values.some((s) => s.status === 'error')) return 'error'
  if (values.some((s) => s.status === 'connecting')) return 'connecting'
  return 'disconnected'
}

/** 左侧平台选择项 */
function PlatformSidebarItem({
  platform,
  isActive,
  onClick,
}: {
  platform: BotPlatformDef
  isActive: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left',
        isActive
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      )}
    >
      {/* 平台图标 */}
      {platform.iconSrc ? (
        <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
          <img src={platform.iconSrc} alt={platform.name} className="w-8 h-8 rounded-lg object-contain" />
        </div>
      ) : (
        <div className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg text-base flex-shrink-0',
          platform.iconBgClass,
          platform.iconTextClass,
        )}>
          {platform.iconChar}
        </div>
      )}

      {/* 名称 */}
      <span className="text-sm flex-1 min-w-0 truncate">
        {platform.name}
      </span>

      {/* 状态点 */}
      <PlatformStatusDot platformId={platform.id} />
    </button>
  )
}

/** 根据平台 ID 渲染对应设置组件 */
function renderPlatformPanel(id: BotPlatformId): React.ReactElement {
  switch (id) {
    case 'feishu':
      return <FeishuSettings />
    case 'dingtalk':
      return <DingTalkSettings />
    case 'wechat':
      return <WeChatSettings />
    case 'defaults':
      return <BotDefaultSettings />
    case 'logos':
      return <PromaLogoSettings />
  }
}

// ===== 主组件 =====

export function BotHubSettings(): React.ReactElement {
  const [selectedPlatform, setSelectedPlatform] = React.useState<BotPlatformId>('wechat')

  return (
    <div className="flex -mx-6 -my-4 h-full">
      {/* 左侧平台选择栏 */}
      <div className="w-[140px] border-r border-border/50 py-3 px-2 flex-shrink-0">
        <div className="space-y-0.5">
          {PLATFORMS.map((p) => (
            <PlatformSidebarItem
              key={p.id}
              platform={p}
              isActive={selectedPlatform === p.id}
              onClick={() => setSelectedPlatform(p.id)}
            />
          ))}
        </div>
      </div>

      {/* 右侧内容面板 */}
      <ScrollArea className="flex-1 min-w-0">
        <div className="px-6 py-4">
          {renderPlatformPanel(selectedPlatform)}
        </div>
      </ScrollArea>
    </div>
  )
}
