/**
 * ShortcutSettings — 快捷键设置面板
 *
 * 分组展示所有快捷键，支持：
 * - 查看当前快捷键绑定
 * - 点击录制自定义快捷键
 * - 冲突检测和提示
 * - 恢复默认值
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { shortcutOverridesAtom, sendWithCmdEnterAtom } from '@/atoms/shortcut-atoms'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_CATEGORY_LABELS,
} from '@/lib/shortcut-defaults'
import type { ShortcutCategory, ShortcutOverrides } from '@/lib/shortcut-defaults'
import {
  getActiveAccelerator,
  getAcceleratorDisplay,
  checkConflict,
  updateShortcutOverrides,
  isMac,
} from '@/lib/shortcut-registry'

// ===== 快捷键录制组件 =====

interface ShortcutRecorderProps {
  /** 快捷键 ID */
  shortcutId: string
  /** 当前显示的 accelerator（null 表示已被用户禁用） */
  currentAccelerator: string | null
  /** 保存录制结果 */
  onSave: (shortcutId: string, accelerator: string) => Promise<boolean>
  /** 录制/pending 状态变化时通知父组件，便于父组件隐藏并列操作按钮 */
  onActiveChange?: (active: boolean) => void
}

function ShortcutRecorder({
  shortcutId,
  currentAccelerator,
  onSave,
  onActiveChange,
}: ShortcutRecorderProps): React.ReactElement {
  const [recording, setRecording] = React.useState(false)
  const [pendingKeys, setPendingKeys] = React.useState('')
  const [conflict, setConflict] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const pendingKeysRef = React.useRef('')

  const setPendingAccelerator = React.useCallback((accelerator: string) => {
    pendingKeysRef.current = accelerator
    setPendingKeys(accelerator)
  }, [])

  const handleStartRecording = React.useCallback(() => {
    setRecording(true)
    setPendingAccelerator('')
    setConflict(null)
  }, [setPendingAccelerator])

  const handleCancel = React.useCallback(() => {
    setRecording(false)
    setPendingAccelerator('')
    setConflict(null)
    setSaving(false)
  }, [setPendingAccelerator])

  const normalizeKey = React.useCallback((rawKey: string): string => {
    if (rawKey === ' ') return 'Space'
    if (rawKey === '+') return 'Plus'
    if (rawKey.length === 1) return rawKey.toUpperCase()

    const keyMap: Record<string, string> = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Escape: 'Esc',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Enter: 'Enter',
      Tab: 'Tab',
    }
    return keyMap[rawKey] ?? rawKey
  }, [])

  const isStandaloneKeyAllowed = React.useCallback((key: string): boolean => {
    return /^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(key)
  }, [])

  const finishCapture = React.useCallback((accelerator: string) => {
    if (!accelerator) return

    const conflictId = checkConflict(accelerator, shortcutId)
    if (conflictId) {
      const conflictDef = DEFAULT_SHORTCUTS.find((s) => s.id === conflictId)
      setConflict(conflictDef?.name ?? conflictId)
      setPendingAccelerator(accelerator)
      setRecording(false)
      return
    }

    setPendingAccelerator(accelerator)
    setConflict(null)
    setRecording(false)
  }, [shortcutId, setPendingAccelerator])

  // 录制模式下的按键捕获
  React.useEffect(() => {
    if (!recording) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      // 构建 accelerator 字符串
      const parts: string[] = []
      if (e.metaKey && isMac) parts.push('Cmd')
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')

      // 单独按修饰键时先显示已捕获的修饰键，等待用户继续按普通键。
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) {
        setPendingAccelerator(parts.join('+'))
        return
      }

      // 标准化按键名称
      const key = normalizeKey(e.key)

      // 普通字母/数字/符号需要修饰键；F1-F24 允许作为独立快捷键。
      if (parts.length === 0 && !isStandaloneKeyAllowed(key)) {
        setPendingAccelerator('')
        return
      }

      parts.push(key)
      const accelerator = parts.join('+')
      finishCapture(accelerator)
    }

    // Escape 取消录制
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    }

    const handleKeyUp = (e: KeyboardEvent): void => {
      if (!pendingKeysRef.current) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      e.preventDefault()
      e.stopPropagation()
      finishCapture(pendingKeysRef.current)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keydown', handleEsc, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keydown', handleEsc, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [
    recording,
    handleCancel,
    normalizeKey,
    isStandaloneKeyAllowed,
    setPendingAccelerator,
    finishCapture,
  ])

  const canSave = !!pendingKeys && !recording && !conflict && !saving

  // 同步录制/pending 状态给父组件，避免父组件在录制期间渲染会改写 override 的按钮
  React.useEffect(() => {
    onActiveChange?.(recording || !!pendingKeys)
  }, [recording, pendingKeys, onActiveChange])

  const handleSave = React.useCallback(async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const saved = await onSave(shortcutId, pendingKeys)
      if (saved) {
        handleCancel()
      }
    } finally {
      setSaving(false)
    }
  }, [canSave, handleCancel, onSave, pendingKeys, shortcutId])

  if (recording || pendingKeys) {
    return (
      <div className="flex items-center gap-2">
        {conflict ? (
          <span className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive border border-destructive/20">
            {getAcceleratorDisplay(pendingKeys)} 与「{conflict}」冲突
          </span>
        ) : (
          <span className={`text-xs px-2 py-1 rounded border ${
            recording
              ? 'bg-primary/10 text-primary border-primary/20 animate-pulse'
              : 'bg-muted text-foreground/80 border-border'
          }`}>
            {recording
              ? pendingKeys
                ? `${getAcceleratorDisplay(pendingKeys)} + ...`
                : '请按下快捷键...'
              : getAcceleratorDisplay(pendingKeys)}
          </span>
        )}
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleCancel}>
          取消
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          disabled={!canSave}
          onClick={handleSave}
        >
          {saving ? '保存中' : '保存'}
        </Button>
      </div>
    )
  }

  if (currentAccelerator === null) {
    return (
      <button
        type="button"
        className="text-xs px-2.5 py-1 rounded-md bg-muted/40 text-muted-foreground/70 italic transition-colors hover:bg-muted hover:text-foreground/80"
        onClick={handleStartRecording}
        title="点击录制新快捷键"
      >
        已禁用
      </button>
    )
  }

  return (
    <button
      type="button"
      className="text-xs px-2.5 py-1 rounded-md bg-muted hover:bg-muted/80 text-foreground/80 font-mono transition-colors"
      onClick={handleStartRecording}
      title="点击自定义快捷键"
    >
      {getAcceleratorDisplay(currentAccelerator)}
    </button>
  )
}

