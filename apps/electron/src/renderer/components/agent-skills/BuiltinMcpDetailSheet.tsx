/**
 * BuiltinMcpDetailSheet — Proma 内置 MCP 托管详情
 */

import * as React from 'react'
import { CheckCircle2, Settings2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { BuiltinMcpServerSummary } from '@proma/shared'

interface BuiltinMcpDetailSheetProps {
  open: boolean
  server: BuiltinMcpServerSummary | null
  onOpenChange: (open: boolean) => void
  onConfigure?: (serverId: string) => void
}

const CATEGORY_LABELS: Record<BuiltinMcpServerSummary['category'], string> = {
  system: '系统',
  automation: '自动化',
  collaboration: '协作',
  memory: '记忆',
  media: '媒体',
}

interface BuiltinMcpConfigInfo {
  source: string
  description: string
  actionLabel?: string
}

function getConfigInfo(server: BuiltinMcpServerSummary): BuiltinMcpConfigInfo {
  if (server.id === 'mem') {
    return {
      source: 'Chat 工具 / 记忆',
      description: '配置 MemOS Cloud API Key、用户 ID 与记忆开关后，Agent 会话才能注入记忆 MCP。',
      actionLabel: '配置记忆',
    }
  }
  if (server.id === 'nano-banana') {
    return {
      source: 'Chat 工具 / Nano Banana',
      description: '配置 Gemini API Key、API 地址、模型与开关后，Agent 会话才能注入生图 MCP。',
      actionLabel: '配置生图',
    }
  }
  if (server.id === 'collaboration') {
    return {
      source: '当前 Agent 工作区',
      description: '协作子 Agent 使用当前工作区、会话和权限上下文，无需填写额外凭据。',
    }
  }
  if (server.id === 'automation') {
    return {
      source: 'Proma 本地自动任务',
      description: '自动任务 MCP 直接使用 Proma 本地任务服务，无需填写额外凭据。',
    }
  }
  return {
    source: 'Proma 运行时',
    description: '该内置 MCP 由 Proma 运行时托管。',
  }
}

export function BuiltinMcpDetailSheet({ open, server, onOpenChange, onConfigure }: BuiltinMcpDetailSheetProps): React.ReactElement {
  const configInfo = server ? getConfigInfo(server) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[560px] sm:max-w-[560px] overflow-y-auto scrollbar-thin pt-12">
        {server && configInfo && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <SheetTitle>{server.displayName}</SheetTitle>
                <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                  Proma 内置
                </span>
              </div>
              <SheetDescription>{server.description}</SheetDescription>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <InfoItem label="MCP 名称" value={server.name} />
              <InfoItem label="分类" value={CATEGORY_LABELS[server.category]} />
              <InfoItem label="注入开关" value={server.enabled ? '允许注入' : '已手动关闭'} tone={server.enabled ? 'success' : 'muted'} />
              <InfoItem label="可用状态" value={server.available ? '当前可用' : (server.availabilityReason ?? '不可用')} tone={server.available ? 'success' : 'muted'} />
              <InfoItem label="配置来源" value={configInfo.source} />
            </div>

            <section className="rounded-lg bg-muted/45 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">如何配置</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{configInfo.description}</p>
                </div>
                {configInfo.actionLabel && onConfigure && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => onConfigure(server.id)}
                  >
                    <Settings2 size={14} />
                    <span>{configInfo.actionLabel}</span>
                  </Button>
                )}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="text-sm font-medium text-foreground">工具</div>
              <div className="flex flex-col gap-2">
                {server.tools.map((tool) => (
                  <div key={tool.name} className="rounded-lg bg-muted/45 p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{tool.name}</span>
                      {tool.readOnly && (
                        <span className="rounded-md bg-foreground/5 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          只读
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tool.description}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function InfoItem({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'muted' }): React.ReactElement {
  return (
    <div className="rounded-lg bg-muted/45 p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn(
        'mt-1 flex items-center gap-1.5 text-sm font-medium',
        tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'muted' && 'text-muted-foreground',
      )}>
        {tone === 'success' && <CheckCircle2 size={14} />}
        {tone === 'muted' && <XCircle size={14} />}
        <span>{value}</span>
      </div>
    </div>
  )
}
