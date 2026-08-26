import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Sparkles } from 'lucide-react'
import { collectSkillActivations } from '@proma/shared'
import type { SDKMessage, SDKUserMessage, SkillActivation } from '@proma/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { currentAgentSessionIdAtom, openWorkspaceComponentAtom, skillDetailNavigationAtomFamily } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'

export interface TurnSkillUsageSummaryProps {
  inputMessage?: SDKUserMessage
  turnMessages: SDKMessage[]
  /** Avoid a second divider when another completion summary follows this section. */
  showDivider?: boolean
}

function SkillUsageChip({ activation }: { activation: SkillActivation }): React.ReactElement {
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const openWorkspaceComponent = useSetAtom(openWorkspaceComponentAtom)
  const setSkillDetailNavigation = useSetAtom(skillDetailNavigationAtomFamily(sessionId ?? ''))
  const canOpen = Boolean(sessionId && activation.slug)
  const handleOpenSkill = React.useCallback(() => {
    if (!sessionId) return
    setSkillDetailNavigation({
      skillSlug: activation.slug,
      ...(activation.workspaceSlug ? { workspaceSlug: activation.workspaceSlug } : {}),
    })
    openWorkspaceComponent('skills')
  }, [activation.slug, activation.workspaceSlug, openWorkspaceComponent, sessionId, setSkillDetailNavigation])
  const chipClassName = cn(
    'inline-flex max-w-[240px] items-center gap-[0.25em] rounded-md px-[0.35em] py-[0.15em] text-[0.875em] font-medium leading-none',
    'bg-[hsl(270_60%_60%/0.15)] text-[hsl(270_60%_50%)]',
    canOpen && 'cursor-pointer transition-colors hover:bg-[hsl(270_60%_60%/0.24)]',
  )
  const chipContent = <>
    <Sparkles className="size-3 shrink-0" />
    <span className="truncate">{activation.name}</span>
  </>

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {canOpen ? (
          <button
            type="button"
            className={chipClassName}
            onClick={handleOpenSkill}
            aria-label={`在 Skills 中打开 ${activation.name}`}
          >
            {chipContent}
          </button>
        ) : (
          <span className={chipClassName} aria-label={`已加载 Skill ${activation.name}`}>
            {chipContent}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>本轮已使用的 Skill，点击在右侧 Skills 中查看和修改</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function getTurnSkillActivations(
  turnMessages: SDKMessage[],
  inputMessage?: SDKUserMessage,
): SkillActivation[] {
  // New records carry a UUID on the source input. Pi can collapse multiple
  // queued turns into one result, so its terminal metadata is deliberately
  // excluded here; explicit activations live on inputMessage and Read evidence
  // remains local to turnMessages. UUID-less historical turns retain result
  // metadata fallback.
  const scopedMessages = inputMessage?.uuid
    ? [inputMessage, ...turnMessages.filter((message) => message.type !== 'result')]
    : (inputMessage ? [inputMessage, ...turnMessages] : turnMessages)
  const localActivations = collectSkillActivations(scopedMessages)
  if (!inputMessage?.uuid || localActivations.length === 0) return localActivations

  // The terminal result can contain locators from several queued turns. It is
  // never allowed to introduce a chip here, but it can complete the durable
  // locator for a matching locally-proven Read activation.
  const terminalActivations = collectSkillActivations(
    turnMessages.filter((message) => message.type === 'result'),
  )
  return localActivations.map((activation) => {
    const terminal = terminalActivations.find((candidate) => candidate.slug === activation.slug)
    if (!terminal) return activation
    return {
      ...activation,
      ...(activation.filePath || !terminal.filePath ? {} : { filePath: terminal.filePath }),
      ...(activation.workspaceSlug || !terminal.workspaceSlug || !terminal.workspaceSkillPath
        ? {}
        : { workspaceSlug: terminal.workspaceSlug, workspaceSkillPath: terminal.workspaceSkillPath }),
    }
  })
}

export function TurnSkillUsageSummary({
  inputMessage,
  turnMessages,
  showDivider = true,
}: TurnSkillUsageSummaryProps): React.ReactElement | null {
  const activations = React.useMemo(
    () => getTurnSkillActivations(turnMessages, inputMessage),
    [inputMessage, turnMessages],
  )

  if (activations.length === 0) return null

  return (
    <div className={cn('pl-[46px] mt-3', !showDivider && 'mt-2')}>
      <div className={cn(showDivider && 'border-t-2 border-dashed border-border/60 pt-3')}>
        <div className="flex flex-wrap gap-1.5">
          {activations.map((activation) => (
            <SkillUsageChip key={activation.slug} activation={activation} />
          ))}
        </div>
      </div>
    </div>
  )
}
