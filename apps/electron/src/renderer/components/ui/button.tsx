import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // 基础：更柔顺的圆角、全属性过渡、按下回弹、聚焦双层光晕；保留原 svg 尺寸约定
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[transform,background-color,box-shadow,border-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        // default：顶部 1px 内高光（白色 8% 透明）+ 底部柔阴影 + 1px 暗描边，模拟 Linear/Vercel/Conductor 的"立体片状"按钮质感
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.10),0_1px_2px_0_rgb(0_0_0/0.18),0_0_0_1px_rgb(0_0_0/0.06)] hover:bg-primary/92 hover:shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.14),0_2px_4px_-1px_rgb(0_0_0/0.22),0_0_0_1px_rgb(0_0_0/0.08)] active:shadow-[inset_0_1px_2px_0_rgb(0_0_0/0.18)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.12),0_1px_2px_0_rgb(0_0_0/0.18)] hover:bg-destructive/92 hover:shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.16),0_2px_4px_-1px_rgb(0_0_0/0.22)]",
        // outline：背景半透明 + hairline 边框 + 极浅阴影，hover 时边框与背景同时加深
        outline:
          "border border-border/60 bg-background/60 backdrop-blur-[2px] text-foreground shadow-[0_1px_1px_0_rgb(0_0_0/0.04)] hover:bg-accent/60 hover:border-border hover:text-accent-foreground hover:shadow-[0_1px_2px_0_rgb(0_0_0/0.06)]",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.04),0_1px_1px_0_rgb(0_0_0/0.04)] hover:bg-secondary/80 hover:shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.06),0_1px_2px_0_rgb(0_0_0/0.06)]",
        // ghost：无阴影，hover 仅替换背景，避免和实体按钮抢戏
        ghost: "hover:bg-accent/70 hover:text-accent-foreground",
        // link：纯文字按钮，关闭 scale 反馈以免视觉错位
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-sm px-3 text-xs",
        lg: "h-10 rounded-lg px-8",
        icon: "h-9 w-9 focus-visible:ring-0",
        "icon-sm": "h-7 w-7 rounded-sm focus-visible:ring-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