// ===== 主组件 =====

export function ShortcutSettings(): React.ReactElement {
  const [overrides, setOverrides] = useAtom(shortcutOverridesAtom)
  const [sendWithCmdEnter, setSendWithCmdEnter] = useAtom(sendWithCmdEnterAtom)
  // 当前正在录制的快捷键 id，用于隐藏并列操作按钮，避免与录制中途的 state 冲突
  const [recordingId, setRecordingId] = React.useState<string | null>(null)

  const handleRecordingChange = React.useCallback(
    (shortcutId: string, active: boolean) => {
      setRecordingId((prev) => {
        if (active) return shortcutId
        return prev === shortcutId ? null : prev
      })
    },
    [],
  )

  // 按分类分组
  const grouped = React.useMemo(() => {
    const groups = new Map<ShortcutCategory, typeof DEFAULT_SHORTCUTS>()
    for (const def of DEFAULT_SHORTCUTS) {
      const list = groups.get(def.category) ?? []
      list.push(def)
      groups.set(def.category, list)
    }
    return groups
  }, [])

  const reregisterGlobalShortcut = React.useCallback(
    async (shortcutId: string): Promise<boolean> => {
      const def = DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)
      if (!def?.global) return true

      const results = await window.electronAPI.reregisterGlobalShortcuts()
      return results[shortcutId] !== false
    },
    [],
  )

  // 保存录制结果：持久化后更新 App 内快捷键缓存；全局快捷键额外重新注册。
  const handleSaveShortcut = React.useCallback(
    async (shortcutId: string, accelerator: string): Promise<boolean> => {
      const key = isMac ? 'mac' : 'win'
      const newOverrides: ShortcutOverrides = {
        ...overrides,
        [shortcutId]: {
          ...overrides[shortcutId],
          [key]: accelerator,
        },
      }

      try {
        await window.electronAPI.updateSettings({ shortcutOverrides: newOverrides })
        setOverrides(newOverrides)
        // App 内快捷键通过重建 shortcut-registry 缓存立即生效；handler 不需要重挂。
        updateShortcutOverrides(newOverrides)

        const def = DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)
        if (def?.global) {
          try {
            const registered = await reregisterGlobalShortcut(shortcutId)
            if (!registered) {
              toast.warning('快捷键已保存，但全局快捷键当前未注册', {
                id: 'shortcut-save-warning',
                description: '可能是功能未启用，或该组合已被系统/其他应用占用。',
              })
              return true
            }
          } catch (error) {
            console.error(error)
            toast.warning('快捷键已保存，但全局快捷键当前未注册', {
              id: 'shortcut-save-warning',
              description: '重新注册全局快捷键时出错，请重试或换一个组合。',
            })
            return true
          }
        }

        toast.success('快捷键已保存', { id: 'shortcut-save-success' })
        return true
      } catch (error) {
        console.error(error)
        toast.error('快捷键保存失败', { id: 'shortcut-save-error' })
        return false
      }
    },
    [overrides, reregisterGlobalShortcut, setOverrides],
  )

  // 恢复单个快捷键默认值
  const handleReset = React.useCallback(
    async (shortcutId: string) => {
      const newOverrides = { ...overrides }
      delete newOverrides[shortcutId]

      try {
        await window.electronAPI.updateSettings({ shortcutOverrides: newOverrides })
        setOverrides(newOverrides)
        updateShortcutOverrides(newOverrides)

        const def = DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)
        if (def?.global) {
          try {
            const registered = await reregisterGlobalShortcut(shortcutId)
            if (!registered) {
              toast.warning('已恢复默认，但全局快捷键当前未注册', {
                id: 'shortcut-save-warning',
                description: '可能是功能未启用，或默认组合已被系统/其他应用占用。',
              })
              return
            }
          } catch (error) {
            console.error(error)
            toast.warning('已恢复默认，但全局快捷键重新注册失败', {
              id: 'shortcut-save-warning',
            })
            return
          }
        }

        toast.success('已恢复默认快捷键', { id: 'shortcut-save-success' })
      } catch (error) {
        console.error(error)
        toast.error('恢复默认快捷键失败', { id: 'shortcut-save-error' })
      }
    },
    [overrides, reregisterGlobalShortcut, setOverrides],
  )

  // 禁用单个快捷键：将当前平台 override 置为 null
  const handleDisable = React.useCallback(
    async (shortcutId: string) => {
      const key = isMac ? 'mac' : 'win'
      const newOverrides: ShortcutOverrides = {
        ...overrides,
        [shortcutId]: {
          ...overrides[shortcutId],
          [key]: null,
        },
      }

      try {
        await window.electronAPI.updateSettings({ shortcutOverrides: newOverrides })
        setOverrides(newOverrides)
        updateShortcutOverrides(newOverrides)

        const def = DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)
        if (def?.global) {
          try {
            // 禁用语义下主进程会跳过 register，对应 reregisterGlobalShortcut 返回 false，
            // 这是期望结果，因此这里不像 handleSaveShortcut 那样把 false 当 warning。
            await reregisterGlobalShortcut(shortcutId)
          } catch (error) {
            console.error(error)
            toast.warning('快捷键已禁用，但主进程重新注册时出错', {
              id: 'shortcut-save-warning',
            })
            return
          }
        }

        toast.success('快捷键已禁用', { id: 'shortcut-save-success' })
      } catch (error) {
        console.error(error)
        toast.error('禁用快捷键失败', { id: 'shortcut-save-error' })
      }
    },
    [overrides, reregisterGlobalShortcut, setOverrides],
  )

  // 恢复所有默认值（同时会清除所有"已禁用"标记）
  const handleResetAll = React.useCallback(async () => {
    const hadDisabled = Object.values(overrides).some(
      (o) => o?.mac === null || o?.win === null,
    )
    try {
      await window.electronAPI.updateSettings({ shortcutOverrides: {} })
      setOverrides({})
      updateShortcutOverrides({})

      try {
        const results = await window.electronAPI.reregisterGlobalShortcuts()
        const hasUnregisteredGlobal = Object.values(results).some((registered) => !registered)
        if (hasUnregisteredGlobal) {
          toast.warning('已恢复全部默认；部分全局快捷键当前未注册', {
            id: 'shortcut-save-warning',
            description: '可能是对应功能未启用，或默认组合已被系统/其他应用占用。',
          })
          return
        }
      } catch (error) {
        console.error(error)
        toast.warning('已恢复全部默认，但全局快捷键重新注册失败', {
          id: 'shortcut-save-warning',
        })
        return
      }

      toast.success('已恢复全部默认快捷键', {
        id: 'shortcut-save-success',
        description: hadDisabled ? '已禁用的快捷键也已重新启用' : undefined,
      })
    } catch (error) {
      console.error(error)
      toast.error('恢复全部默认快捷键失败', { id: 'shortcut-save-error' })
    }
  }, [overrides, setOverrides])

  const hasOverrides = Object.keys(overrides).length > 0

  // 切换发送快捷键
  const handleToggleSendKey = React.useCallback(() => {
    const newValue = !sendWithCmdEnter
    setSendWithCmdEnter(newValue)
    window.electronAPI
      .updateSettings({ sendWithCmdEnter: newValue })
      .then(() => {
        toast.success('发送快捷键已保存', { id: 'shortcut-save-success' })
      })
      .catch((error) => {
        setSendWithCmdEnter(sendWithCmdEnter)
        console.error(error)
        toast.error('发送快捷键保存失败', { id: 'shortcut-save-error' })
      })
  }, [sendWithCmdEnter, setSendWithCmdEnter])

  // 分类顺序
  const categoryOrder: ShortcutCategory[] = ['app', 'navigation', 'edit', 'global']

  return (
    <div className="space-y-6">
      {/* 描述 + 恢复全部按钮 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          点击快捷键可自定义，录制后点击保存生效，按 Esc 取消录制
        </p>
        {hasOverrides && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={handleResetAll}
          >
            <RotateCcw size={12} className="mr-1" />
            恢复全部默认
          </Button>
        )}
      </div>

      {/* 发送消息快捷键切换 */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          发送消息
        </h3>
        <div className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">发送 / 换行快捷键</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              切换 Enter 发送消息或换行的行为
            </div>
          </div>
          <div className="flex items-center gap-1 ml-4 rounded-lg bg-muted/60 p-0.5">
            <button
              type="button"
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                !sendWithCmdEnter
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => sendWithCmdEnter && handleToggleSendKey()}
            >
              Enter 发送
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                sendWithCmdEnter
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => !sendWithCmdEnter && handleToggleSendKey()}
            >
              {isMac ? '⌘' : 'Ctrl'}+Enter 发送
            </button>
          </div>
        </div>
      </div>

      {/* 按分类分组展示 */}
      {categoryOrder.map((category) => {
        const shortcuts = grouped.get(category)
        if (!shortcuts) return null

        return (
          <div key={category}>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {SHORTCUT_CATEGORY_LABELS[category]}
            </h3>
            {category === 'global' && (
              <p className="text-xs text-muted-foreground/70 mb-2">
                全局快捷键在应用未聚焦时也能触发，可能与系统或其他应用冲突
              </p>
            )}
            <div className="space-y-1">
              {shortcuts.filter((def) => !def.readonly || (isMac ? def.defaultMac : def.defaultWin)).map((def) => {
                const currentAccel = getActiveAccelerator(def.id)
                const platformOverride = overrides[def.id]?.[isMac ? 'mac' : 'win']
                const isDisabled = platformOverride === null
                const isCustomized = !isDisabled && !!platformOverride

                return (
                  <div
                    key={def.id}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">
                        {def.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {def.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {def.readonly ? (
                        <span className="text-xs px-2.5 py-1 rounded-md bg-muted text-foreground/60 font-mono">
                          {getAcceleratorDisplay(isMac ? def.defaultMac : def.defaultWin)}
                        </span>
                      ) : (
                        <>
                          <ShortcutRecorder
                            shortcutId={def.id}
                            currentAccelerator={currentAccel}
                            onSave={handleSaveShortcut}
                            onActiveChange={(active) => handleRecordingChange(def.id, active)}
                          />
                          {recordingId !== def.id && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <Switch
                                    checked={!isDisabled}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        handleReset(def.id)
                                      } else {
                                        handleDisable(def.id)
                                      }
                                    }}
                                    aria-label={isDisabled ? '启用此快捷键' : '禁用此快捷键'}
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {isDisabled
                                  ? '已禁用 — 打开以恢复默认快捷键'
                                  : '关闭以禁用此快捷键，避免与其他应用冲突'}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {isCustomized && recordingId !== def.id && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
                                  onClick={() => handleReset(def.id)}
                                >
                                  <RotateCcw size={12} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">恢复默认快捷键</TooltipContent>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
