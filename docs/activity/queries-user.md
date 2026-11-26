# Activity analytics: everyone-tier views

Queries in `src/plugins/activity/queries/user.ts`, routes in `api/user.ts`, shapes in
`types/user.ts`. Every route is `GET`, `access: "user"`, and takes `?period=` (`7d`, `week`, `30d`
(default), `term`, `year`, `all`); an unknown value answers 400 `{ "error": ... }`.

All buckets are UTC and weekday 0 is Monday. Excluded channels, and every thread under one, are
hidden from every view, including rows written before the channel was excluded. An empty log gives
empty arrays and a zero heatmap.

| Route | Query | Meaning |
|---|---|---|
| `/api/activity/user/rhythm` | `rhythm` | Two 7x24 heatmaps: messages per cell, and connected voice hours per cell (a segment is spread over the hours it covers); `voice` is `null` until voice is ready. `max` is the largest cell. |
| `/emoji` | `emojiLeaderboard` | Top emoji (20): text uses plus reactions still standing. Keys are the stored form: a unicode character or `custom:<id>`. |
| `/emoji-trend` | `emojiTrend` | Weekly uses of the top 5 emoji, 7-day buckets from the period start (from the first use for `all`). |
| `/emoji-graveyard` | `emojiGraveyard` | The guild's custom emoji ids never used in text or as a reaction, all time. The route reads the ids from the guild cache. |
| `/reacted` | `mostReacted` | Top 10 messages by net reactions (added minus removed), with channel and author id. |
| `/channels` | `channelFavourites` | Channels by messages. A thread ranks as a channel of its own (`parentChannelId` set); a thread under an excluded channel is hidden. The route adds `name` and `parentName` from the guild channel cache (null when unknown). |
| `/voice` | `voiceFavourites` | Empty until voice is ready. Voice channels (names added like `/channels`) by connected seconds inside the period; an open segment runs to its last heartbeat. |
| `/voice-status` | `voiceReadiness` | `{ ready, readyAt }`: whether the voice views are unlocked and, if not, when (null with no voice recorded). Takes no period. Pages use it to say "voice stats unlock on <date>". |
| `/sharing` | `sharing` | Images, videos, audio, stickers, gifs (tenor and giphy domains) and links per domain. |
| `/awards` | `awards` | See below. |

## Awards

Awards and the most-reacted leaderboard (`/reacted`, author ids) are the only views that name a member (user ids only). An award nobody
qualifies for is omitted.

- `night-owl`: most messages 00:00 to 04:59 UTC.
- `earliest-bird`: most messages 05:00 to 07:59 UTC.
- `longest-voice`: the longest closed voice segment, in seconds.
- `fastest-replier`: lowest median of reply time minus parent time, with at least 10 replies; replies
  whose parent was not recorded are skipped.
- `most-replied-to`: most replies received from other members.

Ties go to the lower user id.

## Voice readiness

Everything derived from voice is withheld until the voice log holds two whole UTC months
(`voice-ready.ts`, `voiceReadiness()`). Until then `rhythm.voice` is `null`, `voiceFavourites`
returns `[]` and `awards` leaves out `longest-voice`; nothing is zero-filled. Message views are not
affected. The routes check readiness once per request; the query functions take it as a `voiceOk`
argument (default: a fresh check) so a caller can reuse one result.
