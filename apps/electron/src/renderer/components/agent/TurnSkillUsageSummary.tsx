import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Sparkles } from 'lucide-react'
import { collectSkillActivations } from '@proma/shared'
import type { SDKMessage, SDKUserMessage, SkillActivation, VaultFocusAttribution } from '@proma/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { currentAgentSessionIdAtom, openWorkspaceComponentAtom, skillDetailNavigationAtomFamily } from '@/atoms/agent-atoms'
import { focusedVaultFolderAtom, selectedVaultFileAtom } from '@/atoms/vault-atoms'
import { ObsidianIcon } from '@/components/obsidian/obsidian-brand'
import { cn } from '@/lib/utils'

export interface TurnSkillUsageSummaryProps {
  inputMessage?: SDKUserMessage
  turnMessages: SDKMessage[]
  /** Avoid a second divider when another completion summary follows this section. */
  showDivider?: boolean
}

function readVaultFocusAttribution(inputMessage?: SDKUserMessage): VaultFocusAttribution | null {
  const value = (inputMessage as unknown as { _vaultFocus?: unknown } | undefined)?._vaultFocus
  if (!value || typeof value !== 'object') return null
  const focus = (value as { focus?: unknown }).focus
  if (!focus || typeof focus !== 'object') return null
  const record = value as Partial<VaultFocusAttribution>
  const focusRecord = focus as Partial<VaultFocusAttribution['focus']>
  if (
    typeof record.displayName !== 'string' || typeof record.rootPath !== 'string'
    || (focusRecord.kind !== 'file' && focusRecord.kind !== 'folder')
    || typeof focusRecord.relativePath !== 'string' || !Number.isSafeInteger(focusRecord.sequence)
  ) return null
  return {
    displayName: record.displayName,
    rootPath: record.rootPath,
    focus: { kind: focusRecord.kind, relativePath: focusRecord.relativePath, sequence: focusRecord.sequence as number },
  }
}

function VaultFocusChip({ attribution }: { attribution: VaultFocusAttribution }): React.ReactElement {
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const openWorkspaceComponent = useSetAtom(openWorkspaceComponentAtom)
  const setSelectedFile = useSetAtom(selectedVaultFileAtom)
  const setFocusedFolder = useSetAtom(focusedVaultFolderAtom)
  const { focus } = attribution
  const label = `${focus.relativePath.split('/').filter(Boolean).pop() || attribution.displayName}${focus.kind === 'folder' ? '/' : ''}`
  const handleOpenVault = React.useCallback(() => {
    if (!sessionId) return
    if (focus.kind === 'file') {
      setFocusedFolder(null)
      setSelectedFile(focus.relativePath)
    } else {
      setFocusedFolder(focus.relativePath)
    }
    openWorkspaceComponent('vault')
  }, [focus.kind, focus.relativePath, openWorkspaceComponent, sessionId, setFocusedFolder, setSelectedFile])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-[240px] items-center gap-[0.25em] rounded-md bg-[hsl(270_60%_60%/0.15)] px-[0.35em] py-[0.15em] text-[0.875em] font-medium leading-none text-[hsl(270_60%_50%)] transition-colors hover:bg-[hsl(270_60%_60%/0.24)]"
          onClick={handleOpenVault}
          aria-label={`在 Obsidian 中打开本轮上下文 ${label}`}
        >
          <ObsidianIcon className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>本轮获得的 Obsidian {focus.kind === 'file' ? '文件' : '文件夹'}线索；不代表 Agent 已读取或编辑</p>
        <p className="max-w-80 break-all text-xs text-muted-foreground">{attribution.rootPath}/{focus.relativePath}</p>
      </TooltipContent>
    </Tooltip>
  )
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
  const vaultFocus = React.useMemo(() => readVaultFocusAttribution(inputMessage), [inputMessage])

  if (activations.length === 0 && !vaultFocus) return null

  return (
    <div className={cn('pl-[46px] mt-3', !showDivider && 'mt-2')}>
      <div className={cn(showDivider && 'border-t-2 border-dashed border-border/60 pt-3')}>
        <div className="flex flex-wrap gap-1.5">
          {vaultFocus && <VaultFocusChip attribution={vaultFocus} />}
          {activations.map((activation) => (
            <SkillUsageChip key={activation.slug} activation={activation} />
          ))}
        </div>
      </div>
    </div>
  )
}
