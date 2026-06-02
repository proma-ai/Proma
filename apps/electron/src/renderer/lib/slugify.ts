/**
 * GitHub 风格的标题 slug 生成
 *
 * 用于 Markdown 预览目录（TOC）为标题注入锚点 id：小写化、空格转连字符、
 * 去除标点，保留中日韩等 Unicode 字母。`createSlugger` 维护去重计数器，
 * 同名标题追加 `-1`、`-2` 后缀，与 GitHub 渲染行为一致。
 */

/** 将单个标题文本转为基础 slug（不含去重后缀） */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    // 去除标点/符号，保留 Unicode 字母数字、连字符、下划线
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 创建带去重能力的 slug 生成器
 *
 * 每次调用 `slug(text)` 返回唯一 slug：首次出现用基础 slug，
 * 重复出现追加递增后缀。空标题回退为 `section`。
 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text: string): string => {
    const base = slugify(text) || 'section'
    const count = seen.get(base)
    if (count === undefined) {
      seen.set(base, 0)
      return base
    }
    const next = count + 1
    seen.set(base, next)
    return `${base}-${next}`
  }
}
