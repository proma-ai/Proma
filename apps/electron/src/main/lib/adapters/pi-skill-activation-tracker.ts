import type { SkillActivation } from '@proma/shared'

export interface PendingPromptSkillActivation {
  id: number
  prompt: string
  userMessageUuid: string
  activations: SkillActivation[]
}

/**
 * Keeps explicit Skill metadata dormant until Pi has actually appended the
 * corresponding user message to its session. Queue order is FIFO per prompt
 * because duplicate user text is valid.
 */
export class PendingPromptSkillActivationTracker {
  private nextId = 1
  private readonly entriesByPrompt = new Map<string, PendingPromptSkillActivation[]>()

  register(prompt: string, userMessageUuid: string, activations: SkillActivation[]): number | undefined {
    if (!prompt || !userMessageUuid || activations.length === 0) return undefined

    const entry: PendingPromptSkillActivation = {
      id: this.nextId++,
      prompt,
      userMessageUuid,
      activations,
    }
    const queue = this.entriesByPrompt.get(prompt) ?? []
    queue.push(entry)
    this.entriesByPrompt.set(prompt, queue)
    return entry.id
  }

  consume(prompt: string): PendingPromptSkillActivation | undefined {
    const queue = this.entriesByPrompt.get(prompt)
    const entry = queue?.shift()
    if (!queue || !entry) return undefined
    if (queue.length === 0) this.entriesByPrompt.delete(prompt)
    return entry
  }

  discard(id: number | undefined): void {
    if (id === undefined) return
    for (const [prompt, queue] of this.entriesByPrompt) {
      const index = queue.findIndex((entry) => entry.id === id)
      if (index < 0) continue
      queue.splice(index, 1)
      if (queue.length === 0) this.entriesByPrompt.delete(prompt)
      return
    }
  }

  clear(): void {
    this.entriesByPrompt.clear()
  }
}
