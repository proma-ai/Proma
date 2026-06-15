import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          // 与 Input 同款 hairline + 双层 focus glow，仅高度与最小高度不同
          "flex min-h-[60px] w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 text-base shadow-xs",
          "transition-[border-color,box-shadow,background-color] duration-150 ease-out",
          "placeholder:text-muted-foreground/70",
          "hover:border-border",
          "focus-visible:outline-none focus-visible:border-ring focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-ring/15",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
