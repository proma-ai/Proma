interface MarkdownHeadingDecorationChange {
  documentChanged: boolean
  syntaxTreeChanged: boolean
}

interface MarkdownSyntaxDecorationChange extends MarkdownHeadingDecorationChange {
  selectionChanged: boolean
  focusChanged: boolean
}

/** 标题元数据也要响应 CodeMirror 后台解析推进，而不只响应文档编辑。 */
export function shouldRebuildMarkdownHeadingDecorations(change: MarkdownHeadingDecorationChange): boolean {
  return change.documentChanged || change.syntaxTreeChanged
}

/** Live Preview 标记同时受文档、选区、焦点与后台语法树影响。 */
export function shouldRebuildMarkdownSyntaxDecorations(change: MarkdownSyntaxDecorationChange): boolean {
  return change.documentChanged
    || change.selectionChanged
    || change.focusChanged
    || change.syntaxTreeChanged
}
