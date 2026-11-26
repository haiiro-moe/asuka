/**
 * Emoji extraction from message text.
 *
 * Only the emoji and how often each appears leave this module. The text itself
 * is never kept (see docs/activity/foundation.md).
 */

/** One distinct emoji found in a message. */
export interface ParsedEmoji {
  /**
   * Key that identifies the emoji and is stored verbatim in the `emoji`
   * columns: `custom:<id>` for a custom emoji, the emoji itself (without
   * U+FE0F) for a unicode emoji.
   */
  emoji: string;
  /** Name of a custom emoji as written in the message; null for a unicode emoji. */
  name: string | null;
  /** How many times the emoji appears in the text. */
  count: number;
}

/** A fenced code block: three backticks up to the next three. */
const FENCED_CODE = /```[\s\S]*?```/g;

/** Inline code: one or two backticks up to the matching run. */
const INLINE_CODE = /(`{1,2})(?!`)[\s\S]*?[^`]\1(?!`)/g;

/**
 * One emoji per match.
 *
 * - Groups 1 and 2: name and id of a custom emoji, `<:name:id>` or `<a:name:id>`.
 * - Otherwise a unicode emoji: pictographs joined by U+200D, each with an
 *   optional U+FE0F and skin tone (and a tag sequence, as in subdivision
 *   flags); or a flag made of two regional indicators; or a keycap.
 */
const EMOJI =
  /<a?:([\w~]{1,32}):(\d+)>|\p{Extended_Pictographic}️?\p{Emoji_Modifier}?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:‍\p{Extended_Pictographic}️?\p{Emoji_Modifier}?)*|\p{Regional_Indicator}{2}|[0-9#*]️?⃣/gu;

/** U+FE0F, the emoji presentation selector. Dropped so `❤️` and `❤` share a key. */
const VARIATION_SELECTOR = /️/g;

/**
 * List the emoji used in a message's text.
 *
 * Fenced code blocks and inline code are skipped. Custom emoji are keyed
 * `custom:<id>`, unicode emoji by the emoji itself with U+FE0F removed. A
 * sequence joined by U+200D (a family, a flag with a rainbow) is one emoji, and
 * a skin tone stays part of its emoji.
 *
 * @param text - The raw message content.
 * @returns One entry per distinct emoji, in order of first appearance.
 *
 * @example
 * ```ts
 * parseEmoji("gg 😀😀 <:pog:123>");
 * // [{ emoji: "😀", name: null, count: 2 }, { emoji: "custom:123", name: "pog", count: 1 }]
 * ```
 */
export function parseEmoji(text: string): ParsedEmoji[] {
  const prose = text.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ");
  const found = new Map<string, ParsedEmoji>();

  for (const match of prose.matchAll(EMOJI)) {
    const customId = match[2];
    const emoji = customId ? `custom:${customId}` : match[0].replace(VARIATION_SELECTOR, "");
    const entry = found.get(emoji);
    if (entry) entry.count += 1;
    else found.set(emoji, { emoji, name: customId ? (match[1] ?? null) : null, count: 1 });
  }

  return [...found.values()];
}
