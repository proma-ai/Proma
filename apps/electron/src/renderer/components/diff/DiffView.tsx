/**
 * DiffView — @pierre/diffs 渲染组件
 *
 * 接收 old/new 文件内容，使用 @pierre/diffs/react 的 MultiFileDiff 渲染。
 * 背景使用 Proma 主题色（disableBackground），滚动条自定义样式。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { MultiFileDiff } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import { resolvedThemeAtom } from '@/atoms/theme'
import './diff-scroll.css'

interface DiffViewProps {
  oldContent: string
  newContent: string
  filePath: string
  viewMode: 'split' | 'unified'
}

export const DiffView = React.memo(function DiffView({ oldContent, newContent, filePath, viewMode }: DiffViewProps): React.ReactElement {
  const theme = useAtomValue(resolvedThemeAtom)

  const oldFile: FileContents = React.useMemo(() => ({
    name: filePath,
    contents: oldContent,
  }), [filePath, oldContent])

  const newFile: FileContents = React.useMemo(() => ({
    name: filePath,
    contents: newContent,
  }), [filePath, newContent])

  const options = React.useMemo(() => ({
    diffStyle: viewMode,
    theme: { dark: 'one-dark-pro' as const, light: 'one-light' as const },
    disableFileHeader: true,
    diffIndicators: 'bars' as const,
    hunkSeparators: 'line-info' as const,
    lineDiffType: 'none' as const,
    overflow: 'scroll' as const,
    themeType: theme as 'light' | 'dark' | 'system',
    unsafeCSS: `
      :root, :host {
        --diffs-bg: transparent;
        --diffs-addition-base: rgb(67,167,71);
        --diffs-deletion-base: rgb(206,66,52);
        --diffs-addition-bg: light-dark(rgb(228,244,233), rgb(19,34,23));
        --diffs-deletion-bg: light-dark(rgb(248,231,230), rgb(39,22,20));
        --diffs-separator-bg: hsl(var(--background));
        --diffs-gap-style: 3px solid hsl(var(--content-area));
        --diffs-scrollbar-thumb: light-dark(hsl(var(--muted-foreground) / 0.6), hsl(var(--muted-foreground) / 0.2));
        --diffs-scrollbar-thumb-hover: light-dark(hsl(var(--muted-foreground) / 0.8), hsl(var(--muted-foreground) / 0.35));
      }
      .diff-scroll [data-code]::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      .diff-scroll [data-code]::-webkit-scrollbar-track {
        background: transparent;
      }
      .diff-scroll [data-code]::-webkit-scrollbar-thumb {
        background: var(--diffs-scrollbar-thumb);
        border-radius: 3px;
      }
      .diff-scroll [data-code]::-webkit-scrollbar-thumb:hover {
        background: var(--diffs-scrollbar-thumb-hover);
      }
      .diff-scroll [data-code]::-webkit-scrollbar-corner {
        background: transparent;
      }
      [data-separator=line-info],
      [data-separator=line-info] [data-separator-wrapper],
      [data-separator=line-info] [data-separator-content],
      [data-separator=line-info] [data-expand-button] {
        background-color: var(--diffs-separator-bg) !important;
      }
      [data-line-type=change-addition] {
        background-color: var(--diffs-addition-bg) !important;
      }
      [data-line-type=change-deletion] {
        background-color: var(--diffs-deletion-bg) !important;
      }
      [data-line-type=change-addition] [data-column-number],
      [data-line-type=change-addition] [data-gutter-buffer]:not([data-gutter-buffer=buffer]) {
        color: rgb(67,167,71) !important;
        background-color: var(--diffs-addition-bg) !important;
      }
      [data-line-type=change-deletion] [data-column-number],
      [data-line-type=change-deletion] [data-gutter-buffer]:not([data-gutter-buffer=buffer]) {
        color: rgb(206,66,52) !important;
        background-color: var(--diffs-deletion-bg) !important;
      }
      [data-gutter-buffer=buffer] {
        background: none !important;
      }
      [data-line-type=context] [data-column-number],
      [data-line-type=metadata] [data-column-number],
      [data-line-type=expanded] [data-column-number],
      [data-gutter] {
        background-color: hsl(var(--content-area)) !important;
      }
    `,
  }), [viewMode, theme])

  return (
    <div className="h-full diff-scroll bg-content-area overflow-auto">
      <MultiFileDiff oldFile={oldFile} newFile={newFile} options={options} className="h-full" />
    </div>
  )
})
