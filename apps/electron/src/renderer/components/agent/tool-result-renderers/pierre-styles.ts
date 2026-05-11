/**
 * @pierre/diffs 共享样式常量
 *
 * 与 DiffView.tsx 保持一致的颜色方案，
 * 供 edit-result / write-result / read-result 等工具渲染器复用。
 */

/** Pierre diffs 主题颜色 CSS — 注入到 unsafeCSS */
export const PIERRE_DIFF_CSS = `
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
  [data-code]::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  [data-code]::-webkit-scrollbar-track {
    background: transparent;
  }
  [data-code]::-webkit-scrollbar-thumb {
    background: var(--diffs-scrollbar-thumb);
    border-radius: 3px;
  }
  [data-code]::-webkit-scrollbar-thumb:hover {
    background: var(--diffs-scrollbar-thumb-hover);
  }
  [data-code]::-webkit-scrollbar-corner {
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
`

/** Pierre File 组件的 CSS — 纯代码预览（无 diff 行类型） */
export const PIERRE_FILE_CSS = `
  :root, :host {
    --diffs-bg: transparent;
    --diffs-scrollbar-thumb: light-dark(hsl(var(--muted-foreground) / 0.6), hsl(var(--muted-foreground) / 0.2));
    --diffs-scrollbar-thumb-hover: light-dark(hsl(var(--muted-foreground) / 0.8), hsl(var(--muted-foreground) / 0.35));
  }
  [data-code]::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  [data-code]::-webkit-scrollbar-track {
    background: transparent;
  }
  [data-code]::-webkit-scrollbar-thumb {
    background: var(--diffs-scrollbar-thumb);
    border-radius: 3px;
  }
  [data-code]::-webkit-scrollbar-thumb:hover {
    background: var(--diffs-scrollbar-thumb-hover);
  }
  [data-code]::-webkit-scrollbar-corner {
    background: transparent;
  }
  [data-column-number],
  [data-gutter] {
    background-color: hsl(var(--content-area)) !important;
  }
`

/**
 * 为 Read 工具的 partial read 修正 PierreFile 行号。
 *
 * Claude SDK 的 Read 结果常带 cat -n 行号；渲染前会剥离这些前缀以避免双行号，
 * 这里再把 Pierre 的 gutter 起始值调整回真实文件行号。
 */
export function createPierreFileCSS(lineNumberStart: number, maxLineNumber: number): string {
  const safeStart = Number.isFinite(lineNumberStart) ? Math.max(1, Math.floor(lineNumberStart)) : 1
  const safeMax = Number.isFinite(maxLineNumber) ? Math.max(safeStart, Math.floor(maxLineNumber)) : safeStart
  const minWidth = `${Math.max(3, String(safeMax).length)}ch`

  if (safeStart === 1) {
    return `
      ${PIERRE_FILE_CSS}
      :root, :host {
        --diffs-min-number-column-width: ${minWidth};
      }
    `
  }

  return `
    ${PIERRE_FILE_CSS}
    :root, :host {
      --diffs-min-number-column-width: ${minWidth};
    }
    [data-gutter] {
      counter-reset: proma-read-line ${safeStart - 1};
    }
    [data-line-number-content] {
      color: transparent !important;
    }
    [data-line-number-content]::before {
      counter-increment: proma-read-line;
      content: counter(proma-read-line);
      color: var(--diffs-fg-number);
    }
  `
}
