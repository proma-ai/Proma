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
import { Button } from '@/components/ui/button'
import { shortcutOverridesAtom } from '@/atoms/shortcut-atoms'
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
  /** 当前显示的 accelerator */
  currentAccelerator: string
  /** 录制完成回调 */
  onRecord: (shortcutId: string, accelerator: string) => void
}

function ShortcutRecorder({
  shortcutId,
  currentAccelerator,
  onRecord,
}: ShortcutRecorderProps): React.ReactElement {
  const [recording, setRecording] = React.useState(false)
  const [pendingKeys, setPendingKeys] = React.useState('')
  const [conflict, setConflict] = React.useState<string | null>(null)

  const handleStartRecording = React.useCallback(() => {
    setRecording(true)
    setPendingKeys('')
    setConflict(null)
  }, [])

  const handleCancel = React.useCallback(() => {
    setRecording(false)
    setPendingKeys('')
    setConflict(null)
  }, [])

  // 录制模式下的按键捕获
  React.useEffect(() => {
    if (!recording) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      // 忽略单独的修饰键
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return

      // 构建 accelerator 字符串
      const parts: string[] = []
      if (e.metaKey && isMac) parts.push('Cmd')
      if (e.ctrlKey && !isMac) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')

      // 至少需要一个修饰键
      if (parts.length === 0) return

      // 标准化按键名称
      let key = e.key
      if (key === ' ') key = 'Space'
      if (key.length === 1) key = key.toUpperCase()
      // 特殊键映射
      const keyMap: Record<string, string> = {
        ArrowUp: 'Up', ArrowDown: 'Down',
        ArrowLeft: 'Left', ArrowRight: 'Right',
        Escape: 'Esc', Backspace: 'Backspace',
        Delete: 'Delete', Enter: 'Enter', Tab: 'Tab',
      }
      const mapped = keyMap[key]
      if (mapped) key = mapped

      parts.push(key)
      const accelerator = parts.join('+')

      // 冲突检测
      const conflictId = checkConflict(accelerator, shortcutId)
      if (conflictId) {
        const conflictDef = DEFAULT_SHORTCUTS.find((s) => s.id === conflictId)
        setConflict(conflictDef?.name ?? conflictId)
        setPendingKeys(accelerator)
        return
      }

      // 无冲突，直接应用
      setPendingKeys('')
      setConflict(null)
      setRecording(false)
      onRecord(shortcutId, accelerator)
    }

    // Escape 取消录制
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keydown', handleEsc, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keydown', handleEsc, true)
    }
  }, [recording, shortcutId, onRecord, handleCancel])

  if (recording) {
    return (
      <div className="flex items-center gap-2">
        {conflict ? (
          <>
            <span className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive border border-destructive/20">
              {getAcceleratorDisplay(pendingKeys)} 与「{conflict}」冲突
            </span>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleCancel}>
              取消
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-destructive"
              onClick={() => {
                setRecording(false)
                setConflict(null)
                onRecord(shortcutId, pendingKeys)
              }}
            >
              覆盖
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 animate-pulse">
              请按下快捷键...
            </span>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleCancel}>
              取消
            </Button>
          </>
        )}
      </div>
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

  // 录制回调：更新 overrides 并持久化
  const handleRecord = React.useCallback(
    (shortcutId: string, accelerator: string) => {
      const key = isMac ? 'mac' : 'win'
      const newOverrides: ShortcutOverrides = {
        ...overrides,
        [shortcutId]: {
          ...overrides[shortcutId],
          [key]: accelerator,
        },
      }
      setOverrides(newOverrides)
      updateShortcutOverrides(newOverrides)

      // 持久化到 settings.json
      window.electronAPI
        .updateSettings({ shortcutOverrides: newOverrides })
        .then(() => {
          // 如果修改的是全局快捷键，通知主进程重新注册
          const def = DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)
          if (def?.global) {
            window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
          }
        })
        .catch(console.error)
    },
    [overrides, setOverrides],
  )

  // 恢复单个快捷键默认值
  const handleReset = React.useCallback(
    (shortcutId: string) => {
      const newOverrides = { ...overrides }
      delete newOverrides[shortcutId]
      setOverrides(newOverrides)
      updateShortcutOverrides(newOverrides)

      window.electronAPI
        .updateSettings({ shortcutOverrides: newOverrides })
        .then(() => {
          // 如果重置的是全局快捷键，通知主进程重新注册
          const def = DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)
          if (def?.global) {
            window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
          }
        })
        .catch(console.error)
    },
    [overrides, setOverrides],
  )

  // 恢复所有默认值
  const handleResetAll = React.useCallback(() => {
    setOverrides({})
    updateShortcutOverrides({})

    window.electronAPI
      .updateSettings({ shortcutOverrides: {} })
      .then(() => {
        // 重新注册全局快捷键（恢复默认绑定）
        window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
      })
      .catch(console.error)
  }, [setOverrides])

  const hasOverrides = Object.keys(overrides).length > 0

  // 分类顺序
  const categoryOrder: ShortcutCategory[] = ['app', 'navigation', 'edit', 'global']

  return (
    <div className="space-y-6">
      {/* 描述 + 恢复全部按钮 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          点击快捷键可自定义，按 Esc 取消录制
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
              {shortcuts.map((def) => {
                const currentAccel = getActiveAccelerator(def.id)
                const isCustomized = !!overrides[def.id]

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
                      <ShortcutRecorder
                        shortcutId={def.id}
                        currentAccelerator={currentAccel}
                        onRecord={handleRecord}
                      />
                      {isCustomized && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
                          onClick={() => handleReset(def.id)}
                          title="恢复默认"
                        >
                          <RotateCcw size={12} />
                        </Button>
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
