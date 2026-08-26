/**
 * Encoded mention values are safe to end at adjacent CJK text because all
 * generated paths and named-reference labels use encodeURIComponent.
 */
export const ENCODED_MENTION_VALUE_PATTERN = String.raw`[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？；：、（）【】《》“”‘’]+`

/**
 * MCP server names and Skill slugs are serialized as their raw IDs. These
 * values may legitimately contain CJK characters, so their boundary is the
 * explicit whitespace inserted by the mention suggestion and serializer.
 */
export const PLAIN_MENTION_VALUE_PATTERN = String.raw`\S+`

/** Create a fresh instance because mention parsing uses a global regexp. */
export function createMentionPattern(): RegExp {
  return new RegExp(
    String.raw`@file:(${ENCODED_MENTION_VALUE_PATTERN})|/skill:(${PLAIN_MENTION_VALUE_PATTERN})|#mcp:(${PLAIN_MENTION_VALUE_PATTERN})|&session:([A-Za-z0-9-]+)(?:(?:~|::)(${ENCODED_MENTION_VALUE_PATTERN}))?|&todo:([A-Za-z0-9-]+)(?:(?:~|::)(${ENCODED_MENTION_VALUE_PATTERN}))?|&calendar_event:([A-Za-z0-9-]+)(?:(?:~|::)(${ENCODED_MENTION_VALUE_PATTERN}))?|&quote:([A-Za-z0-9%_.!~*'()-]+)`,
    'gu',
  )
}
