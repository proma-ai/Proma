import type * as React from 'react'
import { Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelMarkProps {
  src?: string
  className?: string
}

export function ModelMark({ src, className }: ModelMarkProps): React.ReactElement {
  if (!src) {
    return <Cpu className={cn('shrink-0', className)} aria-hidden="true" />
  }

  return (
    <img
      src={src}
      alt=""
      className={cn(
        'shrink-0 object-contain grayscale opacity-70 contrast-125 brightness-90 dark:brightness-125',
        className
      )}
      aria-hidden="true"
      draggable={false}
    />
  )
}
