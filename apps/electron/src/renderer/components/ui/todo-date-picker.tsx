import * as React from 'react'
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock3, Moon, Sun, Sunrise } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function startOfDay(value: number): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function endOfTodoDay(value = Date.now()): number {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

/** 日期型 Todo 以当地当天结束时间存储；只有用户主动选时间时才显示时分。 */
export function isTodoDateOnly(value: number): boolean {
  const date = new Date(value)
  return date.getHours() === 23 && date.getMinutes() === 59
}

export function formatTodoDueDate(value?: number): string {
  if (!value) return '设置计划日期'
  const today = startOfDay(Date.now())
  const day = startOfDay(value)
  const prefix = day === today ? '今天' : day === addDays(today, 1) ? '明天' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(value)
  if (isTodoDateOnly(value)) return prefix
  return `${prefix} · ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value)}`
}

function addDays(value: number, amount: number): number {
  const date = new Date(value)
  date.setDate(date.getDate() + amount)
  return date.getTime()
}

function addMonths(value: number, amount: number): number {
  const date = new Date(value)
  date.setMonth(date.getMonth() + amount, 1)
  return date.getTime()
}

function nextMonday(value: number): number {
  const days = (8 - new Date(value).getDay()) % 7 || 7
  return addDays(startOfDay(value), days)
}

function setDate(value: number, day: number): number {
  const source = new Date(value)
  const target = new Date(day)
  target.setHours(source.getHours(), source.getMinutes(), 0, 0)
  return target.getTime()
}

function setTime(value: number, hours: number, minutes: number): number {
  const date = new Date(value)
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

function pad(value: number): string { return String(value).padStart(2, '0') }

export interface TodoDatePickerProps {
  value?: number
  onChange: (value?: number) => void
  label?: string
  className?: string
  disabled?: boolean
  /** 全天日程等仅允许选择日期的场景。 */
  dateOnly?: boolean
  /** 日程的开始/结束不可清除；Todo 默认允许清除日期。 */
  allowClear?: boolean
  /** 普通日程需始终保留精确时间。 */
  timeRequired?: boolean
}

/**
 * 面向 Todo 的滴答清单式日期优先选择器。
 * 默认只选择日期；用户主动进入“时间”页后才写入精确时分。
 */
export function TodoDatePicker({ value, onChange, label = '计划完成日期', className, disabled, dateOnly = false, allowClear = true, timeRequired = false }: TodoDatePickerProps): React.ReactElement {
  const effectiveValue = dateOnly && value !== undefined ? endOfTodoDay(value) : value
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<'date' | 'time'>('date')
  const [draft, setDraft] = React.useState<number | undefined>(effectiveValue ?? endOfTodoDay())
  const [month, setMonth] = React.useState(() => startOfDay(effectiveValue ?? Date.now()))
  const [hasTime, setHasTime] = React.useState(() => !dateOnly && (timeRequired || (effectiveValue !== undefined && !isTodoDateOnly(effectiveValue))))
  const [hourText, setHourText] = React.useState(() => pad(new Date(effectiveValue ?? endOfTodoDay()).getHours()))
  const [minuteText, setMinuteText] = React.useState(() => pad(new Date(effectiveValue ?? endOfTodoDay()).getMinutes()))

  React.useEffect(() => {
    if (!open) return
    const nextDraft = effectiveValue ?? endOfTodoDay()
    setDraft(nextDraft)
    setMonth(startOfDay(nextDraft))
    setHasTime(!dateOnly && (timeRequired || (effectiveValue !== undefined && !isTodoDateOnly(effectiveValue))))
    setHourText(pad(new Date(nextDraft).getHours()))
    setMinuteText(pad(new Date(nextDraft).getMinutes()))
    setTab('date')
  }, [dateOnly, effectiveValue, open, timeRequired])

  React.useEffect(() => {
    const current = new Date(draft ?? endOfTodoDay())
    setHourText(pad(current.getHours()))
    setMinuteText(pad(current.getMinutes()))
  }, [draft])

  const enableTime = (): void => {
    if (dateOnly) return
    setHasTime(true)
    setDraft((current) => {
      const next = current ?? endOfTodoDay()
      return isTodoDateOnly(next) ? setTime(next, 9, 0) : next
    })
    setTab('time')
  }

  const selectDate = (day: number): void => {
    setDraft((current) => dateOnly || !hasTime ? endOfTodoDay(day) : setDate(current ?? endOfTodoDay(), day))
  }

  const applyTime = (): void => {
    const hour = Number(hourText)
    const minute = Number(minuteText)
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      const current = new Date(draft ?? endOfTodoDay())
      setHourText(pad(current.getHours()))
      setMinuteText(pad(current.getMinutes()))
      return
    }
    setHasTime(true)
    setDraft((current) => setTime(current ?? endOfTodoDay(), hour, minute))
  }

  const currentMonth = new Date(month)
  const firstOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getTime()
  const firstWeekday = (new Date(firstOfMonth).getDay() + 6) % 7
  const gridStart = addDays(firstOfMonth, -firstWeekday)
  const gridDays = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
  const selectedDay = draft === undefined ? undefined : startOfDay(draft)
  const today = startOfDay(Date.now())
  const quickDays = [
    { label: '今天', icon: Sun, value: today },
    { label: '明天', icon: Sunrise, value: addDays(today, 1) },
    { label: '下周一', icon: CalendarPlus, value: nextMonday(today) },
  ]
  const timeChoices = [9, 12, 14, 18]
  const draftDate = new Date(draft ?? endOfTodoDay())

  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" disabled={disabled} className={cn('h-9 min-w-0 justify-start gap-1.5 rounded-none px-2 text-sm font-medium text-primary shadow-none hover:bg-primary/8', className)} aria-label={label}><CalendarDays size={18} /><span className="max-w-44 truncate">{formatTodoDueDate(effectiveValue)}</span></Button></PopoverTrigger><PopoverContent align="start" className="w-[320px] max-w-[calc(100vw-2rem)] rounded-none border-border/60 p-0 shadow-xl" onOpenAutoFocus={(event) => event.preventDefault()}><div className="p-2">{dateOnly ? <div className="flex h-8 items-center justify-center bg-muted/60 text-xs font-medium">日期</div> : <div className="grid grid-cols-2 bg-muted/60 p-0.5"><button type="button" onClick={() => setTab('date')} className={cn('h-8 text-xs font-medium transition-colors', tab === 'date' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>日期</button><button type="button" onClick={enableTime} className={cn('h-8 text-xs font-medium transition-colors', tab === 'time' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>时间</button></div>}{tab === 'date' ? <><div className={cn('mt-2 grid gap-0.5', allowClear ? 'grid-cols-4' : 'grid-cols-3')}>{quickDays.map(({ label: quickLabel, icon: Icon, value: quickValue }) => <button key={quickLabel} type="button" onClick={() => selectDate(quickValue)} className={cn('flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors hover:bg-muted active:scale-[0.96]', selectedDay === startOfDay(quickValue) && 'bg-primary/8 text-primary')}><Icon className="size-4" /><span>{quickLabel}</span></button>)}{allowClear && <button type="button" onClick={() => { setDraft(undefined); setHasTime(false) }} className="flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted active:scale-[0.96]"><Moon className="size-4" /><span>无日期</span></button>}</div><div className="mt-2 flex items-center justify-between"><p className="text-base font-semibold tabular-nums">{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(firstOfMonth)}</p><div className="flex items-center"><Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setMonth(addMonths(firstOfMonth, -1))} aria-label="上个月"><ChevronLeft size={17} /></Button><Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setMonth(startOfDay(Date.now()))} aria-label="本月"><span className="size-2 rounded-full bg-current" /></Button><Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setMonth(addMonths(firstOfMonth, 1))} aria-label="下个月"><ChevronRight size={17} /></Button></div></div><div className="mt-1 grid grid-cols-7 text-center text-[11px] text-muted-foreground">{['一', '二', '三', '四', '五', '六', '日'].map((weekday) => <span key={weekday} className="py-1">{weekday}</span>)}</div><div className="grid grid-cols-7 gap-y-1">{gridDays.map((day) => { const date = new Date(day); const inMonth = date.getMonth() === currentMonth.getMonth(); const selected = selectedDay === startOfDay(day); return <button key={day} type="button" onClick={() => selectDate(day)} className={cn('mx-auto flex size-8 items-center justify-center text-xs tabular-nums transition-colors hover:bg-muted active:scale-[0.96]', !inMonth && 'text-muted-foreground/45', selected && 'rounded-full bg-primary text-primary-foreground hover:bg-primary', !selected && startOfDay(day) === today && 'rounded-full font-semibold text-primary')}>{date.getDate()}</button> })}</div>{!dateOnly && <button type="button" onClick={enableTime} className="mt-2 flex h-9 w-full items-center gap-2 border-t border-border/60 pt-2 text-left text-xs hover:text-primary"><Clock3 className="size-4 text-muted-foreground" /><span className="font-medium">时间</span><span className="ml-auto text-muted-foreground">{hasTime ? `${pad(draftDate.getHours())}:${pad(draftDate.getMinutes())}` : '不设置'}</span><ChevronRight className="size-4 text-muted-foreground" /></button>}</> : <div className="py-2"><p className="text-sm font-medium">选择时间</p><p className="mt-0.5 text-[11px] text-muted-foreground">{timeRequired ? '选择日程的具体时分。' : '时间可选；不设置时按当天处理。'}</p><div className="mt-3 grid grid-cols-2 gap-1.5">{timeChoices.map((hour) => <Button key={hour} type="button" variant={draftDate.getHours() === hour && draftDate.getMinutes() === 0 ? 'secondary' : 'outline'} onClick={() => { setHasTime(true); setDraft((current) => setTime(current ?? endOfTodoDay(), hour, 0)) }} className="h-9 rounded-none text-xs tabular-nums">{pad(hour)}:00</Button>)}</div><div className="mt-3 border-t border-border/60 pt-3"><p className="mb-2 text-xs font-medium text-muted-foreground">自定义时间</p><div className="flex items-center gap-2"><Input value={hourText} inputMode="numeric" onChange={(event) => setHourText(event.target.value.replace(/\D/g, '').slice(0, 2))} onBlur={applyTime} onKeyDown={(event) => { if (event.key === 'Enter') applyTime() }} className="h-9 w-14 rounded-none px-1 text-center text-xs tabular-nums" aria-label="小时" /><span className="font-medium text-muted-foreground">:</span><Input value={minuteText} inputMode="numeric" onChange={(event) => setMinuteText(event.target.value.replace(/\D/g, '').slice(0, 2))} onBlur={applyTime} onKeyDown={(event) => { if (event.key === 'Enter') applyTime() }} className="h-9 w-14 rounded-none px-1 text-center text-xs tabular-nums" aria-label="分钟" />{!timeRequired && <Button type="button" variant="ghost" onClick={() => { setHasTime(false); setDraft((current) => endOfTodoDay(current)) }} className="ml-auto h-9 rounded-none px-2 text-[11px] text-muted-foreground">不设置</Button>}</div></div></div>}<div className="mt-2 flex gap-2 border-t border-border/60 pt-2">{allowClear && <Button type="button" variant="outline" onClick={() => { onChange(undefined); setOpen(false) }} className="h-9 flex-1 rounded-none text-xs">清除</Button>}<Button type="button" onClick={() => { onChange(draft); setOpen(false) }} className="h-9 flex-1 rounded-none text-xs"><Check size={14} />确定</Button></div></div></PopoverContent></Popover>
}
