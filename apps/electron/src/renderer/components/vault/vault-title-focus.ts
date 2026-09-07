import type { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** 只识别首部 YAML 边界（含空 YAML/BOM），不依赖 Properties 能否编辑。 */
export function getVaultBodyStart(doc: Text): number {
  const lines = doc.iterLines()
  const firstLine = lines.next().value
  if (firstLine.replace(/^\uFEFF/, '') !== '---') return 0
  let offset = firstLine.length + 1
  while (!lines.next().done) {
    const line = lines.value
    offset += line.length + 1
    // 必须顶格，不能把 YAML 多行文本中缩进的 --- 当作结束边界。
    if (/^---[ \t]*$/.test(line)) return offset
  }
  return 0
}

export function focusVaultBody(view: EditorView): void {
  const anchor = getVaultBodyStart(view.state.doc)
  view.dispatch({
    // EOF 结束围栏没有尾换行时，补一个换行，避免后续输入破坏 YAML。
    changes: anchor > view.state.doc.length ? { from: view.state.doc.length, insert: '\n' } : undefined,
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: 'start' }),
  })
  view.focus()
}
