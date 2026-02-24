/**
 * SystemPromptSelector - ChatHeader 系统提示词下拉选择器
 *
 * ghost 按钮 + DropdownMenu 列表，与 Pin/Parallel 按钮风格统一。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { BookOpen, Check, Star, Pencil } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  promptConfigAtom,
  selectedPromptIdAtom,
  defaultPromptIdAtom,
  promptSidebarOpenAtom,
} from '@/atoms/system-prompt-atoms'
import { cn } from '@/lib/utils'

export function SystemPromptSelector(): React.ReactElement {
  const [config, setConfig] = useAtom(promptConfigAtom)
  const [selectedId, setSelectedId] = useAtom(selectedPromptIdAtom)
  const defaultPromptId = useAtomValue(defaultPromptIdAtom)
  const setPromptSidebarOpen = useSetAtom(promptSidebarOpenAtom)
  const [open, setOpen] = React.useState(false)

  /** 懒加载配置 */
  React.useEffect(() => {
    window.electronAPI.getSystemPromptConfig().then((cfg) => {
      setConfig(cfg)
    }).catch(console.error)
  }, [setConfig])

  const selectedPrompt = config.prompts.find((p) => p.id === selectedId)
  const tooltipText = selectedPrompt ? `提示词: ${selectedPrompt.name}` : '选择提示词'

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={tooltipText}
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <BookOpen className="size-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56 z-[60]">
        {config.prompts.map((prompt) => (
          <div
            key={prompt.id}
            onClick={() => {
              setSelectedId(prompt.id)
              setOpen(false)
            }}
            className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {/* 选中标记 */}
            <Check className={cn(
              'size-4 shrink-0',
              prompt.id === selectedId ? 'opacity-100' : 'opacity-0'
            )} />

            {/* 名称 */}
            <span className="flex-1 truncate">{prompt.name}</span>

            {/* 标记 */}
            {prompt.isBuiltin && (
              <span className="text-xs text-muted-foreground shrink-0">(内置)</span>
            )}
            {prompt.id === defaultPromptId && (
              <Star className="size-3 text-amber-500 fill-amber-500 shrink-0" />
            )}
          </div>
        ))}
        <DropdownMenuSeparator />
        <div
          onClick={() => {
            setPromptSidebarOpen(true)
            setOpen(false)
          }}
          className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Pencil className="size-4" />
          <span>编辑提示词</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
