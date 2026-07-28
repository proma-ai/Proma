import * as React from 'react'
import { Check, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { PlanningGroup, PlanningGroupScope } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

interface PlanningGroupManagerProps {
  scope: PlanningGroupScope
  groups: PlanningGroup[]
  /** 触发器由嵌入位置决定，保证 Todo / 日程入口的视觉语境一致。 */
  trigger: React.ReactElement
  itemLabel: string
  getUsageCount: (groupId: string) => number
  onCreate: (name: string) => Promise<PlanningGroup | undefined>
  onRename: (group: PlanningGroup, name: string) => Promise<PlanningGroup | undefined>
  onDelete: (group: PlanningGroup) => Promise<boolean>
  onCreated?: (group: PlanningGroup) => void
}

/**
 * 轻量分组管理器：不单独占用页面，只在当前工作流中提供新建、重命名与删除。
 * 删除操作仅解除关联，目标 Todo 或日程本身不会被删除。
 */
export function PlanningGroupManager({ scope, groups, trigger, itemLabel, getUsageCount, onCreate, onRename, onDelete, onCreated }: PlanningGroupManagerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameName, setRenameName] = React.useState('')
  const [pendingDeletion, setPendingDeletion] = React.useState<PlanningGroup | null>(null)
  const [savingAction, setSavingAction] = React.useState<'create' | 'rename' | 'delete' | null>(null)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  const title = scope === 'todo' ? 'Todo 分组' : '日程分组'

  React.useEffect(() => {
    if (!renamingId) return
    const frame = window.requestAnimationFrame(() => renameInputRef.current?.select())
    return () => window.cancelAnimationFrame(frame)
  }, [renamingId])

  const closeManager = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setCreating(false)
      setNewName('')
      setRenamingId(null)
      setRenameName('')
    }
  }

  const createGroup = async (): Promise<void> => {
    const name = newName.trim()
    if (!name || savingAction) return
    setSavingAction('create')
    try {
      const group = await onCreate(name)
      if (!group) return
      setNewName('')
      setCreating(false)
      onCreated?.(group)
    } finally {
      setSavingAction(null)
    }
  }

  const startRenaming = (group: PlanningGroup): void => {
    setRenamingId(group.id)
    setRenameName(group.name)
  }

  const renameGroup = async (group: PlanningGroup): Promise<void> => {
    const name = renameName.trim()
    if (!name || savingAction) return
    if (name === group.name) {
      setRenamingId(null)
      setRenameName('')
      return
    }
    setSavingAction('rename')
    try {
      const updated = await onRename(group, name)
      if (!updated) return
      setRenamingId(null)
      setRenameName('')
    } finally {
      setSavingAction(null)
    }
  }

  const deleteGroup = async (): Promise<void> => {
    const group = pendingDeletion
    if (!group || savingAction) return
    setSavingAction('delete')
    try {
      const deleted = await onDelete(group)
      if (deleted) setPendingDeletion(null)
    } finally {
      setSavingAction(null)
    }
  }

  const deletionCount = pendingDeletion ? getUsageCount(pendingDeletion.id) : 0
  return <>
    <Popover open={open} onOpenChange={closeManager}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-none border-border/60 p-3 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">新建、重命名或删除分组</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="size-10 -mr-1 -mt-1" aria-label="新建分组" title="新建分组" onClick={() => setCreating(true)}><Plus size={16} /></Button>
        </div>

        {creating && <div className="mt-3 flex items-center gap-1.5 rounded-md bg-muted/45 p-1.5">
          <Input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createGroup() } else if (event.key === 'Escape') { setCreating(false); setNewName('') } }} placeholder="分组名称" className="h-9 border-0 bg-background px-2 text-sm shadow-none focus-visible:ring-1" />
          <Button type="button" size="icon" className="size-10" aria-label="确认新建分组" disabled={!newName.trim() || savingAction === 'create'} onClick={() => void createGroup()}><Check size={16} /></Button>
        </div>}

        <div className="mt-2 max-h-72 space-y-1 overflow-y-auto scrollbar-thin">
          {groups.length ? groups.map((group) => {
            const usageCount = getUsageCount(group.id)
            const renaming = renamingId === group.id
            return <div key={group.id} className="group flex min-h-10 items-center gap-1 rounded-md px-1.5 hover:bg-muted/55 focus-within:bg-muted/55">
              {renaming ? <>
                <span className="ml-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: group.color ?? 'currentColor' }} />
                <Input ref={renameInputRef} value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void renameGroup(group) } else if (event.key === 'Escape') { setRenamingId(null); setRenameName('') } }} aria-label={`重命名 ${group.name}`} className="h-9 min-w-0 flex-1 border-0 bg-background px-2 text-sm shadow-none focus-visible:ring-1" />
                <Button type="button" variant="ghost" size="icon" className="size-10" aria-label="确认重命名" disabled={savingAction === 'rename' || !renameName.trim()} onClick={() => void renameGroup(group)}><Check size={15} /></Button>
                <Button type="button" variant="ghost" size="icon" className="size-10" aria-label="取消重命名" disabled={savingAction === 'rename'} onClick={() => { setRenamingId(null); setRenameName('') }}><X size={15} /></Button>
              </> : <>
                <span className="ml-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: group.color ?? 'currentColor' }} />
                <span className="min-w-0 flex-1 truncate px-1 text-sm">{group.name}</span>
                <span className="tabular-nums text-xs text-muted-foreground">{usageCount}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-10 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground" aria-label={`管理分组 ${group.name}`}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[110] min-w-32">
                    <DropdownMenuItem onSelect={() => startRenaming(group)}><Pencil />重命名</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setPendingDeletion(group); setOpen(false) }}><Trash2 />删除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>}
            </div>
          }) : <p className="px-2 py-6 text-center text-sm text-muted-foreground">还没有分组</p>}
        </div>
      </PopoverContent>
    </Popover>

    <AlertDialog open={pendingDeletion !== null} onOpenChange={(nextOpen) => { if (!nextOpen && savingAction !== 'delete') setPendingDeletion(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除分组</AlertDialogTitle>
          <AlertDialogDescription>{deletionCount > 0 ? `删除「${pendingDeletion?.name}」后，${deletionCount} 个${itemLabel}会变为未分组，内容不会删除。` : `删除「${pendingDeletion?.name}」后无法恢复。`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={savingAction === 'delete'}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={savingAction === 'delete'} onClick={(event) => { event.preventDefault(); void deleteGroup() }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{savingAction === 'delete' ? '删除中…' : '删除'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
