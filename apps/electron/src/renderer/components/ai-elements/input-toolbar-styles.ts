/** 输入工具栏控件统一高度：与发送按钮的 32px hover 背景对齐。 */
export const inputToolbarControlHeightClass = 'h-8'

const inputToolbarSquareControlClass = `${inputToolbarControlHeightClass} w-8`

export const inputToolbarButtonClass =
  `${inputToolbarSquareControlClass} shrink-0 rounded-md text-foreground/60 hover:text-foreground hover:bg-muted/50 data-[state=open]:bg-muted/50 data-[state=open]:text-foreground`

export const inputToolbarActiveButtonClass =
  '!bg-transparent text-primary shadow-none hover:!bg-transparent hover:text-primary data-[state=open]:!bg-transparent [&_svg]:stroke-[2.75]'

export const inputToolbarDangerButtonClass =
  `${inputToolbarSquareControlClass} shrink-0 rounded-md text-destructive hover:!text-[hsl(0,75%,55%)] hover:!bg-[var(--stop-hover-bg)]`

export const inputToolbarSendButtonClass =
  `${inputToolbarSquareControlClass} shrink-0 rounded-md text-primary hover:bg-primary/10`

export const inputToolbarDisabledButtonClass =
  `${inputToolbarSquareControlClass} shrink-0 rounded-md text-foreground/30 cursor-not-allowed`
