import * as React from 'react'
import { Blocks, Brain, CalendarDays, Clock, FolderOpen, Globe, ListTodo, ServerCog, SquareTerminal } from 'lucide-react'
import { OBSIDIAN_NAME, ObsidianIcon } from '@/components/obsidian/obsidian-brand'
import type { BrowserAddTabMenuAction } from '@proma/shared'
import { cn } from '@/lib/utils'

const MENU_ITEMS: Array<{ action: BrowserAddTabMenuAction; label: string; icon: React.ReactNode }> = [
  { action: 'browser', label: '新建浏览器标签', icon: <Globe className="size-3.5" /> },
  { action: 'file', label: '打开文件', icon: <FolderOpen className="size-3.5" /> },
  { action: 'terminal', label: '新建终端', icon: <SquareTerminal className="size-3.5" /> },
  { action: 'todos', label: '打开 Todo', icon: <ListTodo className="size-3.5" /> },
  { action: 'calendar', label: '打开日程', icon: <CalendarDays className="size-3.5" /> },
  { action: 'skills', label: '打开 Skills', icon: <Blocks className="size-3.5" /> },
  { action: 'mcp', label: '打开 MCP', icon: <ServerCog className="size-3.5" /> },
  { action: 'memory', label: '打开项目记忆', icon: <Brain className="size-3.5" /> },
  { action: 'automations', label: '打开定时任务', icon: <Clock className="size-3.5" /> },
  { action: 'vault', label: `打开 ${OBSIDIAN_NAME}`, icon: <ObsidianIcon className="size-3.5" /> },
]

export function AddTabMenuWindowApp(): React.ReactElement {
  const initialToken = React.useMemo(() => new URLSearchParams(window.location.search).get('token'), [])
  const [token, setToken] = React.useState(initialToken)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  const clearMenuFocus = React.useCallback(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) activeElement.blur()
  }, [])

  const focusMenu = React.useCallback(() => {
    menuRef.current?.focus({ preventScroll: true })
  }, [])

  React.useEffect(() => {
    document.body.style.background = 'transparent'
    const removeTokenListener = window.electronAPI.onAgentAddTabMenuToken(setToken)
    const handleWindowFocus = (): void => focusMenu()
    const handleWindowBlur = (): void => clearMenuFocus()
    const handleVisibilityChange = (): void => {
      if (document.hidden) clearMenuFocus()
    }
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      removeTokenListener()
      document.body.style.background = ''
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [clearMenuFocus, focusMenu])

  const handleMenuKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      window.close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const activeIndex = itemRefs.current.findIndex((item) => item === document.activeElement)
    const lastIndex = itemRefs.current.length - 1
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? lastIndex
        : event.key === 'ArrowDown'
          ? activeIndex < 0 ? 0 : (activeIndex + 1) % itemRefs.current.length
          : activeIndex <= 0 ? lastIndex : activeIndex - 1
    itemRefs.current[nextIndex]?.focus({ preventScroll: true })
  }, [])

  const handleSelect = React.useCallback((action: BrowserAddTabMenuAction) => {
    if (!token) {
      window.close()
      return
    }
    void window.electronAPI.selectAgentAddTabMenuAction({ token, action }).catch((error) => {
      console.error('[右侧工作区] 选择原生样式菜单项失败:', error)
      window.close()
    })
  }, [token])

  return (
    <div
      ref={menuRef}
      className="h-screen w-screen overflow-hidden p-1.5 outline-none"
      role="menu"
      tabIndex={-1}
      aria-label="添加右侧工作区标签"
      onKeyDown={handleMenuKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex h-full w-full flex-col rounded-lg border border-border/80 bg-popover p-1 text-popover-foreground shadow-2xl">
        {MENU_ITEMS.map((item, index) => (
          <React.Fragment key={item.action}>
            {index === 3 && <div className="my-1 h-px bg-border/70" aria-hidden="true" />}
            <button
              ref={(element) => { itemRefs.current[index] = element }}
              type="button"
              role="menuitem"
              className={cn(
                'flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors',
                'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
              )}
              onPointerDown={(event) => {
                if (event.button === 0) event.preventDefault()
              }}
              onClick={() => handleSelect(item.action)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
