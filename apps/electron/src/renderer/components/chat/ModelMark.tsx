import type * as React from 'react'
import { Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelMarkProps {
  src?: string
  className?: string
}

export const modelMarkReadableToneClass = 'text-foreground/75 dark:text-foreground/90'

export function ModelMark({ src, className }: ModelMarkProps): React.ReactElement {
  if (!src) {
    return <Cpu className={cn('shrink-0', className)} aria-hidden="true" />
  }

  const maskStyle: React.CSSProperties = {
    WebkitMaskImage: `url("${src}")`,
    maskImage: `url("${src}")`,
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
  }

  return (
    <span
      className={cn('inline-block shrink-0 bg-current', className)}
      style={maskStyle}
      aria-hidden="true"
    />
  )
}
