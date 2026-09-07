import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface PasswordInputProps extends Omit<React.ComponentProps<typeof Input>, 'type'> {}

/** 带密码显隐切换的认证输入框。 */
export function PasswordInput({ className, disabled, ...props }: PasswordInputProps): React.ReactElement {
  const [visible, setVisible] = React.useState(false)
  const actionLabel = visible ? '隐藏密码' : '显示密码'

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className={['pr-11', className].filter(Boolean).join(' ')}
      />
      <button
        type="button"
        aria-label={actionLabel}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible((currentVisible) => !currentVisible)}
        className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )
}
