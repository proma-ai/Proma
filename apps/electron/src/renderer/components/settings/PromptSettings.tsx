/**
 * PromptSettings - 系统提示词管理设置页
 *
 * 上方：提示词列表（选择/新建/删除/设为默认）
 * 下方：编辑区（名称 + 内容，内置只读）
 * 底部：追加日期时间和用户名开关
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Plus, Trash2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
} from './primitives'
import {
  promptConfigAtom,
  selectedPromptIdAtom,
  defaultPromptIdAtom,
} from '@/atoms/system-prompt-atoms'
import type { SystemPrompt, SystemPromptCreateInput, SystemPromptUpdateInput } from '@proma/shared'

/** 防抖保存延迟 (ms) */
const DEBOUNCE_DELAY = 500

export function PromptSettings(): React.ReactElement {
  const [config, setConfig] = useAtom(promptConfigAtom)
  const [selectedId, setSelectedId] = useAtom(selectedPromptIdAtom)
  const defaultPromptId = useAtomValue(defaultPromptIdAtom)

  const [editName, setEditName] = React.useState('')
  const [editContent, setEditContent] = React.useState('')
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 当前选中的提示词 */
  const selectedPrompt = React.useMemo(
    () => config.prompts.find((p) => p.id === selectedId),
    [config.prompts, selectedId]
  )

  /** 初始加载配置 */
  React.useEffect(() => {
    window.electronAPI.getSystemPromptConfig().then((cfg) => {
      setConfig(cfg)
    }).catch(console.error)
  }, [setConfig])

  /** 选中提示词变化时，同步编辑字段 */
  React.useEffect(() => {
    if (selectedPrompt) {
      setEditName(selectedPrompt.name)
      setEditContent(selectedPrompt.content)
    }
  }, [selectedPrompt])

  /** 选中提示词 */
  const handleSelect = (id: string): void => {
    setSelectedId(id)
  }

  /** 新建提示词 */
  const handleCreate = async (): Promise<void> => {
    const input: SystemPromptCreateInput = {
      name: '新提示词',
      content: '',
    }
    try {
      const created = await window.electronAPI.createSystemPrompt(input)
      setConfig((prev) => ({
        ...prev,
        prompts: [...prev.prompts, created],
      }))
      setSelectedId(created.id)
    } catch (error) {
      console.error('[提示词设置] 创建失败:', error)
    }
  }

  /** 删除提示词 */
  const handleDelete = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.deleteSystemPrompt(id)
      setConfig((prev) => {
        const newPrompts = prev.prompts.filter((p) => p.id !== id)
        const newDefaultId = prev.defaultPromptId === id ? 'builtin-default' : prev.defaultPromptId
        return { ...prev, prompts: newPrompts, defaultPromptId: newDefaultId }
      })
      // 如果删除的是当前选中的，切换到内置默认
      if (selectedId === id) {
        setSelectedId('builtin-default')
      }
    } catch (error) {
      console.error('[提示词设置] 删除失败:', error)
    }
  }

  /** 设为默认提示词 */
  const handleSetDefault = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.setDefaultPrompt(id)
      setConfig((prev) => ({ ...prev, defaultPromptId: id }))
    } catch (error) {
      console.error('[提示词设置] 设置默认失败:', error)
    }
  }

  /** 防抖自动保存 */
  const debounceSave = React.useCallback(
    (id: string, input: SystemPromptUpdateInput): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        try {
          const updated = await window.electronAPI.updateSystemPrompt(id, input)
          setConfig((prev) => ({
            ...prev,
            prompts: prev.prompts.map((p) => (p.id === updated.id ? updated : p)),
          }))
        } catch (error) {
          console.error('[提示词设置] 保存失败:', error)
        }
      }, DEBOUNCE_DELAY)
    },
    [setConfig]
  )

  /** 名称变更 */
  const handleNameChange = (value: string): void => {
    setEditName(value)
    if (selectedPrompt && !selectedPrompt.isBuiltin) {
      debounceSave(selectedPrompt.id, { name: value })
    }
  }

  /** 内容变更 */
  const handleContentChange = (value: string): void => {
    setEditContent(value)
    if (selectedPrompt && !selectedPrompt.isBuiltin) {
      debounceSave(selectedPrompt.id, { content: value })
    }
  }

  /** 更新追加设置 */
  const handleAppendChange = async (enabled: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateAppendSetting(enabled)
      setConfig((prev) => ({ ...prev, appendDateTimeAndUserName: enabled }))
    } catch (error) {
      console.error('[提示词设置] 更新追加设置失败:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* 提示词列表 */}
      <SettingsSection
        title="系统提示词"
        description="管理 Chat 模式的系统提示词"
        action={
          <Button size="sm" onClick={handleCreate}>
            <Plus className="size-4 mr-1" />
            新建
          </Button>
        }
      >
        <SettingsCard divided={false} className="p-0">
          <div className="divide-y divide-border/50">
            {config.prompts.map((prompt) => (
              <PromptListItem
                key={prompt.id}
                prompt={prompt}
                isSelected={prompt.id === selectedId}
                isDefault={prompt.id === defaultPromptId}
                isHovered={prompt.id === hoveredId}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onSetDefault={handleSetDefault}
                onHoverChange={(id) => setHoveredId(id)}
              />
            ))}
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 编辑区 */}
      {selectedPrompt && (
        <SettingsSection title="提示词内容">
          <SettingsCard divided={false} className="p-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                名称
              </label>
              <Input
                value={editName}
                onChange={(e) => handleNameChange(e.target.value)}
                readOnly={selectedPrompt.isBuiltin}
                className={cn(selectedPrompt.isBuiltin && 'opacity-60 cursor-not-allowed')}
                maxLength={50}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                内容
              </label>
              <Textarea
                value={editContent}
                onChange={(e) => handleContentChange(e.target.value)}
                readOnly={selectedPrompt.isBuiltin}
                className={cn(
                  'min-h-[280px] resize-y',
                  selectedPrompt.isBuiltin && 'opacity-60 cursor-not-allowed'
                )}
                placeholder="输入系统提示词内容..."
              />
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* 增强选项 */}
      <SettingsSection title="增强选项">
        <SettingsCard>
          <SettingsToggle
            label="追加日期时间和用户名"
            description="在提示词末尾自动追加当前日期时间和用户名"
            checked={config.appendDateTimeAndUserName}
            onCheckedChange={handleAppendChange}
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}

/** 提示词列表项 */
interface PromptListItemProps {
  prompt: SystemPrompt
  isSelected: boolean
  isDefault: boolean
  isHovered: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
  onHoverChange: (id: string | null) => void
}

function PromptListItem({
  prompt,
  isSelected,
  isDefault,
  isHovered,
  onSelect,
  onDelete,
  onSetDefault,
  onHoverChange,
}: PromptListItemProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors',
        isSelected ? 'bg-accent/50' : 'hover:bg-muted/50'
      )}
      onClick={() => onSelect(prompt.id)}
      onMouseEnter={() => onHoverChange(prompt.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      {/* 名称 + 标记 */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-sm font-medium truncate">{prompt.name}</span>
        {prompt.isBuiltin && (
          <span className="text-xs text-muted-foreground shrink-0">(内置)</span>
        )}
        {isDefault && (
          <Star className="size-3.5 text-amber-500 fill-amber-500 shrink-0" />
        )}
      </div>

      {/* 操作按钮 — 始终占位，hover 时显示 */}
      <div className={cn(
        'flex items-center gap-1 shrink-0 transition-opacity',
        isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        {!isDefault && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation()
              onSetDefault(prompt.id)
            }}
            title="设为默认"
          >
            <Star className="size-3.5 text-muted-foreground" />
          </Button>
        )}
        {!prompt.isBuiltin && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(prompt.id)
            }}
            title="删除"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
