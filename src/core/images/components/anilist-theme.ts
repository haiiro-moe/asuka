import { color } from "./haiiro/tokens.ts";
import { toneColor, type Tone } from "./haiiro/text.tsx";

/**
 * AniList card colours as haiiro token jobs. The keys are the old AniList-palette names so
 * cards that still read `AL.*` keep compiling; every value is now a Rosé Pine token.
 *
 * @deprecated for new code: use `Tone` names and `color` from `haiiro/tokens.ts`, and the
 * helpers below. Kept until the AniList cards have moved to the haiiro primitives.
 */
export const AL = {
  /** Page background: `color.base`. */
  bg: color.base,
  /** Card/window fill: `color.surface`. */
  card: color.surface,
  /** Raised layer: `color.overlay`. */
  overlay: color.overlay,
  /** Readable secondary text: `color.subtle`. */
  text: color.subtle,
  /** Labels: `color.muted`. */
  textLight: color.muted,
  /** Quiet footer text: `color.muted`. */
  textLighter: color.muted,
  /** Headings and names: `color.text`. */
  heading: color.text,
  /** Former AniList blue (links, accents): `color.foam`. */
  blue: color.foam,
  /** Former AniList green (good): `color.foam`. */
  green: color.foam,
  /** Former AniList red (favourites, bad): `color.love`. */
  red: color.love,
  /** Former AniList orange (middling): `color.gold`. */
  orange: color.gold,
} as const;

/** AniList profile colour names (`User.options.profileColor`) mapped to the nearest token job. */
const PROFILE_TONES: Record<string, Tone> = {
  blue: "foam",
  purple: "iris",
  green: "foam",
  orange: "gold",
  red: "love",
  pink: "rose",
  gray: "subtle",
};

/**
 * Tone for an AniList user's profile colour. Named colours map to the nearest token;
 * custom hex colours are off-palette and fall back to `foam`.
 *
 * @param profileColor - AniList `profileColor` (a name or `#hex`), or null.
 * @returns A tone name.
 */
export function profileTone(profileColor: string | null | undefined): Tone {
  if (!profileColor || profileColor.startsWith("#")) return "foam";
  return PROFILE_TONES[profileColor.toLowerCase()] ?? "foam";
}

/**
 * CSS colour for an AniList profile colour: {@link profileTone} resolved through the tokens.
 * Never returns the user's own hex.
 *
 * @param profileColor - AniList `profileColor` (a name or `#hex`), or null.
 * @returns A token colour.
 */
export function profileAccent(profileColor: string | null | undefined): string {
  return toneColor(profileTone(profileColor));
}

/**
 * Tone for an AniList score (0-100): 75 and up `foam`, 50-74 `gold`, under 50 `love`.
 *
 * @param score - Average or mean score, 0-100.
 * @returns A tone name.
 */
export function scoreTone(score: number): Tone {
  if (score >= 75) return "foam";
  if (score >= 50) return "gold";
  return "love";
}

/**
 * CSS colour for an AniList score, see {@link scoreTone}.
 *
 * @param score - Average or mean score, 0-100.
 * @returns A token colour.
 */
export function scoreColor(score: number): string {
  return toneColor(scoreTone(score));
}

/**
 * Tone for a media's release status (`Media.status`), by colour job: airing now is a live
 * value (`foam`), finished is plain (`text`), not yet released is upcoming (`gold`),
 * cancelled failed (`love`), on hiatus is quiet (`subtle`).
 *
 * @param status - `RELEASING`, `FINISHED`, `NOT_YET_RELEASED`, `CANCELLED`, `HIATUS`, or null.
 * @returns A tone name (`subtle` for unknown).
 */
export function mediaStatusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "RELEASING":
      return "foam";
    case "FINISHED":
      return "text";
    case "NOT_YET_RELEASED":
      return "gold";
    case "CANCELLED":
      return "love";
    default:
      return "subtle";
  }
}

/**
 * Tone for a list entry's status (`MediaList.status`): watching/reading or rewatching is
 * the current thing (`foam`), completed is media (`iris`), planning is next up (`gold`),
 * dropped failed (`love`), paused is quiet (`subtle`).
 *
 * @param status - `CURRENT`, `REPEATING`, `COMPLETED`, `PLANNING`, `DROPPED`, `PAUSED`, or null.
 * @returns A tone name (`subtle` for unknown).
 */
export function listStatusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "CURRENT":
    case "REPEATING":
      return "foam";
    case "COMPLETED":
      return "iris";
    case "PLANNING":
      return "gold";
    case "DROPPED":
      return "love";
    default:
      return "subtle";
  }
}
