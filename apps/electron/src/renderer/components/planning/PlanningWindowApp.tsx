import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { AutomationFormView } from '@/components/automation/AutomationFormView'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PlanningView } from './PlanningView'

/** 独立窗口模式：复用规划中心，不挂载聊天与 Agent 工作区。 */
export function PlanningWindowApp(): React.ReactElement {
  const automationFormOpen = useAtomValue(automationFormAtom).open

  useEffect(() => {
    document.title = 'Proma · 规划中心'
  }, [])

  return <TooltipProvider delayDuration={200}><div className="h-screen overflow-hidden bg-content-area">{automationFormOpen ? <AutomationFormView /> : <PlanningView standalone />}</div></TooltipProvider>
}
