/**
 * Mention values are serialized as non-whitespace tokens. CJK characters are
 * excluded as well because generated mention values use percent encoding;
 * this lets `@file:foo.md后续文字` end at the file name without requiring a
 * separator in the user message.
 */
export const MENTION_VALUE_PATTERN = String.raw`[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？；：、（）【】《》“”‘’]+`

/** Create a fresh instance because mention parsing uses a global regexp. */
export function createMentionPattern(): RegExp {
  return new RegExp(
    String.raw`@file:(${MENTION_VALUE_PATTERN})|/skill:(${MENTION_VALUE_PATTERN})|#mcp:(${MENTION_VALUE_PATTERN})|&session:([A-Za-z0-9-]+)(?:(?:~|::)(${MENTION_VALUE_PATTERN}))?|&todo:([A-Za-z0-9-]+)(?:(?:~|::)(${MENTION_VALUE_PATTERN}))?|&calendar_event:([A-Za-z0-9-]+)(?:(?:~|::)(${MENTION_VALUE_PATTERN}))?|&quote:([A-Za-z0-9%_.!~*'()-]+)`,
    'gu',
  )
}
