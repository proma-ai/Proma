import * as React from 'react'
import { useAtomValue } from 'jotai'
import { shortcutOverridesAtom } from '@/atoms/shortcut-atoms'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { cn } from '@/lib/utils'

interface ShortcutKeycapsProps {
  accelerator?: string | null
  shortcutId?: string
  className?: string
  keycapClassName?: string
  separatorClassName?: string
}

/** Renders shortcut bindings using the same per-key treatment as Shortcut Settings. */
export function ShortcutKeycaps({
  accelerator,
  shortcutId,
  className,
  keycapClassName,
  separatorClassName,
}: ShortcutKeycapsProps): React.ReactElement | null {
  // Subscribe so keycaps update immediately when a binding changes in Settings.
  useAtomValue(shortcutOverridesAtom)
  const activeAccelerator = shortcutId ? getActiveAccelerator(shortcutId) : accelerator
  if (!activeAccelerator) return null

  const keys = activeAccelerator.split('+').map((key) => key.trim()).filter(Boolean)

  return (
    <span className={cn('inline-flex flex-wrap items-center justify-end gap-1', className)} aria-label={getAcceleratorDisplay(activeAccelerator)}>
      {keys.map((key, index) => (
        <React.Fragment key={`${key}-${index}`}>
          {index > 0 && <span aria-hidden="true" className={cn('text-[11px] font-medium text-muted-foreground/70', separatorClassName)}>+</span>}
          <kbd className={cn('inline-flex h-6 min-w-6 items-center justify-center rounded-[4px] border border-border/70 bg-background px-1.5 font-[system-ui] text-[12px] font-medium leading-none text-foreground shadow-sm', keycapClassName)}>
            {getAcceleratorDisplay(key)}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  )
}
