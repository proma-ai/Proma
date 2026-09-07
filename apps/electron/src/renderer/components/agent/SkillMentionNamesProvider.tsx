import * as React from 'react'
import { useAtomValue } from 'jotai'
import { skillMentionNamesDisplayAtomFamily } from '@/atoms/skill-mention-atoms'
import { EMPTY_SKILL_MENTION_NAMES } from '@/lib/skill-mention-name'

const SkillMentionNamesContext = React.createContext(EMPTY_SKILL_MENTION_NAMES)

/** 使用所属会话的工作区，而非全局当前工作区，兼容临时/嵌入式 Agent。 */
export function SkillMentionNamesProvider({ workspaceSlug, children }: {
  workspaceSlug: string | null
  children: React.ReactNode
}): React.ReactElement {
  const names = useAtomValue(skillMentionNamesDisplayAtomFamily(workspaceSlug))
  return (
    <SkillMentionNamesContext.Provider value={names}>
      {children}
    </SkillMentionNamesContext.Provider>
  )
}

export function useSkillMentionNames(): ReadonlyMap<string, string> {
  return React.useContext(SkillMentionNamesContext)
}
