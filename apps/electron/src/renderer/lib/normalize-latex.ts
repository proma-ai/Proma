/**
 * 把 LaTeX 原生分隔符规范化为 remark-math 默认识别的 dollar 形式。
 *
 * 背景：很多模型按 LaTeX 习惯输出 inline \( ... \) 或 display \[ ... \]，
 * 但 react-markdown (CommonMark) 会把这几个反斜杠当作 ASCII 标点转义吃掉，
 * 留下裸的括号，remark-math 自然识别不到。
 *
 * 策略：在 markdown 解析之前完成替换；fenced code block 和 inline code 内
 * 的字面量要保护起来，避免把用户贴的代码段误改成数学公式。
 */

const PLACEHOLDER = (i: number): string => `PROMA_LATEX_PROTECT_${i}`
const PLACEHOLDER_PATTERN = /PROMA_LATEX_PROTECT_(\d+)/g

export function normalizeLatexDelimiters(text: string): string {
  if (!text || (!text.includes('\\(') && !text.includes('\\['))) {
    return text
  }

  const protectedSegments: string[] = []
  const protect = (segment: string): string => {
    const i = protectedSegments.push(segment) - 1
    return PLACEHOLDER(i)
  }

  let working = text.replace(/```[\s\S]*?```/g, protect)
  working = working.replace(/`[^`\n]*`/g, protect)

  working = working.replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner) => `$$${inner}$$`)
  working = working.replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner) => `$${inner}$`)

  working = working.replace(PLACEHOLDER_PATTERN, (_m, i) => protectedSegments[Number(i)] ?? _m)

  return working
}
