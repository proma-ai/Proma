export const EMPTY_SKILL_MENTION_NAMES: ReadonlyMap<string, string> = new Map()

/** slug 保持调用身份不变，当前名称仅用于展示；Skill 删除或不可读时回退 slug。 */
export function resolveSkillMentionName(
  slug: string,
  names: ReadonlyMap<string, string> = EMPTY_SKILL_MENTION_NAMES,
): string {
  return names.get(slug) || slug
}
