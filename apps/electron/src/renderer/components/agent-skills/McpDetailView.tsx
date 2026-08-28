/**
 * McpDetailView — MCP Tab 内部详情页。
 *
 * 与 SkillDetailView 一致，复用当前右侧工作区 Tab 展示和编辑配置，
 * 不再通过覆盖会话历史的 Sheet 打开旧式预览。
 */

import * as React from 'react'
import { ArrowLeft, CheckCircle2, CircleDashed, Plug, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { McpServerForm } from '@/components/settings/McpServerForm'
import { cn } from '@/lib/utils'
import type { McpServerEntry } from '@proma/shared'

export interface McpDetailViewProps {
  name: string
  entry: McpServerEntry
  workspaceSlug: string
  onBack: () => void
  onChanged: () => void | Promise<void>
}

const TRANSPORT_LABELS: Record<string, string> = { stdio: 'stdio', http: 'HTTP', sse: 'SSE' }

export function McpDetailView({
  name,
  entry,
  workspaceSlug,
  onBack,
  onChanged,
}: McpDetailViewProps): React.ReactElement {
  const test = entry.lastTestResult
  const [closeRequestId, setCloseRequestId] = React.useState(0)
  const handleBack = React.useCallback(async (): Promise<void> => {
    await onChanged()
    onBack()
  }, [onBack, onChanged])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-10 gap-1.5 px-2" type="button" onClick={() => setCloseRequestId((value) => value + 1)}>
            <ArrowLeft size={16} />
            返回 MCP
          </Button>
          <h3 className="text-lg font-medium text-foreground">MCP 详情</h3>
        </div>

        <div className="mt-4 flex items-start gap-3">
          <div className="shrink-0 rounded-xl bg-primary/10 p-2 text-primary shadow-sm">
            <Plug size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-base font-semibold text-foreground">{name}</h4>
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {entry.isBuiltin ? '内置' : (TRANSPORT_LABELS[entry.type] ?? entry.type ?? '未知')}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{entry.enabled ? '已启用' : '已关闭'} · 配置变更会自动保存</div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className={cn(
            'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
            test
              ? test.success
                ? 'bg-primary/12 text-primary'
                : 'bg-destructive/10 text-destructive'
              : 'bg-muted text-muted-foreground',
          )}>
            {test ? test.success ? <CheckCircle2 size={12} /> : <XCircle size={12} /> : <CircleDashed size={12} />}
            {test ? test.success ? '连接正常' : '连接失败' : '尚未测试'}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-3xl p-5">
          <McpServerForm
            key={name}
            server={{ name, entry }}
            workspaceSlug={workspaceSlug}
            showHeader={false}
            closeRequestId={closeRequestId}
            onSaved={handleBack}
            onChanged={onChanged}
            onCancel={handleBack}
          />
        </div>
      </div>
    </div>
  )
}
