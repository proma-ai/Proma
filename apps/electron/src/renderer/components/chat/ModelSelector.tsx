/**
 * ModelSelector - 模型选择器（锚定 Popover + 搜索）
 *
 * 现代化设计：
 * - 非模态 Popover 锚定触发按钮，向上展开（右对齐），避免 Dialog 全屏遮罩
 * - 按渠道分组，标题与模型项使用统一栅格对齐
 * - 选中项使用柔和底色与右侧勾选标记
 * - 触发按钮：模型 logo + 模型名 + Chevron
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Check, ChevronDown, Cpu, Search } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  conversationsAtom,
  selectedModelAtom,
  channelsAtom,
  channelsLoadedAtom,
  modelSelectorOpenAtom,
} from '@/atoms/chat-atoms'
import { useConversationModelOptional } from '@/hooks/useConversationSettings'
import { useConversationIdOptional } from '@/contexts/session-context'
import { inputToolbarControlHeightClass } from '@/components/ai-elements/input-toolbar-styles'
import { billingInfoAtom } from '@/atoms/cloud-billing'
import { getModelLogo, getChannelLogo, DefaultLogo } from '@/lib/model-logo'
import { buildOfficialChannelQuotaSummary } from '@/lib/official-channel-quota-summary'
import { cn } from '@/lib/utils'
import { PROMA_OFFICIAL_CHANNEL_ID } from '@proma/shared'
import type { Channel, ModelOption, ProviderType } from '@proma/shared'
import { ChannelPlanQuotaBadge } from './ChannelPlanQuotaBadge'
import { getModelSelectorOptionVisualState } from './model-selector-visual-state'

/** 渠道标题与模型项共享的三列栅格，确保左右边距和文字起点一致。 */
const MODEL_SELECTOR_ROW_LAYOUT =
  'mx-1 grid w-[calc(100%-0.5rem)] grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 px-3'

const OFFICIAL_MODEL_RATE_NOTE =
  '倍率以官方原价的 DeepSeek v4 Pro = 1x 为参考；经过后台的长期统计计算出其他模型的消耗速率，实际消耗以真实日志显示为准。'

interface ModelSelectorListIconProps {
  src: string
  imageClassName?: string
}

/** 使用固定外框吸收不同 Logo 素材的透明留白差异，保持列表中的视觉尺寸稳定。 */
function ModelSelectorListIcon({ src, imageClassName }: ModelSelectorListIconProps): React.ReactElement {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center justify-self-center overflow-hidden rounded-md bg-muted/50"
      aria-hidden="true"
    >
      <img src={src} alt="" className={cn('size-5 rounded-md object-contain', imageClassName)} />
    </span>
  )
}

/** 从渠道列表构建扁平化的模型选项 */
export function buildModelOptions(
  channels: Channel[],
  filterChannelId?: string,
  filterChannelIds?: string[],
  useAgentModels?: boolean,
  excludedProviders?: readonly ProviderType[],
): ModelOption[] {
  const options: ModelOption[] = []

  // Proma 官方渠道置顶（若已启用且未被过滤掉），其余保持原有相对顺序。
  const ordered = channels.some((channel) => channel.id === PROMA_OFFICIAL_CHANNEL_ID && channel.enabled)
    ? [
        ...channels.filter((channel) => channel.id === PROMA_OFFICIAL_CHANNEL_ID),
        ...channels.filter((channel) => channel.id !== PROMA_OFFICIAL_CHANNEL_ID),
      ]
    : channels

  for (const channel of ordered) {
    if (!channel.enabled) continue
    if (filterChannelId && channel.id !== filterChannelId) continue
    if (filterChannelIds && !filterChannelIds.includes(channel.id)) continue
    if (excludedProviders?.includes(channel.provider)) continue

    // Agent 专用模型清单只能由 Proma 官方渠道提供；第三方渠道即使异常带有
    // agentModels 也继续使用其普通模型清单，避免错误改变其可选模型集。
    const modelList = useAgentModels && channel.id === PROMA_OFFICIAL_CHANNEL_ID
      ? (channel.agentModels ?? channel.models)
      : channel.models
    for (const model of modelList) {
      if (!model.enabled) continue

      options.push({
        channelId: channel.id,
        channelName: channel.name,
        modelId: model.id,
        modelName: model.name,
        ...(model.modelListHint ? { modelListHint: model.modelListHint } : {}),
        provider: channel.provider,
      })
    }
  }

  return options
}

