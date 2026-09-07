import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import { selectAtom, unwrap } from 'jotai/utils'
import { workspaceCapabilitiesVersionAtom } from './agent-atoms'
import { EMPTY_SKILL_MENTION_NAMES } from '../lib/skill-mention-name'

/** 仅展示使用全量 Skill 列表；不改变 Agent 的启用能力范围。 */
export const skillMentionNamesAtomFamily = atomFamily((workspaceSlug: string | null) => atom(async (get): Promise<ReadonlyMap<string, string>> => {
  get(workspaceCapabilitiesVersionAtom)
  if (!workspaceSlug) return EMPTY_SKILL_MENTION_NAMES

  try {
    const skills = await window.electronAPI.getWorkspaceSkills(workspaceSlug)
    return new Map(skills.map((skill) => [skill.slug, skill.name.trim() || skill.slug]))
  } catch {
    // 读取失败和删除均回退 slug；后续能力通知可重新读取恢复。
    return EMPTY_SKILL_MENTION_NAMES
  }
}))

function equalNames(previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): boolean {
  return previous.size === next.size && [...next].every(([slug, name]) => previous.get(slug) === name)
}

/** 每个工作区独立保留待决前值；相同映射不扇出 Context 更新，也不触发 Suspense。 */
export const skillMentionNamesDisplayAtomFamily = atomFamily((workspaceSlug: string | null) => {
  const stableNames = selectAtom(
    unwrap(skillMentionNamesAtomFamily(workspaceSlug), (previous) => previous ?? EMPTY_SKILL_MENTION_NAMES),
    (names) => names,
    equalNames,
  )
  // writable 包装仅用于 onMount 生命周期；值仍由异步读取派生。
  const displayAtom = atom((get) => get(stableNames), () => {})
  let mounts = 0
  let retired = false
  displayAtom.onMount = () => {
    mounts++
    return () => {
      mounts--
      // 跨 store 共用 family；最后一个订阅者卸载才清理。微任务兼容 StrictMode 重挂载。
      queueMicrotask(() => {
        if (mounts !== 0 || retired) return
        // 消费者可能仍持有淘汰前的 atom，再次卸载时不能删除同 slug 的新实例。
        retired = true
        if (skillMentionNamesDisplayAtomFamily(workspaceSlug) !== displayAtom) return
        skillMentionNamesDisplayAtomFamily.remove(workspaceSlug)
        skillMentionNamesAtomFamily.remove(workspaceSlug)
      })
    }
  }
  return displayAtom
})
