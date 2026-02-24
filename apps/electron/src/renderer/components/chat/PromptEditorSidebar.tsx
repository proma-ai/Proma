/**
 * PromptEditorSidebar - 提示词编辑侧栏
 *
 * 在 ChatView 右侧展开，支持切换/编辑/新建/保存提示词。
 * CRUD 逻辑复用 PromptSettings 的模式。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Plus, Trash2, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  promptConfigAtom,
  selectedPromptIdAtom,
  defaultPromptIdAtom,
  promptSidebarOpenAtom,
} from '@/atoms/system-prompt-atoms'
import type { SystemPrompt, SystemPromptCreateInput, SystemPromptUpdateInput } from '@proma/shared'

/** 防抖保存延迟 (ms) */
const DEBOUNCE_DELAY = 500

export function PromptEditorSidebar(): React.ReactElement {
  const [config, setConfig] = useAtom(promptConfigAtom)
  const [selectedId, setSelectedId] = useAtom(selectedPromptIdAtom)
  const defaultPromptId = useAtomValue(defaultPromptIdAtom)
  const setPromptSidebarOpen = useSetAtom(promptSidebarOpenAtom)

  const [editName, setEditName] = React.useState('')
  const [editContent, setEditContent] = React.useState('')
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedPrompt = React.useMemo(
    () => config.prompts.find((p) => p.id === selectedId),
    [config.prompts, selectedId]
  )

  /** 选中提示词变化时，同步编辑字段 */
  React.useEffect(() => {
    if (selectedPrompt) {
      setEditName(selectedPrompt.name)
      setEditContent(selectedPrompt.content)
    }
  }, [selectedPrompt])

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
      console.error('[提示词侧栏] 创建失败:', error)
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
      if (selectedId === id) {
        setSelectedId('builtin-default')
      }
    } catch (error) {
      console.error('[提示词侧栏] 删除失败:', error)
    }
  }

  /** 设为默认提示词 */
  const handleSetDefault = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.setDefaultPrompt(id)
      setConfig((prev) => ({ ...prev, defaultPromptId: id }))
    } catch (error) {
      console.error('[提示词侧栏] 设置默认失败:', error)
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
          console.error('[提示词侧栏] 保存失败:', error)
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
      console.error('[提示词侧栏] 更新追加设置失败:', error)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 头部 */}
      <div className="flex items-center justify-between h-12 px-3 border-b shrink-0">
        <span className="text-sm font-medium">提示词</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCreate} title="新建提示词">
            <Plus className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPromptSidebarOpen(false)} title="关闭">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* 提示词列表 */}
      <ScrollArea className="max-h-[200px] shrink-0">
        <div className="py-1">
          {config.prompts.map((prompt) => (
            <SidebarPromptItem
              key={prompt.id}
              prompt={prompt}
              isSelected={prompt.id === selectedId}
              isDefault={prompt.id === defaultPromptId}
              isHovered={prompt.id === hoveredId}
              onSelect={(id) => setSelectedId(id)}
              onDelete={handleDelete}
              onSetDefault={handleSetDefault}
              onHoverChange={setHoveredId}
            />
          ))}
        </div>
      </ScrollArea>

      <Separator />

      {/* 编辑区 */}
      {selectedPrompt && (
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto p-3 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">名称</label>
            <Input
              value={editName}
              onChange={(e) => handleNameChange(e.target.value)}
              readOnly={selectedPrompt.isBuiltin}
              className={cn('h-8 text-sm', selectedPrompt.isBuiltin && 'opacity-60 cursor-not-allowed')}
              maxLength={50}
            />
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">内容</label>
            <Textarea
              value={editContent}
              onChange={(e) => handleContentChange(e.target.value)}
              readOnly={selectedPrompt.isBuiltin}
              className={cn(
                'flex-1 min-h-[120px] resize-none text-sm',
                selectedPrompt.isBuiltin && 'opacity-60 cursor-not-allowed'
              )}
              placeholder="输入系统提示词内容..."
            />
          </div>
        </div>
      )}

      {/* 底部追加设置 */}
      <div className="border-t px-3 py-2.5 shrink-0">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-xs text-muted-foreground">追加日期时间和用户名</span>
          <Switch
            checked={config.appendDateTimeAndUserName}
            onCheckedChange={handleAppendChange}
          />
        </label>
      </div>
    </div>
  )
}

/** 侧栏提示词列表项 */
interface SidebarPromptItemProps {
  prompt: SystemPrompt
  isSelected: boolean
  isDefault: boolean
  isHovered: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
  onHoverChange: (id: string | null) => void
}

function SidebarPromptItem({
  prompt,
  isSelected,
  isDefault,
  isHovered,
  onSelect,
  onDelete,
  onSetDefault,
  onHoverChange,
}: SidebarPromptItemProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors',
        isSelected ? 'bg-accent/50' : 'hover:bg-muted/50'
      )}
      onClick={() => onSelect(prompt.id)}
      onMouseEnter={() => onHoverChange(prompt.id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      {/* 名称 + 标记 */}
      <div className="flex-1 min-w-0 flex items-center gap-1">
        <span className="text-sm truncate">{prompt.name}</span>
        {prompt.isBuiltin && (
          <span className="text-[10px] text-muted-foreground shrink-0">(内置)</span>
        )}
        {isDefault && (
          <Star className="size-3 text-amber-500 fill-amber-500 shrink-0" />
        )}
      </div>

      {/* 操作按钮 */}
      <div className={cn(
        'flex items-center gap-0.5 shrink-0 transition-opacity',
        isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        {!isDefault && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={(e) => {
              e.stopPropagation()
              onSetDefault(prompt.id)
            }}
            title="设为默认"
          >
            <Star className="size-3 text-muted-foreground" />
          </Button>
        )}
        {!prompt.isBuiltin && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(prompt.id)
            }}
            title="删除"
          >
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>
    </div>
  )
}
