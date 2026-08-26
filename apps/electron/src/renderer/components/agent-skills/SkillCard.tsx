/**
 * SkillCard — Agent 技能视图中的 Skill 卡片（商店风）
 *
 * 整卡可点击打开详情抽屉；右上角开关与「更新」按钮独立响应（阻止冒泡）。
 */

import * as React from 'react'
import { Sparkles, RefreshCw, ShieldCheck, ArrowDownToLine, Building2, Upload } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@proma/shared'

interface SkillCardProps {
  skill: SkillMeta
  isBuiltin: boolean
  updating: boolean
  canPublishToEnterprise?: boolean
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  onUpdate: () => void
  onPublishToEnterprise?: () => void
}

/** 仅接受完整 SemVer；本地候选版本必须严格高于企业库版本才可发布。 */
function isNewerSemver(candidate: string, current: string): boolean {
  const parse = (value: string): { core: number[]; prerelease: string[] } | null => {
    const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
    if (!match) return null
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split('.') ?? [] }
  }
  const next = parse(candidate)
  const previous = parse(current)
  if (!next || !previous) return false
  for (let index = 0; index < 3; index++) {
    const nextPart = next.core[index] ?? 0
    const previousPart = previous.core[index] ?? 0
    if (nextPart !== previousPart) return nextPart > previousPart
  }
  if (next.prerelease.length === 0 || previous.prerelease.length === 0) return next.prerelease.length === 0 && previous.prerelease.length > 0
  for (let index = 0; index < Math.max(next.prerelease.length, previous.prerelease.length); index++) {
    const left = next.prerelease[index]
    const right = previous.prerelease[index]
    if (left === right) continue
    if (left === undefined) return false
    if (right === undefined) return true
    const leftNumber = /^\d+$/.test(left)
    const rightNumber = /^\d+$/.test(right)
    if (leftNumber && rightNumber) return Number(left) > Number(right)
    if (leftNumber !== rightNumber) return !leftNumber
    return left > right
  }
  return false
}

export function SkillCard({ skill, isBuiltin, updating, canPublishToEnterprise = false, onOpen, onToggle, onUpdate, onPublishToEnterprise }: SkillCardProps): React.ReactElement {
  // 企业来源 Skill 只有在本地 SKILL.md 版本已变更时才能推送；相同版本没有可发布内容。
  const hasPublishableEnterpriseVersion = !skill.enterpriseSource || (
    skill.version !== undefined && isNewerSemver(skill.version, skill.enterpriseSource.installedVersion)
  )

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
        ) : skill.enterpriseSource ? (
          <span className="flex max-w-full items-center gap-1 truncate rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
            <Building2 size={12} className="shrink-0" />
            企业 Skills
          </span>
        ) : skill.importSource ? (
          <span className="truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            来自 {skill.importSource.sourceWorkspaceName}
          </span>
        ) : (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            本项目
          </span>
        )}

        {canPublishToEnterprise && hasPublishableEnterpriseVersion && onPublishToEnterprise && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPublishToEnterprise() }}
                className={cn(
                  'flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90',
                  !skill.hasUpdate && 'ml-auto',
                )}
              >
                <Upload size={12} />
                {skill.enterpriseSource ? '推送更新' : '发布到企业库'}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{skill.enterpriseSource ? '以 SKILL.md 的新版本向企业库推送不可变更新' : '发布一个不可变版本，企业成员可在企业 Skills中手动安装'}</TooltipContent>
          </Tooltip>
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
        {!skill.hasUpdate && (skill.importSource || skill.enterpriseSource) && (
          <ArrowDownToLine size={12} className="ml-auto text-muted-foreground/40" />
        )}
      </div>
    </div>
  )
}
