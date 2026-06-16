/**
 * SKILL.md frontmatter 解析与重写工具
 *
 * 从 SKILL.md 文本中提取正文，以及在保留 frontmatter 的前提下
 * 重写 name / description / body 字段。供 Agent 技能详情抽屉编辑使用。
 */

/** 提取 SKILL.md 的正文（去除 frontmatter） */
export function extractSkillBody(content: string): string {
  // 移除 UTF-8 BOM（﻿），确保 frontmatter 匹配不受 BOM 干扰
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)

  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/)
  return match?.[1] ?? content
}

/** 在保留 frontmatter 结构的前提下重写指定字段 */
export function rebuildSkillMd(
  originalContent: string,
  updates: { name?: string; description?: string; body?: string },
): string {
  // 移除 UTF-8 BOM（﻿），确保 frontmatter 匹配不受 BOM 干扰
  if (originalContent.charCodeAt(0) === 0xFEFF) originalContent = originalContent.slice(1)

  const fmMatch = originalContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!fmMatch) return originalContent

  let fmBlock = fmMatch[1] ?? ''
  const currentBody = fmMatch[2] ?? ''

  if (updates.name !== undefined) {
    fmBlock = /^name:/m.test(fmBlock)
      ? fmBlock.replace(/^name:.*$/m, `name: ${updates.name}`)
      : `name: ${updates.name}\n${fmBlock}`
  }
  if (updates.description !== undefined) {
    fmBlock = /^description:/m.test(fmBlock)
      ? fmBlock.replace(/^description:.*$/m, `description: ${updates.description}`)
      : `${fmBlock}\ndescription: ${updates.description}`
  }

  const newBody = updates.body !== undefined ? updates.body : currentBody
  return `---\n${fmBlock}\n---\n${newBody}`
}
