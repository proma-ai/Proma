/**
 * Shortcut Atoms — 快捷键状态管理
 *
 * 管理用户自定义快捷键覆盖配置。
 * 通过 settings IPC 通道持久化到 settings.json。
 */

import { atom } from 'jotai'
import type { ShortcutOverrides } from '@/lib/shortcut-defaults'

/** 用户自定义快捷键覆盖（从 settings.json 加载） */
export const shortcutOverridesAtom = atom<ShortcutOverrides>({})

/** 发送消息快捷键模式：true = Cmd/Ctrl+Enter 发送，false = Enter 发送 */
export const sendWithCmdEnterAtom = atom(false)
