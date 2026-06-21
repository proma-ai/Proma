/**
 * ModelSelector - 模型选择器（Dialog + Command 搜索）
 *
 * 现代化设计：
 * - 大尺寸 Dialog，宽敞易读
 * - 按渠道分组，灰色背景供应商标题行
 * - 选中项左侧绿色竖条高亮
 * - 触发按钮：模型 logo + 模型名 + Chevron
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronDown, Cpu, Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  conversationsAtom,
  selectedModelAtom,
  channelsAtom,
  channelsLoadedAtom,
} from '@/atoms/chat-atoms'
import { useConversationModelOptional } from '@/hooks/useConversationSettings'
import { useConversationIdOptional } from '@/contexts/session-context'
import { getModelLogo, getChannelLogo, DefaultLogo } from '@/lib/model-logo'
import { cn } from '@/lib/utils'
import type { Channel, ModelOption } from '@proma/shared'

/** 从渠道列表构建扁平化的模型选项 */
function buildModelOptions(channels: Channel[], filterChannelId?: string, filterChannelIds?: string[]): ModelOption[] {
  const options: ModelOption[] = []

  for (const channel of channels) {
    if (!channel.enabled) continue
    if (filterChannelId && channel.id !== filterChannelId) continue
    if (filterChannelIds && filterChannelIds.length > 0 && !filterChannelIds.includes(channel.id)) continue

    for (const model of channel.models) {
      if (!model.enabled) continue

      options.push({
        channelId: channel.id,
        channelName: channel.name,
        modelId: model.id,
        modelName: model.name,
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
  /** 触发按钮是否显示「渠道 · 模型」（默认只显示模型名） */
  showChannelInTrigger?: boolean
}

export function ModelSelector({
  filterChannelId,
  filterChannelIds,
  externalSelectedModel,
  onModelSelect,
  showChannelInTrigger = false,
}: ModelSelectorProps = {}): React.ReactElement {
  const [conversationModel, setConversationModel] = useConversationModelOptional()
  const conversationId = useConversationIdOptional()
  const setConversations = useSetAtom(conversationsAtom)
  const setGlobalModel = useSetAtom(selectedModelAtom)
  const channels = useAtomValue(channelsAtom)
  const channelsLoaded = useAtomValue(channelsLoadedAtom)
  const setChannels = useSetAtom(channelsAtom)
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')

  // 外部模型优先 → per-conversation 模型
  const selectedModel = externalSelectedModel !== undefined ? externalSelectedModel : conversationModel

  // 每次打开 Dialog 时刷新渠道列表，确保最新
  React.useEffect(() => {
    if (open) {
      window.electronAPI.listChannels().then(setChannels).catch(console.error)
      setSearch('')
    }
  }, [open, setChannels])

  const modelOptions = React.useMemo(() => buildModelOptions(channels, filterChannelId, filterChannelIds), [channels, filterChannelId, filterChannelIds])
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
    <>
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="model-selector-trigger flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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

      {/* 模型选择 Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 gap-0 max-w-lg" aria-describedby={undefined}>
          <DialogHeader className="sr-only">
            <DialogTitle>选择模型</DialogTitle>
          </DialogHeader>

          {/* 搜索栏 */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/60">
            <Search className="size-5 text-muted-foreground/60 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="搜索模型..."
              className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/50"
              autoFocus
            />
          </div>

          {/* 模型列表 */}
          <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
            {filteredGrouped.size === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                未找到模型
              </div>
            ) : (
              (() => {
                let flatIndex = 0
                return Array.from(filteredGrouped.entries()).map(([channelId, options]) => {
                const first = options[0]
                if (!first) return null

                return (
                  <div key={channelId}>
                    {/* 供应商标题行 - 灰色背景 */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b border-border/30">
                      <img
                        src={(() => {
                          const ch = channels.find((c) => c.id === channelId)
                          return ch ? getChannelLogo(ch) : DefaultLogo
                        })()}
                        alt={first.channelName}
                        className="size-5 rounded object-cover"
                      />
                      <span className="text-sm font-medium text-muted-foreground">
                        {first.channelName}
                      </span>
                    </div>

                    {/* 该渠道下的模型列表 */}
                    {options.map((option) => {
                      const isSelected =
                        selectedModel?.channelId === option.channelId &&
                        selectedModel?.modelId === option.modelId
                      const currentFlatIndex = flatIndex++
                      const isHighlighted = currentFlatIndex === highlightIndex

                      return (
                        <button
                          key={`${option.channelId}:${option.modelId}`}
                          ref={(el) => {
                            if (el) itemRefs.current.set(currentFlatIndex, el)
                            else itemRefs.current.delete(currentFlatIndex)
                          }}
                          type="button"
                          onClick={() => handleSelect(option)}
                          onMouseEnter={() => setHighlightIndex(currentFlatIndex)}
                          className={cn(
                            'flex items-center gap-3 w-[calc(100%-1rem)] px-4 py-1.5 mx-2 rounded-lg text-left transition-colors',
                            'hover:bg-accent',
                            isHighlighted && 'bg-accent',
                            isSelected && 'bg-foreground/10 border-l-3 border-l-primary'
                          )}
                        >
                          <img
                            src={getModelLogo(option.modelId, option.provider)}
                            alt={option.modelName}
                            className="size-5 rounded object-cover flex-shrink-0"
                          />
                          <span className={cn(
                            'flex-1 text-sm truncate',
                            isSelected ? 'font-medium text-foreground' : 'text-foreground/80'
                          )}>
                            {option.modelName}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })
              })()
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
