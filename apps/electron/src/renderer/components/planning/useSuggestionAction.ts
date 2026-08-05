import * as React from 'react'
import { useSetAtom } from 'jotai'
import type { SuggestionRecord } from '@proma/shared'
import { createEmptyDraft, automationFormAtom } from '@/atoms/automation-atoms'
import { activeViewAtom, agentSkillsTabAtom } from '@/atoms/active-view'
import { agentPendingPromptAtom } from '@/atoms/agent-atoms'
import { planningTabAtom, planningTodoSuggestionDraftAtom } from '@/atoms/planning-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'

export function suggestionActionLabel(record: SuggestionRecord, standalone = false): string {
  if (standalone && (record.action.type === 'open_skill_creator' || record.action.type === 'open_memory_board')) {
    return '在主窗口处理'
  }
  switch (record.action.type) {
    case 'open_automation_create': return '创建草稿'
    case 'open_todo_create': return '新建 Todo'
    case 'open_skill_creator': return '生成 Skill 草稿'
    case 'open_memory_board': return '查看记忆'
    default: return '接受'
  }
}

export type SuggestionActionResult = 'ready' | 'handoff' | 'failed'

/**
 * 将建议的“接受”转成预填、但仍由用户确认的下一步。
 * 自动化创建的是禁用草稿；用户必须在已预填表单内完成配置并显式启用后才会运行。
 */
export function useSuggestionAction(standalone = false): (record: SuggestionRecord) => Promise<SuggestionActionResult> {
  const setActiveView = useSetAtom(activeViewAtom)
  const setAgentSkillsTab = useSetAtom(agentSkillsTabAtom)
  const setPlanningTab = useSetAtom(planningTabAtom)
  const setAutomationForm = useSetAtom(automationFormAtom)
  const setTodoDraft = useSetAtom(planningTodoSuggestionDraftAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const { createAgent } = useCreateSession()

  return React.useCallback(async (record: SuggestionRecord): Promise<SuggestionActionResult> => {
    switch (record.action.type) {
      case 'memory_correction':
        return 'ready'
      case 'open_automation_create': {
        const draft = createEmptyDraft()
        draft.name = record.action.automationTitle
        draft.prompt = record.action.suggestedPrompt
        draft.scheduleType = 'daily'
        draft.timeOfDay = '09:00'
        // 当前表单以自动保存为交互模式；点击“创建草稿”是显式创建确认，
        // 但仍必须由用户补全配置并手动启用后才会运行。
        draft.active = false
        setActiveView('planning')
        setPlanningTab('automations')
        setAutomationForm({ open: true, draft })
        return 'ready'
      }
      case 'open_todo_create':
        setActiveView('planning')
        setPlanningTab('todos')
        setTodoDraft({ title: record.action.title, notes: record.action.notes })
        return 'ready'
      case 'open_skill_creator': {
        if (standalone) {
          try {
            await window.electronAPI.agentIsland.openMainWindow()
            return 'handoff'
          } catch {
            return 'failed'
          }
        }
        const sessionId = await createAgent({ draft: true })
        if (!sessionId) return 'failed'
        setPendingPrompt({
          sessionId,
          message: `请将以下重复工作模式沉淀为一个可复用的 Skill。先读取当前工作区已有 Skills，避免重复；只在证据充分时创建或更新最小可用流程，并说明验证方式。\n\n主题：${record.action.topic}`,
        })
        return 'ready'
      }
      // 兼容旧 suggestions.json 中尚未迁移的 Todo 动作。
      case 'open_memory_board': {
        if (standalone) {
          try {
            await window.electronAPI.agentIsland.openMainWindow()
            return 'handoff'
          } catch {
            return 'failed'
          }
        }
        setActiveView('agent-skills')
        setAgentSkillsTab('memory')
        return 'ready'
      }
    }
  }, [createAgent, setActiveView, setAgentSkillsTab, setAutomationForm, setPendingPrompt, setPlanningTab, setTodoDraft, standalone])
}
