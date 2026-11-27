/**
 * Pure helpers behind {@link ChannelSelect}, {@link ChannelMultiSelect} and {@link RoleSelect}: the shape of
 * `GET /api/guild-options`, the comma-list codec of the multi-channel setting, and the option lists the
 * pickers hand to {@link Select}. Nothing here touches React or the DOM, so it is unit-tested directly
 * (`channel-ids.test.ts`).
 *
 * @module
 */
import type { SelectOption } from "./Select.tsx";

/** What kind of Discord channel an entry of `GET /api/guild-options` is. */
export type GuildChannelKind = "text" | "announcement" | "voice" | "stage" | "forum" | "category";

/** One channel of the guild, as `GET /api/guild-options` lists it (Discord order, threads excluded). */
export interface GuildChannel {
  id: string;
  name: string;
  kind: GuildChannelKind;
  /** The id of the category it sits in, or null at the top level. */
  parentId: string | null;
  /** The name of that category, or null at the top level. */
  parentName: string | null;
  position: number;
}

/** One role of the guild, as `GET /api/guild-options` lists it (highest first, `@everyone` excluded). */
export interface GuildRole {
  id: string;
  name: string;
  /** The role colour as a Discord integer; 0 means no colour. */
  colour: number;
  position: number;
  /** True for roles owned by a bot or an integration. */
  managed: boolean;
}

/** The response of `GET /api/guild-options`. Both lists are empty when the guild is not cached. */
export interface GuildOptions {
  channels: GuildChannel[];
  roles: GuildRole[];
}

/** Channel kinds a message can be posted to: the single-channel settings offer these. */
export const POSTABLE_KINDS: readonly GuildChannelKind[] = ["text", "announcement"];

/** The category picker offers categories only. */
export const CATEGORY_KINDS: readonly GuildChannelKind[] = ["category"];

/**
 * Kinds the activity recorder can skip. Categories are left out on purpose: the recorder matches a channel
 * or a thread's parent, never a category, so a category id would do nothing.
 */
export const ACTIVITY_KINDS: readonly GuildChannelKind[] = ["text", "announcement", "voice", "stage", "forum"];

/** The value of the "nothing chosen" row of a single picker. Saving it clears the setting. */
export const NONE_VALUE = "";

/**
 * Splits a stored comma list of ids (`a,b,c`) into ids: trimmed, empty entries dropped, repeats removed
 * with the first occurrence kept. Order is preserved.
 *
 * @param raw - The stored string; null and undefined count as empty.
 * @returns The ids in saved order.
 */
export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw).split(",")) {
    const id = part.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Joins ids into the canonical stored form `a,b,c`: trimmed, de-duplicated (first occurrence wins), no
 * spaces and no trailing comma. The inverse of {@link parseIdList}.
 *
 * @param ids - Ids to store; blanks are dropped.
 */
export function joinIdList(ids: readonly string[]): string {
  return parseIdList(ids.join(",")).join(",");
}

/**
 * The text of a channel in a picker: `# name` for text and announcement channels, `name (voice)` and so on
 * for the rest, and a bare `name` for a category. Lowercase marker words, no emoji.
 */
export function channelLabel(c: Pick<GuildChannel, "name" | "kind">): string {
  switch (c.kind) {
    case "text":
    case "announcement":
      return `# ${c.name}`;
    case "category":
      return c.name;
    default:
      return `${c.name} (${c.kind})`;
  }
}

/** The text shown for an id that is not in the guild's list: `unknown · <id>`. */
export function unknownLabel(id: string): string {
  return `unknown · ${id}`;
}

/**
 * Builds the choices of a channel picker: the channels of the wanted kinds in the order given (the server
 * sends Discord order), each labelled with {@link channelLabel} and the parent category's name as `meta`.
 *
 * @param channels - The guild's channels.
 * @param kinds - The kinds to offer.
 * @param skip - Ids to leave out (the multi picker passes the ones already chosen).
 */
export function channelChoices(
  channels: readonly GuildChannel[],
  kinds: readonly GuildChannelKind[],
  skip: ReadonlySet<string> = new Set(),
): SelectOption<string>[] {
  return channels
    .filter((c) => kinds.includes(c.kind) && !skip.has(c.id))
    .map((c) => ({ value: c.id, label: channelLabel(c), meta: c.parentName ?? undefined }));
}

/**
 * Roles in the order a picker lists them: the server's order (highest position first) with bot-managed
 * roles moved to the end. The sort is stable.
 */
export function orderRoles(roles: readonly GuildRole[]): GuildRole[] {
  return [...roles.filter((r) => !r.managed), ...roles.filter((r) => r.managed)];
}

/**
 * A Discord role colour as `#rrggbb`, or undefined for 0 (no colour, which a swatch shows as the base colour).
 */
export function roleHex(colour: number): string | undefined {
  if (!Number.isFinite(colour) || colour <= 0) return undefined;
  return `#${(colour & 0xffffff).toString(16).padStart(6, "0")}`;
}

/**
 * Wraps a single picker's choices for a clearable setting. The first row is `none` (value
 * {@link NONE_VALUE}). When `value` is set but missing from `choices` (a deleted channel or role), an
 * `unknown · <id>` row follows so the stored id stays visible and is kept on save until the user clears it.
 *
 * @param choices - The real choices.
 * @param value - The stored id; empty or null means nothing chosen.
 * @param noneLabel - The text of the clearing row. Default `none`.
 */
export function withNoneAndUnknown(
  choices: SelectOption<string>[],
  value: string | null | undefined,
  noneLabel = "none",
): SelectOption<string>[] {
  const head: SelectOption<string>[] = [{ value: NONE_VALUE, label: noneLabel }];
  const id = (value ?? "").trim();
  if (id && !choices.some((o) => o.value === id)) head.push({ value: id, label: unknownLabel(id) });
  return [...head, ...choices];
}

/** One chip of the multi-channel picker. */
export interface ChosenChannel {
  id: string;
  /** The label to show: the channel's, or `unknown · <id>`. */
  label: string;
  /** True when the id is not among the guild's channels of the offered kinds. */
  unknown: boolean;
}

/**
 * Resolves the stored ids of the multi picker to chips, in saved order. An id that is not a channel of the
 * offered kinds (deleted, or a kind the picker does not offer) is marked unknown but kept.
 *
 * @param ids - The ids from {@link parseIdList}.
 * @param channels - The guild's channels.
 * @param kinds - The kinds the picker offers.
 */
export function chosenChannels(
  ids: readonly string[],
  channels: readonly GuildChannel[],
  kinds: readonly GuildChannelKind[],
): ChosenChannel[] {
  const byId = new Map(channels.filter((c) => kinds.includes(c.kind)).map((c) => [c.id, c]));
  return ids.map((id) => {
    const c = byId.get(id);
    return c ? { id, label: channelLabel(c), unknown: false } : { id, label: unknownLabel(id), unknown: true };
  });
}