/** 按渠道分组模型选项 */
function groupByChannel(options: ModelOption[]): Map<string, ModelOption[]> {
  const groups = new Map<string, ModelOption[]>()

  for (const option of options) {
    const key = option.channelId
    const group = groups.get(key) ?? []
    group.push(option)
    groups.set(key, group)
  }

  return groups
}

/** ModelSelector 可选属性 */
interface ModelSelectorProps {
  /** 仅显示此渠道的模型 */
  filterChannelId?: string
  /** 仅显示这些渠道的模型（多渠道过滤） */
  filterChannelIds?: string[]
  /** 外部选中模型（不传则用内部 selectedModelAtom） */
  externalSelectedModel?: { channelId: string; modelId: string } | null
  /** 外部选择回调 */
  onModelSelect?: (option: ModelOption) => void
  /** 使用 Agent 专用模型列表（仅 Proma 官方渠道） */
  useAgentModels?: boolean
  /** 触发按钮是否显示「渠道 · 模型」（默认只显示模型名） */
  showChannelInTrigger?: boolean
  /** 不在此选择器中显示的供应商（例如 Chat 暂不支持的协议） */
  excludedProviders?: readonly ProviderType[]
  /** 是否使用全局 modelSelectorOpenAtom 控制打开状态（用于外部拉起，如错误提示按钮） */
  useSharedOpenState?: boolean
}

