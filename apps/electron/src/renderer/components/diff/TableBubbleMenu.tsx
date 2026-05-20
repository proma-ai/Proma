import * as React from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { CellSelection, isInTable } from '@tiptap/pm/tables'
import {
  ArrowUpFromLine,
  ArrowDownFromLine,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Columns,
  Rows,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

interface TableBubbleMenuProps {
  editor: Editor
}

function selectionInsideNode(editor: Editor, nodeName: string): boolean {
  const { $from, $to } = editor.state.selection
  const contains = (pos: typeof $from) => {
    for (let depth = pos.depth; depth > 0; depth -= 1) {
      if (pos.node(depth).type.name === nodeName) return true
    }
    return false
  }
  return contains($from) || contains($to)
}

function shouldShowTableMenu(editor: Editor): boolean {
  if (!editor.isEditable) return false
  if (editor.state.selection instanceof CellSelection) return false
  return isInTable(editor.state) || selectionInsideNode(editor, 'table')
}

function TableButton({
  icon: Icon,
  label,
  destructive,
  disabled,
  onClick,
}: {
  icon: React.ElementType
  label: string
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('h-7 w-7', destructive && 'text-destructive hover:text-destructive')}
          disabled={disabled}
          onClick={(e) => {
            e.preventDefault()
            onClick()
          }}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  )
}

export function TableBubbleMenu({ editor }: TableBubbleMenuProps): React.ReactElement {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubbleMenu"
      shouldShow={({ editor: ed }) => shouldShowTableMenu(ed)}
    >
      <div className="flex items-center gap-0.5 rounded-lg border bg-popover px-1 py-0.5 shadow-md">
        <TableButton icon={ArrowUpFromLine} label="上方插入行" onClick={() => editor.chain().focus().addRowBefore().run()} />
        <TableButton icon={ArrowDownFromLine} label="下方插入行" onClick={() => editor.chain().focus().addRowAfter().run()} />
        <TableButton icon={ArrowLeftFromLine} label="左侧插入列" onClick={() => editor.chain().focus().addColumnBefore().run()} />
        <TableButton icon={ArrowRightFromLine} label="右侧插入列" onClick={() => editor.chain().focus().addColumnAfter().run()} />

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        <TableButton icon={Rows} label="删除行" destructive onClick={() => editor.chain().focus().deleteRow().run()} />
        <TableButton icon={Columns} label="删除列" destructive onClick={() => editor.chain().focus().deleteColumn().run()} />

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        <TableButton icon={Trash2} label="删除表格" destructive onClick={() => editor.chain().focus().deleteTable().run()} />
      </div>
    </BubbleMenu>
  )
}
