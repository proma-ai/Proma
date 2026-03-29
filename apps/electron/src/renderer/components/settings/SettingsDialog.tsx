/**
 * SettingsDialog - 设置浮窗
 *
 * 以 Dialog 浮窗形式展示设置面板，不覆盖主内容区。
 * 使用低级 Dialog 原语实现轻遮罩 + 无默认关闭按钮（关闭按钮由 SettingsPanel 内部提供）。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { SettingsPanel } from './SettingsPanel'

export function SettingsDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(settingsOpenAtom)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        {/* 轻遮罩 */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[100] bg-black/20 titlebar-no-drag transition-opacity duration-100 data-[state=open]:opacity-100 data-[state=closed]:opacity-0"
        />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-[100] translate-x-[-50%] translate-y-[-50%] w-[920px] h-[680px] bg-background shadow-2xl rounded-xl overflow-hidden titlebar-no-drag transition-all duration-100 data-[state=open]:opacity-100 data-[state=open]:scale-100 data-[state=closed]:opacity-0 data-[state=closed]:scale-[0.98]"
        >
          <DialogPrimitive.Title className="sr-only">设置</DialogPrimitive.Title>
          <SettingsPanel onClose={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
