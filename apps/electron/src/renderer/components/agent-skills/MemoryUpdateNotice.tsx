import * as React from 'react'
import { useAtom } from 'jotai'
import { Brain, ChevronRight, Sparkles, X } from 'lucide-react'
import { workspaceMemoryUpdatesAtom, memoryNavigationRequestAtom } from '@/atoms/memory-atoms'
import { activeViewAtom, agentSkillsTabAtom } from '@/atoms/active-view'
import { Button } from '@/components/ui/button'

/** A lightweight, renderer-lifetime notice. It deliberately previews only bounded change summaries. */
export function MemoryUpdateNotice(): React.ReactElement | null {
  const [updates, setUpdates] = useAtom(workspaceMemoryUpdatesAtom)
  const [, setNavigation] = useAtom(memoryNavigationRequestAtom)
  const [, setActiveView] = useAtom(activeViewAtom)
  const [, setSkillsTab] = useAtom(agentSkillsTabAtom)
  const update = Array.from(updates.values()).find((item) => item.unread) ?? Array.from(updates.values())[0]
  if (!update) return null
  const isExpanded = update.unread
  const profile = update.category === 'profile'
  const projectInstruction = update.category === 'project_instruction'
  const workspaceInstruction = update.category === 'workspace_instruction'
  const instruction = projectInstruction || workspaceInstruction
  const label = profile
    ? '协作画像'
    : projectInstruction ? '项目地图'
      : workspaceInstruction ? 'Proma 工作区规则' : '协作记忆'
  const primaryPath = profile ? 'user-profile.md' : update.files[0]?.relativePath ?? 'MEMORY.md'
  const open = (mode: 'preview' | 'edit') => {
    if (!instruction) {
      setNavigation({ workspaceSlug: update.workspaceSlug, relativePath: primaryPath, mode })
    }
    setSkillsTab('memory')
    setActiveView('agent-skills')
    setUpdates((prev) => {
      const next = new Map(prev)
      next.set(update.workspaceSlug, { ...update, unread: false })
      return next
    })
  }
  const dismiss = () => {
    setUpdates((prev) => {
      const next = new Map(prev)
      next.set(update.workspaceSlug, { ...update, unread: false })
      return next
    })
  }

  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={() => open('preview')}
        title={`${label}已更新：${update.files.map((file) => `${file.area === 'project_instruction' ? '项目根/' : file.area === 'workspace_instruction' ? '工作区/' : ''}${file.relativePath}`).join('、')}`}
        className="group fixed right-5 bottom-5 z-[90] inline-flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-3 py-2 text-xs font-medium shadow-lg backdrop-blur transition hover:bg-accent"
      >
        <Brain size={15} className="text-primary" />
        <span>{profile ? '协作画像已更新' : '项目记忆已更新'}</span>
        <span className="pointer-events-none absolute right-0 bottom-[calc(100%+10px)] hidden w-72 rounded-xl border border-border/70 bg-background p-3 text-left text-xs font-normal leading-relaxed text-muted-foreground shadow-xl group-hover:block group-focus-visible:block">
          <span className="mb-1 block font-medium text-foreground">{update.files[0]?.relativePath}</span>
          {update.files[0]?.preview ?? '点击快速查看本次记忆变更。'}
        </span>
      </button>
    )
  }

  return (
    <aside className="fixed right-5 bottom-5 z-[90] w-[min(360px,calc(100vw-40px))] rounded-2xl border border-primary/20 bg-background/95 p-4 shadow-2xl backdrop-blur" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary"><Sparkles size={16} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{profile ? '协作画像已更新' : `Agent 更新了${label}`}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {update.files.length} 个文件发生变化。{profile ? '画像位于长期记忆顶部，供后续协作参考。' : instruction ? '只展示本次受管 AGENTS.md 更新的摘要。' : '只展示本次受管协作记忆更新的摘要。'}
          </p>
        </div>
        <button type="button" onClick={dismiss} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="稍后查看记忆更新"><X size={16} /></button>
      </div>
      <div className="mt-3 space-y-1.5 rounded-xl bg-muted/50 p-2.5 text-xs text-muted-foreground">
        {update.files.slice(0, 2).map((file) => (
          <div key={file.id} className="truncate" title={file.preview ?? file.relativePath}>
            <span className="font-medium text-foreground/80">{file.area === 'project_instruction' ? '项目根/' : file.area === 'workspace_instruction' ? '工作区/' : ''}{file.relativePath}</span>{file.preview ? ` · ${file.preview}` : ''}
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dismiss}>稍后</Button>
        <Button size="sm" onClick={() => open('edit')}>{instruction ? '前往长期知识' : '查看并编辑'} <ChevronRight size={14} className="ml-1" /></Button>
      </div>
    </aside>
  )
}
