export const menuSurfaceClassName =
  "z-50 min-w-[8rem] overflow-hidden rounded-lg border border-border/50 bg-popover p-1 text-popover-foreground shadow-lg"

export const menuAnimationClassName =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"

export const menuItemClassName =
  "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors duration-100 focus:bg-accent/70 focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:pointer-events-none [&>svg]:size-4 [&>svg]:shrink-0"

export const menuSubTriggerClassName =
  "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors duration-100 focus:bg-accent/70 focus:text-accent-foreground data-[state=open]:bg-accent/70 data-[state=open]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"

export const menuSeparatorClassName = "-mx-1 my-1 h-px bg-muted"
