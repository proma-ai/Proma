import * as React from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const DAY_MS = 86_400_000
const QUICK_TIMES = [9, 10, 14, 16, 18]

function dayStart(value: number): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
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
  const current = new Date(value)
  const daysUntilMonday = (8 - current.getDay()) % 7 || 7
  return addDays(dayStart(current.getTime()), daysUntilMonday)
}

function mergeDate(current: number, targetDay: number): number {
  const base = new Date(current)
  const target = new Date(targetDay)
  target.setHours(base.getHours(), base.getMinutes(), 0, 0)
  return target.getTime()
}

function mergeTime(current: number, hour: number, minute: number): number {
  const date = new Date(current)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

function formatLabel(value: number, allDay: boolean): string {
  const date = new Date(value)
  const day = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(date)
  if (allDay) return day
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  return `${day} · ${time}`
}

function pad(value: number): string { return String(value).padStart(2, '0') }

export interface DateTimePickerProps {
  value: number
  onChange: (value: number) => void
  allDay?: boolean
  label?: string
  className?: string
  disabled?: boolean
}

/**
 * 本地日期时间选择器：月历、常用日期/时间和键盘精确输入组合。
 * 不解析自然语言，所有值都由用户显式确认，适用于 Todo 与日程字段。
 */
export function DateTimePicker({ value, onChange, allDay = false, label = '选择日期时间', className, disabled }: DateTimePickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState(() => dayStart(value))
  const [hourText, setHourText] = React.useState(() => pad(new Date(value).getHours()))
  const [minuteText, setMinuteText] = React.useState(() => pad(new Date(value).getMinutes()))

  React.useEffect(() => {
    const date = new Date(value)
    setHourText(pad(date.getHours()))
    setMinuteText(pad(date.getMinutes()))
  }, [value])

  React.useEffect(() => {
    if (open) setMonth(dayStart(value))
  }, [open, value])

  const selectDay = (day: number): void => onChange(allDay ? dayStart(day) : mergeDate(value, day))
  const applyTime = (): void => {
    const hour = Number(hourText)
    const minute = Number(minuteText)
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      setHourText(pad(new Date(value).getHours()))
      setMinuteText(pad(new Date(value).getMinutes()))
      return
    }
    onChange(mergeTime(value, hour, minute))
  }

  const monthDate = new Date(month)
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getTime()
  const firstWeekday = new Date(firstOfMonth).getDay()
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => index - firstWeekday + 1)
  const selectedDay = dayStart(value)
  const today = dayStart(Date.now())
  const quickDays = [
    { label: '今天', value: today },
    { label: '明天', value: addDays(today, 1) },
    { label: '下周一', value: nextMonday(today) },
  ]

  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled} className={cn('h-10 w-full justify-start rounded-none border-border/60 bg-transparent px-3 text-left font-normal shadow-none hover:bg-muted/40', className)} aria-label={label}><CalendarDays className="mr-2 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{formatLabel(value, allDay)}</span></Button></PopoverTrigger><PopoverContent align="start" className="w-[440px] rounded-none border-border/60 p-0 shadow-xl" onOpenAutoFocus={(event) => event.preventDefault()}><div className="grid sm:grid-cols-[1fr_172px]"><div className="border-b border-border/60 p-3 sm:border-b-0 sm:border-r"><div className="mb-3 flex items-center justify-between"><Button type="button" variant="ghost" size="icon" className="size-10" onClick={() => setMonth(addMonths(firstOfMonth, -1))} aria-label="上个月"><ChevronLeft size={16} /></Button><p className="text-sm font-medium tabular-nums">{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(firstOfMonth)}</p><Button type="button" variant="ghost" size="icon" className="size-10" onClick={() => setMonth(addMonths(firstOfMonth, 1))} aria-label="下个月"><ChevronRight size={16} /></Button></div><div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">{['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day} className="py-1.5">{day}</span>)}</div><div className="grid grid-cols-7 gap-y-0.5">{cells.map((day, index) => { const valid = day > 0 && day <= daysInMonth; const timestamp = new Date(monthDate.getFullYear(), monthDate.getMonth(), day).getTime(); return <button key={index} type="button" disabled={!valid} onClick={() => selectDay(timestamp)} className={cn('mx-auto flex size-8 items-center justify-center text-xs tabular-nums transition-colors', valid ? 'hover:bg-muted active:scale-[0.96]' : 'pointer-events-none', valid && dayStart(timestamp) === selectedDay && 'bg-primary font-medium text-primary-foreground hover:bg-primary', valid && dayStart(timestamp) === today && dayStart(timestamp) !== selectedDay && 'font-semibold text-primary')}>{valid ? day : ''}</button> })}</div></div><div className="space-y-4 p-3"><div><p className="mb-2 text-xs font-medium text-muted-foreground">快捷日期</p><div className="grid gap-1">{quickDays.map((item) => <Button key={item.label} type="button" variant="ghost" size="sm" onClick={() => selectDay(item.value)} className="h-9 justify-start px-2 text-xs">{item.label}<span className="ml-auto text-muted-foreground">{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(item.value)}</span></Button>)}</div></div>{!allDay && <><div><p className="mb-2 text-xs font-medium text-muted-foreground">常用时间</p><div className="grid grid-cols-2 gap-1">{QUICK_TIMES.map((hour) => <Button key={hour} type="button" variant={new Date(value).getHours() === hour && new Date(value).getMinutes() === 0 ? 'secondary' : 'ghost'} size="sm" onClick={() => onChange(mergeTime(value, hour, 0))} className="h-9 text-xs">{pad(hour)}:00</Button>)}</div></div><div><p className="mb-2 text-xs font-medium text-muted-foreground">精确时间</p><div className="flex items-center gap-1"><Clock3 className="size-4 text-muted-foreground" /><Input inputMode="numeric" value={hourText} onChange={(event) => setHourText(event.target.value.replace(/\D/g, '').slice(0, 2))} onKeyDown={(event) => { if (event.key === 'Enter') { applyTime(); setOpen(false) } }} onBlur={applyTime} className="h-9 w-12 px-2 text-center tabular-nums" aria-label="小时" /><span className="font-medium text-muted-foreground">:</span><Input inputMode="numeric" value={minuteText} onChange={(event) => setMinuteText(event.target.value.replace(/\D/g, '').slice(0, 2))} onKeyDown={(event) => { if (event.key === 'Enter') { applyTime(); setOpen(false) } }} onBlur={applyTime} className="h-9 w-12 px-2 text-center tabular-nums" aria-label="分钟" /></div></div></>}<Button type="button" size="sm" onClick={() => setOpen(false)} className="h-10 w-full"><Check size={14} />完成</Button></div></div></PopoverContent></Popover>
}
