/**
 * Markdown 预览字号状态原子
 *
 * 三档字号偏好（小/中/大），通过 CSS 变量 --md-preview-font-size 驱动
 * AI 回复（react-markdown）和文件预览（TipTap）的根字号。
 * 持久化到 ~/.proma/settings.json。
 */

import { atom } from 'jotai'
import { DEFAULT_MARKDOWN_FONT_SIZE } from '../../types'
import type { MarkdownFontSize } from '../../types'

/** 各档位对应的根字号（px） */
const FONT_SIZE_PX: Record<MarkdownFontSize, number> = {
  small: 13,
  medium: 15,
  large: 17,
}

/** Markdown 字号档位 */
export const markdownFontSizeAtom = atom<MarkdownFontSize>(DEFAULT_MARKDOWN_FONT_SIZE)

/**
 * 将字号档位写入 :root CSS 变量
 *
 * 渲染组件通过 var(--md-preview-font-size) 读取，inline code / 代码块用
 * em 相对单位跟随缩放。
 */
export function applyMarkdownFontSizeToDOM(size: MarkdownFontSize): void {
  const px = FONT_SIZE_PX[size]
  document.documentElement.style.setProperty('--md-preview-font-size', `${px}px`)
}

/**
 * 初始化 Markdown 字号
 *
 * 从主进程加载持久化设置并写入 atom + DOM。
 */
export async function initializeMarkdownFontSize(
  setSize: (size: MarkdownFontSize) => void,
): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    const size = settings.markdownFontSize ?? DEFAULT_MARKDOWN_FONT_SIZE
    setSize(size)
    applyMarkdownFontSizeToDOM(size)
  } catch (error) {
    console.error('[Markdown字号] 初始化失败:', error)
    applyMarkdownFontSizeToDOM(DEFAULT_MARKDOWN_FONT_SIZE)
  }
}

/**
 * 更新 Markdown 字号档位并持久化
 */
export async function updateMarkdownFontSize(size: MarkdownFontSize): Promise<void> {
  applyMarkdownFontSizeToDOM(size)
  try {
    await window.electronAPI.updateSettings({ markdownFontSize: size })
  } catch (error) {
    console.error('[Markdown字号] 持久化失败:', error)
  }
}
