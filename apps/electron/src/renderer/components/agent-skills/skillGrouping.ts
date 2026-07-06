import type { SkillMeta } from '@proma/shared'

export interface SkillGroup {
  id: string
  title: string
  skills: SkillMeta[]
}

const UNGROUPED_TITLE = '未分组'

function normalizeGroup(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}

export function getSkillGroupTitle(skill: SkillMeta): string {
  if (skill.group) {
    const group = normalizeGroup(skill.group)
    if (group) return group
  }

  return UNGROUPED_TITLE
}

export function groupSkills(skills: SkillMeta[]): SkillGroup[] {
  const groups = new Map<string, SkillMeta[]>()

  for (const skill of skills) {
    const title = getSkillGroupTitle(skill)
    const group = groups.get(title) ?? []
    group.push(skill)
    groups.set(title, group)
  }

  return [...groups.entries()]
    .map(([title, groupSkills]) => ({
      id: title.toLowerCase(),
      title,
      skills: groupSkills,
    }))
    .sort((a, b) => compareGroupTitle(a.title, b.title))
}

function compareGroupTitle(a: string, b: string): number {
  if (a === UNGROUPED_TITLE && b !== UNGROUPED_TITLE) return 1
  if (b === UNGROUPED_TITLE && a !== UNGROUPED_TITLE) return -1
  return a.localeCompare(b, 'zh-CN')
}
