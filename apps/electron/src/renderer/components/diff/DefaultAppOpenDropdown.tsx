/**
 * DefaultAppOpenDropdown — 预览面板顶部文件打开下拉按钮
 *
 * 点击展开/收起菜单，使用原生定位避免 Radix 兼容问题。
 */

import * as React from 'react'
import { ChevronDown, ExternalLink, Plus, X, FolderOpen, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { useDefaultAppForFile } from '@/hooks/useDefaultAppForFile'
import { cn } from '@/lib/utils'
import type { FileAccessOptions } from '@proma/shared'
import type { FileOpenAppEntry } from '@/types/settings'

interface DefaultAppOpenDropdownProps {
  filePath: string
  access?: FileAccessOptions
  className?: string
}

export function DefaultAppOpenDropdown({
  filePath,
  access,
  className,
}: DefaultAppOpenDropdownProps): React.ReactElement {
  const defaultAppInfo = useDefaultAppForFile(filePath, access)
  const [builtinApps, setBuiltinApps] = React.useState<Array<{ id: string; name: string; path: string; iconDataUrl: string }>>([])
  const [customApps, setCustomApps] = React.useState<FileOpenAppEntry[]>([])
  const [open, setOpen] = React.useState(false)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      window.electronAPI.listOpenApps().catch(() => [] as typeof builtinApps),
      window.electronAPI.getSettings().then((s) => s.fileOpenApps ?? []).catch(() => [] as FileOpenAppEntry[]),
    ]).then(([builtin, custom]) => {
      if (cancelled) return
      setBuiltinApps(builtin)
      setCustomApps(custom)
    })
    return () => { cancelled = true }
  }, [])

  // 点击外部关闭
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  const dirPath = React.useMemo(() => {
    const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    return lastSep > 0 ? filePath.slice(0, lastSep) : filePath
  }, [filePath])

  const persistCustomApps = React.useCallback((apps: FileOpenAppEntry[]) => {
    setCustomApps(apps)
    window.electronAPI.updateSettings({ fileOpenApps: apps }).catch(console.error)
  }, [])

  const handleDefaultOpen = React.useCallback(() => {
    setOpen(false)
    window.electronAPI.systemOpenFile(filePath, undefined, access).catch(console.error)
  }, [filePath, access])

  const handleOpenWith = React.useCallback((appPath: string) => {
    setOpen(false)
    window.electronAPI.systemOpenFile(filePath, appPath, access).catch(console.error)
  }, [filePath, access])

  const handleChooseOtherApp = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.chooseOpenApp()
      if (!result) return
      const exists = customApps.some((a) => a.path === result.path)
        || builtinApps.some((a) => a.path === result.path)
      if (exists) { toast.info(`${result.name} 已在列表中`); return }
      setOpen(false)
      persistCustomApps([...customApps, {
        id: `custom-${Date.now()}-${result.name}`,
        name: result.name, path: result.path, iconDataUrl: result.iconDataUrl,
      }])
      toast.success(`已添加 ${result.name}`)
    } catch (err) { console.error('[DefaultAppOpenDropdown] 选择应用失败:', err) }
  }, [customApps, builtinApps, persistCustomApps])

  const handleRemove = React.useCallback((e: React.MouseEvent, appId: string) => {
    e.stopPropagation()
    e.preventDefault()
    persistCustomApps(customApps.filter((a) => a.id !== appId))
  }, [customApps, persistCustomApps])

  const defaultName = defaultAppInfo?.name

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1 h-6 px-1.5 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors',
          open && 'bg-muted/50 text-foreground',
        )}
        title={defaultAppInfo ? `用 ${defaultAppInfo.name} 打开` : '选择打开方式'}
        aria-label="选择打开方式"
      >
        {defaultAppInfo ? (
          <img src={defaultAppInfo.iconDataUrl} alt="" className="size-4 shrink-0" draggable={false} />
        ) : (
          <ExternalLink className="size-4 shrink-0" />
        )}
        <span className="text-[11px] leading-none truncate max-w-[100px]">
          {defaultName ?? '默认应用'}
        </span>
        <ChevronDown className={cn('size-3 shrink-0 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {/* 默认应用打开 */}
          <MenuItem icon={<ExternalLink className="size-3.5 shrink-0" />} onClick={handleDefaultOpen}>
            用系统默认应用打开
          </MenuItem>

          {/* Finder */}
          <MenuItem
            icon={<FolderOpen className="size-3.5 shrink-0" />}
            onClick={() => { setOpen(false); window.electronAPI.showInFolder(filePath, access).catch(console.error) }}
          >
            在访达中显示
          </MenuItem>

          {/* 终端 */}
          <MenuItem
            icon={<Terminal className="size-3.5 shrink-0" />}
            onClick={() => { setOpen(false); window.electronAPI.systemOpenFile(dirPath, '/System/Applications/Utilities/Terminal.app', access).catch(console.error) }}
          >
            在终端中打开
          </MenuItem>

          {/* 预置应用 */}
          {builtinApps.length > 0 && <div className="my-1 h-px bg-border" />}
          {builtinApps.map((app) => (
            <MenuItem
              key={app.id}
              icon={app.iconDataUrl ? <img src={app.iconDataUrl} alt="" className="size-3.5 shrink-0" draggable={false} /> : <ExternalLink className="size-3.5 shrink-0" />}
              onClick={() => handleOpenWith(app.path)}
            >
              用 {app.name} 打开
            </MenuItem>
          ))}

          {/* 自定义应用 */}
          {customApps.length > 0 && <div className="my-1 h-px bg-border" />}
          {customApps.map((app) => (
            <MenuItem
              key={app.id}
              icon={app.iconDataUrl ? <img src={app.iconDataUrl} alt="" className="size-3.5 shrink-0" draggable={false} /> : <ExternalLink className="size-3.5 shrink-0" />}
              onClick={() => handleOpenWith(app.path)}
              rightAction={
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive rounded p-0.5 transition-opacity"
                  onClick={(e) => handleRemove(e, app.id)}
                  aria-label={`移除 ${app.name}`}
                >
                  <X className="size-3" />
                </button>
              }
            >
              {app.name}
            </MenuItem>
          ))}

          {/* 更多应用 */}
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={<Plus className="size-3.5 shrink-0" />} onClick={handleChooseOtherApp}>
            更多应用...
          </MenuItem>
        </div>
      )}
    </div>
  )
}

/** 菜单项 */
function MenuItem({
  icon,
  children,
  onClick,
  rightAction,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  rightAction?: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
    >
      {icon}
      <span className="truncate flex-1 text-left">{children}</span>
      {rightAction}
    </button>
  )
}
