import type { ConversationMeta } from '@proma/shared'

/**
 * Deduplicate concurrent first-use requests for an Agent session's side Chat.
 * Preview and Vault are mounted independently, so component-local pending refs
 * cannot prevent both from issuing createConversation at the same time.
 */
const pendingSideChatCreates = new Map<string, Promise<ConversationMeta>>()

export function getOrCreateSideChat(
  sessionId: string,
  create: () => Promise<ConversationMeta>,
): Promise<ConversationMeta> {
  const pending = pendingSideChatCreates.get(sessionId)
  if (pending) return pending

  const created = create()
  pendingSideChatCreates.set(sessionId, created)
  const clearPending = (): void => {
    // Keep the settled promise through the callers' state updates, so another
    // same-tick selection still shares it rather than creating an orphan chat.
    window.setTimeout(() => {
      if (pendingSideChatCreates.get(sessionId) === created) {
        pendingSideChatCreates.delete(sessionId)
      }
    }, 0)
  }
  void created.then(clearPending, clearPending)
  return created
}
