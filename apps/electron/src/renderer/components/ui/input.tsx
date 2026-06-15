import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 基础：吃 token 圆角与 shadow-xs；border 用 60% 透明度以呈现"hairline"细线
          "flex h-9 w-full rounded-md border border-border/60 bg-background/40 px-3 py-1 text-base shadow-xs",
          "transition-[border-color,box-shadow,background-color] duration-150 ease-out",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground/70",
          // hover：边框轻微加深，给反馈但不抢戏
          "hover:border-border",
          // 聚焦：双层光晕（4px 半透明 ring + 1px 实色 border）+ 背景纯化，焦点位置清晰且不刺眼
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
Input.displayName = "Input"

export { Input }
