/**
 * 共享 lowlight 单例。
 *
 * 任何使用 `@tiptap/extension-code-block-lowlight` 的 TipTap 编辑器都应从这里 import，
 * 避免重复创建实例并加载相同的语法包。
 */

import { common, createLowlight } from 'lowlight'

export const lowlight = createLowlight(common)
