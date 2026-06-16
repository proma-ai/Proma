/**
 * SkillCard — Agent 技能视图中的 Skill 卡片（商店风）
 *
 * 整卡可点击打开详情抽屉；右上角开关与「更新」按钮独立响应（阻止冒泡）。
 */

import * as React from 'react'
import { Sparkles, RefreshCw, ShieldCheck, ArrowDownToLine } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@proma/shared'

interface SkillCardProps {
  skill: SkillMeta
  isBuiltin: boolean
  updating: boolean
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  onUpdate: () => void
}

export function SkillCard({ skill, isBuiltin, updating, onOpen, onToggle, onUpdate }: SkillCardProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group relative flex h-full flex-col gap-3 rounded-xl border border-border/60 bg-content-area p-4 text-left transition-all cursor-pointer',
        'hover:border-border hover:shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        !skill.enabled && 'opacity-55',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-amber-500/12 p-2 text-amber-500 shadow-sm shrink-0">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{skill.name}</span>
            {skill.version && (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                v{skill.version}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{skill.slug}</div>
        </div>
        <Switch
          checked={skill.enabled}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        />
      </div>

      <p className="line-clamp-2 min-h-[40px] text-[13px] leading-6 text-muted-foreground">
        {skill.description ?? '暂无描述'}
      </p>

      <div className="mt-auto flex items-center gap-2">
        {isBuiltin ? (
          <span className="flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
            <ShieldCheck size={12} /> PROMA 内置
          </span>
        ) : skill.importSource ? (
          <span className="truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            来自 {skill.importSource.sourceWorkspaceName}
          </span>
        ) : (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            本工作区
          </span>
        )}

        {skill.hasUpdate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUpdate() }}
                disabled={updating}
                className="ml-auto flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-500/20 transition-colors disabled:opacity-60 dark:text-blue-400"
              >
                <RefreshCw size={12} className={cn(updating && 'animate-spin')} />
                {updating ? '更新中' : '有更新'}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">点击同步来源最新版本</TooltipContent>
          </Tooltip>
        )}
        {!skill.hasUpdate && skill.importSource && (
          <ArrowDownToLine size={12} className="ml-auto text-muted-foreground/40" />
        )}
      </div>
    </div>
  )
}
