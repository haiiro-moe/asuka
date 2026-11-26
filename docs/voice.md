# Voice

How Asuka talks in Discord: colours, wording, and how message templates are stored. The web UI follows the
same voice ([web-ui.md](web-ui.md)); cards are in [cards.md](cards.md).

## Accent palette

Discord containers take an accent colour. The `Accent` keys in `src/core/components.ts` keep their names
and carry Rosé Pine values, one job each, so the haiiro tokens and Discord agree:

| Key | Value | Token | Job |
|---|---|---|---|
| `primary` | `0x31748f` | pine | default frame, neutral info |
| `success` | `0x9ccfd8` | foam | worked, approved |
| `warning` | `0xf6c177` | gold | the one thing that needs a look |
| `danger` | `0xeb6f92` | love | destructive or failed |
| `star` | `0xf6c177` | gold | starboard, leaderboard |
| `club` | `0xc4a7e7` | iris | clubs |
| `election` | `0xebbcba` | rose | elections, the presidency |

Pine is a bar only, never text. Per-message accents a user picks in the web editor are data and stay as
typed.

## Voice rules

- **Lowercase**: titles, labels, buttons, field keys (`**when:**`), sentence starts. Proper names keep their
  case inside a sentence (AniList, Tatsu, user and club names). Units stay `SC` and `XP`.
- **Narrator**: short, calm, second person where it addresses the reader. Full stops, not em-dash asides.
- **Glyphs**: `»` for lists and arrows, `@` in prompts, `★` leaderboard and starboard, `✓` done, `×` failed
  or remove, `☼` events and reminders. No other emoji in text the bot writes.
- **No exclamation marks.**
- **Dates**: `4 Nov 2026`.
- **Buttons** are words: `previous`, `next`, `sign up`, `accept`. The clicked button shows `loading…`
  (`ackButtonLoading` in `components.ts`), with no emoji.
- Accent carries success or failure; titles do not need a `✓` or `×` prefix.

## Templates: defaults and edits

Admin-editable messages are catalogued in `src/core/messages.ts` (key, label, params, `defaultComponents`).

- `getMessagePayload(key)` returns the stored override if there is one, otherwise a clone of the code
  default.
- Overrides live in the `bot_messages` table (`key`, `components`, `updatedAt`). A row is written only by
  the web editor's PUT (`src/web/message-routes.ts`) and removed by DELETE (`reset to default`). Nothing
  copies defaults into the database.
- So **an edited template always wins and is never touched by a code change**; changing a default in code
  only affects keys with no row. There is no migration. To restyle an edited template, edit it in the web UI
  or reset it.
- Keep `key`, param names and button ids stable; renaming a `{param}` breaks stored templates.

## What is left alone, and why

- **Slash command names, options and descriptions**: command metadata registered with Discord; descriptions
  stay sentence case.
- **Catalog `label`, `description`, `category`**: shown in the web editor, not in Discord.
- **`customId` prefixes** (`lb:`, `pf:`, `club:`, `ev:`): matched by listeners.
- **`CENSOR_RULE_NAME = "Asuka Censor"`**: used to find the existing AutoMod rule.
- **Stored mod-log reasons**: data already in `mod_log`; rewording would make history inconsistent.
- **`VOTE_EMOJI` and the archive prefix in club channel names**: matched in code and visible as data.
- **Starboard emoji** (`cfg.starboardEmoji`): admin-configured data.
- **AniList text** (titles, genres, descriptions, API errors) and user-written auto-replies: content, not copy.
- **Audit-log reasons, `console.*` logs, developer-style API errors**: not Discord messages.
- **Progress-bar glyphs** (`▰▱`) and `•` bullets in a few text fallbacks: text glyphs, not emoji.
