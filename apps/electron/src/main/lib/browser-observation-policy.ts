export const DEFAULT_BROWSER_OBSERVE_MAX_ELEMENTS = 240
export const MAX_BROWSER_OBSERVE_MAX_ELEMENTS = 400
export const MIN_BROWSER_OBSERVE_MAX_ELEMENTS = 20

const INTERACTIVE_ROLE_RATIO = 2 / 3

const INTERACTIVE_AX_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
])

export function resolveBrowserObserveMaxElements(requested?: number): number {
  if (requested === undefined) return DEFAULT_BROWSER_OBSERVE_MAX_ELEMENTS
  if (!Number.isFinite(requested)) throw new Error('maxElements 必须是有限数字。')
  return Math.max(MIN_BROWSER_OBSERVE_MAX_ELEMENTS, Math.min(MAX_BROWSER_OBSERVE_MAX_ELEMENTS, Math.floor(requested)))
}

export function isInteractiveAxRole(role: string): boolean {
  return INTERACTIVE_AX_ROLES.has(role.toLowerCase())
}

/** contenteditable 等自定义编辑器不一定暴露为标准 textbox role。 */
export function isInteractiveBrowserObservationCandidate(candidate: { role: string; editable?: boolean }): boolean {
  return candidate.editable === true || isInteractiveAxRole(candidate.role)
}

/**
 * 优先保留可操作的 AX 节点，剩余预算再补语义上下文。
 * 默认 240 的分配为 160 个可交互节点 + 80 个上下文节点。
 */
export function prioritizeBrowserObservationCandidates<T extends { role: string; editable?: boolean }>(candidates: readonly T[], maxElements: number): T[] {
  const interactiveLimit = Math.ceil(maxElements * INTERACTIVE_ROLE_RATIO)
  const interactive: T[] = []
  const context: T[] = []

  for (const candidate of candidates) {
    if (isInteractiveBrowserObservationCandidate(candidate)) interactive.push(candidate)
    else context.push(candidate)
  }

  const selectedInteractive = interactive.slice(0, interactiveLimit)
  return [...selectedInteractive, ...context.slice(0, maxElements - selectedInteractive.length)]
}

export function browserObservationNameLimit(role: string): number {
  return isInteractiveAxRole(role) ? 160 : 80
}