export function ModelSelector({
  filterChannelId,
  filterChannelIds,
  externalSelectedModel,
  onModelSelect,
  useAgentModels,
  showChannelInTrigger = false,
  excludedProviders,
  useSharedOpenState = false,
}: ModelSelectorProps = {}): React.ReactElement {
  const [conversationModel, setConversationModel] = useConversationModelOptional()
  const conversationId = useConversationIdOptional()
  const setConversations = useSetAtom(conversationsAtom)
  const setGlobalModel = useSetAtom(selectedModelAtom)
  const channels = useAtomValue(channelsAtom)
  const channelsLoaded = useAtomValue(channelsLoadedAtom)
  const billing = useAtomValue(billingInfoAtom)
  const setChannels = useSetAtom(channelsAtom)
  const [localOpen, setLocalOpen] = React.useState(false)
  const [sharedOpen, setSharedOpen] = useAtom(modelSelectorOpenAtom)
  const open = useSharedOpenState ? sharedOpen : localOpen
  const setOpen = useSharedOpenState ? setSharedOpen : setLocalOpen
  const [tooltipOpen, setTooltipOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const officialChannelQuotaSummary = React.useMemo(
    () => buildOfficialChannelQuotaSummary(billing),
    [billing],
  )

  // 外部模型优先 → per-conversation 模型
  const selectedModel = externalSelectedModel !== undefined ? externalSelectedModel : conversationModel

  // 打开时先读取已落盘的频道缓存，因此列表不会因网络校验而清空或闪烁。
  // 随后在后台进行一次条件目录请求；只有服务端 ETag 变化才重新读取并替换列表。
  React.useEffect(() => {
    if (!open) return

    window.electronAPI.listChannels().then(setChannels).catch(console.error)
    void window.electronAPI.cloudBilling.syncOfficialChannel()
      .then(async (result) => {
        if (!result.success || !result.data?.changed) return
        const latestChannels = await window.electronAPI.listChannels()
        setChannels(latestChannels)
      })
      .catch(console.error)
    setSearch('')
  }, [open, setChannels])

  const modelOptions = React.useMemo(
    () => buildModelOptions(channels, filterChannelId, filterChannelIds, useAgentModels, excludedProviders),
    [channels, filterChannelId, filterChannelIds, useAgentModels, excludedProviders],
  )
  const grouped = React.useMemo(() => groupByChannel(modelOptions), [modelOptions])

  // 搜索过滤
  const filteredGrouped = React.useMemo(() => {
    if (!search.trim()) return grouped

    const query = search.toLowerCase()
    const filtered = new Map<string, ModelOption[]>()

    for (const [channelId, options] of grouped.entries()) {
      const matchedOptions = options.filter(
        (o) =>
          o.modelName.toLowerCase().includes(query) ||
          o.channelName.toLowerCase().includes(query)
      )
      if (matchedOptions.length > 0) {
        filtered.set(channelId, matchedOptions)
      }
    }

    return filtered
  }, [grouped, search])

  // 扁平化过滤后的模型列表，用于键盘导航
  const flatOptions = React.useMemo(() => {
    const result: ModelOption[] = []
    for (const options of filteredGrouped.values()) {
      result.push(...options)
    }
    return result
  }, [filteredGrouped])

  // 键盘高亮索引
  const [highlightIndex, setHighlightIndex] = React.useState(-1)
  const itemRefs = React.useRef<Map<number, HTMLButtonElement>>(new Map())

  // 搜索变化时重置高亮
  React.useEffect(() => {
    setHighlightIndex(-1)
  }, [search])

  // 高亮项变化时滚动到可见区域
  React.useEffect(() => {
    if (highlightIndex < 0) return
    const el = itemRefs.current.get(highlightIndex)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  // 查找当前选中的模型信息
  const currentModelInfo = React.useMemo(() => {
    if (!selectedModel) return null
    return modelOptions.find(
      (o) => o.channelId === selectedModel.channelId && o.modelId === selectedModel.modelId
    ) ?? null
  }, [selectedModel, modelOptions])

  // 保持上次有效的模型信息，避免渠道未加载时闪烁"选择模型"
  const stableModelInfoRef = React.useRef(currentModelInfo)
  if (currentModelInfo) stableModelInfoRef.current = currentModelInfo
  const displayModelInfo = currentModelInfo ?? stableModelInfoRef.current

  // Tooltip 必须始终保持 controlled 或 uncontrolled 之一。此前在 Popover 打开时传 false、关闭时传
  // undefined，Radix 会发出 controlled/uncontrolled 告警，且与模型 Popover 的 trigger 竞争焦点。
  React.useEffect(() => {
    if (open || !displayModelInfo) setTooltipOpen(false)
  }, [displayModelInfo, open])

  /** 选择模型并持久化到当前对话 */
  const handleSelect = (option: ModelOption): void => {
    if (onModelSelect) {
      onModelSelect(option)
      setOpen(false)
      return
    }

    // Chat 模式：写入 per-conversation Map + 同步全局默认值
    if (setConversationModel) {
      setConversationModel({ channelId: option.channelId, modelId: option.modelId })
    }
    setGlobalModel({ channelId: option.channelId, modelId: option.modelId })
    setOpen(false)

    // 将模型/渠道选择保存到当前对话元数据
    if (conversationId) {
      window.electronAPI
        .updateConversationModel(conversationId, option.modelId, option.channelId)
        .then((updated) => {
          setConversations((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          )
        })
        .catch(console.error)
    }
  }

  /** 搜索框键盘导航 */
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (flatOptions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev < flatOptions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : flatOptions.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = flatOptions[highlightIndex >= 0 ? highlightIndex : 0]
      if (target) handleSelect(target)
    }
  }

  if (channelsLoaded && modelOptions.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1">
        <Cpu className="size-3.5" />
        <span>暂无可用模型</span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* 触发按钮 */}
      <Tooltip
        open={tooltipOpen}
        onOpenChange={(nextOpen) => setTooltipOpen(nextOpen && !open && Boolean(displayModelInfo))}
      >
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'model-selector-trigger flex items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors',
                'hover:bg-accent hover:text-foreground focus:outline-none focus-visible:bg-accent focus-visible:text-foreground',
                inputToolbarControlHeightClass,
              )}
            >
              {displayModelInfo ? (
                <img
                  src={getModelLogo(displayModelInfo.modelId, displayModelInfo.provider)}
                  alt={displayModelInfo.modelName}
                  className="size-4 rounded object-cover"
                />
              ) : (
                <Cpu className="size-3.5" />
              )}
              <span className="max-w-[200px] truncate">
                {displayModelInfo
                  ? (showChannelInTrigger ? `${displayModelInfo.channelName} · ${displayModelInfo.modelName}` : displayModelInfo.modelName)
                  : '选择模型'}
              </span>
              <ChevronDown className="size-3" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">渠道：{displayModelInfo?.channelName}</TooltipContent>
      </Tooltip>

      {/* 模型选择 Popover — 锚定触发按钮，向上展开（end 对齐，内容向左上延伸） */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-[420px] max-w-[calc(100vw-2rem)] p-0"
        aria-label="选择模型"
      >
        {/* 搜索栏 */}
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/60">
          <Search className="size-4 text-muted-foreground/60 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="搜索模型..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            autoFocus
          />
        </div>

        {/* 模型列表 */}
        <div className="max-h-[min(360px,55vh)] overflow-y-auto scrollbar-thin">
          {filteredGrouped.size === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              未找到模型
            </div>
          ) : (
            (() => {
              let flatIndex = 0
              return Array.from(filteredGrouped.entries()).map(([channelId, options]) => {
                const first = options[0]
                if (!first) return null
                const channel = channels.find((c) => c.id === channelId)

                return (
                  <div
                    key={channelId}
                    role="group"
                    aria-label={first.channelName}
                    className="border-b border-border/40 py-1 last:border-b-0"
                  >
                    {/* 官方额度与第三方 Plan 额度一样作为行内标签展示，不占用模型行。 */}
                    <div className={cn(MODEL_SELECTOR_ROW_LAYOUT, 'min-h-7 py-0.5')}>
                      <ModelSelectorListIcon
                        src={channel ? getChannelLogo(channel) : DefaultLogo}
                        imageClassName={channelId === PROMA_OFFICIAL_CHANNEL_ID ? 'scale-[1.2]' : undefined}
                      />
                      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground/80">
                        {first.channelName}
                      </span>
                      {channelId === PROMA_OFFICIAL_CHANNEL_ID && officialChannelQuotaSummary ? (
                        <span
                          className="ml-auto shrink-0 whitespace-nowrap rounded border border-foreground/10 bg-background/70 px-1.5 py-0.5 text-[10px] leading-none text-foreground/70 tabular-nums"
                          title={officialChannelQuotaSummary}
                        >
                          {officialChannelQuotaSummary}
                        </span>
                      ) : channel ? <ChannelPlanQuotaBadge channel={channel} /> : null}
                    </div>

                    {/* 该渠道下的模型列表 */}
                    {options.map((option) => {
                      const isSelected =
                        selectedModel?.channelId === option.channelId &&
                        selectedModel?.modelId === option.modelId
                      const currentFlatIndex = flatIndex++
                      const isHighlighted = currentFlatIndex === highlightIndex
                      const visualState = getModelSelectorOptionVisualState(isSelected, isHighlighted)

                      return (
                        <button
                          key={`${option.channelId}:${option.modelId}`}
                          ref={(el) => {
                            if (el) itemRefs.current.set(currentFlatIndex, el)
                            else itemRefs.current.delete(currentFlatIndex)
                          }}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => handleSelect(option)}
                          onMouseEnter={() => setHighlightIndex(currentFlatIndex)}
                          className={cn(
                            MODEL_SELECTOR_ROW_LAYOUT,
                            'min-h-9 rounded-lg py-1.5 text-left transition-colors',
                            'hover:bg-accent/60 focus:outline-none focus-visible:bg-accent/70',
                            visualState === 'highlighted' && 'bg-accent/60',
                            visualState === 'selected' && 'bg-accent',
                          )}
                        >
                          <ModelSelectorListIcon
                            src={getModelLogo(option.modelId, option.provider)}
                          />
                          <span className="flex min-w-0 items-baseline gap-1.5 overflow-hidden">
                            <span className={cn(
                              'shrink-0 text-sm',
                              isSelected ? 'font-medium text-foreground' : 'text-foreground/80',
                            )}>
                              {option.modelName}
                            </span>
                            {option.channelId === PROMA_OFFICIAL_CHANNEL_ID && option.modelListHint ? (
                              <span
                                className="min-w-0 truncate text-xs text-muted-foreground"
                                title={option.modelListHint}
                              >
                                {option.modelListHint}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex size-5 items-center justify-center justify-self-end" aria-hidden="true">
                            {isSelected ? <Check className="size-4 text-primary" strokeWidth={2.5} /> : null}
                          </span>
                        </button>
                      )
                    })}
                    {channelId === PROMA_OFFICIAL_CHANNEL_ID ? (
                      <p className="px-4 pb-2 pt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                        {OFFICIAL_MODEL_RATE_NOTE}
                      </p>
                    ) : null}
                  </div>
                )
              })
            })()
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
