/**
 * McpDetailSheet — MCP 服务器编辑 / 新增右侧抽屉
 *
 * 复用 McpServerForm（自带保存逻辑），server 为 null 时是新增模式。
 */

import * as React from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { McpServerForm } from '@/components/settings/McpServerForm'
import type { McpServerEntry } from '@proma/shared'

interface McpDetailSheetProps {
  open: boolean
  server: { name: string; entry: McpServerEntry } | null
  workspaceSlug: string
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  onChanged?: () => void
}

export function McpDetailSheet({ open, server, workspaceSlug, onOpenChange, onSaved, onChanged }: McpDetailSheetProps): React.ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent hideClose side="right" className="w-[560px] sm:max-w-[560px] overflow-y-auto scrollbar-thin pt-5" aria-describedby={undefined}>
        <SheetTitle className="sr-only">{server ? `编辑 MCP 服务器 ${server.name}` : '添加 MCP 服务器'}</SheetTitle>
        {open && (
          <McpServerForm
            key={server?.name ?? '__new__'}
            server={server}
            workspaceSlug={workspaceSlug}
            onSaved={onSaved}
            onChanged={onChanged}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
