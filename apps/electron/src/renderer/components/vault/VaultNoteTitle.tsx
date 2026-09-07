import * as React from 'react'

interface VaultNoteTitleProps {
  title: string
  onCommit: (name: string, shouldFocusBody?: () => boolean) => Promise<boolean>
}

/** 标题提交只有一个入口；Enter 与随后的 blur 不会重复重命名。 */
export function VaultNoteTitle({ title, onCommit }: VaultNoteTitleProps): React.ReactElement {
  const [value, setValue] = React.useState(title)
  const [pending, setPending] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const submittingRef = React.useRef(false)
  const skipBlurRef = React.useRef(false)
  const committedNameRef = React.useRef(title)
  React.useEffect(() => {
    setValue(title)
    committedNameRef.current = title
  }, [title])

  const commit = async (enter: boolean): Promise<void> => {
    if (submittingRef.current) return
    const name = value.trim() || title
    setValue(name)
    if (!enter && name === committedNameRef.current) return
    submittingRef.current = true
    setPending(true)
    try {
      const ok = await onCommit(name, enter ? () => inputRef.current !== null && document.activeElement === inputRef.current : undefined)
      if (ok) committedNameRef.current = name
    } finally {
      submittingRef.current = false
      if (inputRef.current) setPending(false)
    }
  }

  return (
    <input
      ref={inputRef}
      aria-label="重命名笔记"
      aria-busy={pending}
      value={value}
      readOnly={pending}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (skipBlurRef.current) { skipBlurRef.current = false; return }
        void commit(false)
      }}
      onKeyDown={(event) => {
        // keyCode 229 兼容部分平台在 compositionend 前后发送的确认键。
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          if (!event.repeat) void commit(true)
        } else if (event.key === 'Escape' && !submittingRef.current) {
          event.preventDefault()
          event.stopPropagation()
          skipBlurRef.current = true
          setValue(title)
          event.currentTarget.blur()
        }
      }}
      className="h-9 min-w-0 flex-1 bg-transparent px-0 text-2xl font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground/50"
    />
  )
}
