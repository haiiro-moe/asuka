# Activity analytics

The `activity` plugin (`src/plugins/activity/`) records what happens in the guild as a raw,
timestamped event log, then reads that log into tiered dashboard views and a yearly Wrapped. This
page is the overview and the index. The detail lives in `docs/activity/`.

## The three tiers

Every view belongs to one tier, and the tier decides what it may show. The routes enforce it with
their `access` field, and the web pages with `minRole`.

| Tier | Who | What it sees |
|---|---|---|
| everyone | every signed-in member | server-wide stats, with names; the personal numbers are in the Wrapped and `/profile` ([queries-user.md](activity/queries-user.md)) |
| president | the elected president (admins too) | numbers only: never a name, an id or a list of people, and no count of one or two members ([queries-president.md](activity/queries-president.md)) |
| admin | admins | every view with names, the relationship web, drift, moderation and the controls for the backfill and the Wrapped ([queries-admin.md](activity/queries-admin.md)) |

The president routes import only the president query module, so a handler has no way to build a
response with a name in it. A test reads the route file and fails on any other import.
`src/plugins/activity/privacy-sweep.test.ts` calls every president route in both periods on seeded
data and checks the JSON for ids, names and small counts.

## What is recorded, and what is not

Raw event tables, one row per event (tables and columns in [foundation.md](activity/foundation.md)):

| Table | Holds |
|---|---|
| `activity_messages` | who wrote where and when, reply target, attachment kinds, link domains, sticker count, text length |
| `activity_mentions` | mention edges between members |
| `activity_emoji` | emoji used in message text, with a count per message |
| `activity_reactions` | reactions, with a removal timestamp instead of a delete |
| `activity_voice` | voice sessions per member and channel, with mute, deafen, stream and video flags |
| `activity_membership` | joins and leaves |
| `activity_commands` | slash command runs and whether they succeeded |
| `activity_credits` | the Social Credits ledger (signed delta and balance after) |

**No message content is stored.** The text is read to take its length, its emoji and the domains it
links to, then dropped. Bots are never recorded as actors. Events from other guilds, and DMs, are
ignored, and so are private threads. Capture is gated on `guild_config.activityEnabled`, which is **off
by default** (and was turned off on existing installs by migration 0023); see
[capture.md](activity/capture.md).

## First run

Recording starts off, so nothing is captured before an admin has decided what to leave out:

1. **Set the excluded channels first** (settings tab): staff channels and any private channels the
   members would not expect to be counted. Private threads are always skipped.
2. **Then turn recording on** (`activityEnabled`, same tab). Live capture starts from that moment.
3. **Then run the backfill** (data tab) to read the history from before that moment.

The backfill is **not** gated on `activityEnabled`: an admin can start it while recording is off,
and it still applies the exclusion list and skips private threads. Run it after step 1 so excluded
channels are never read.

## Channel exclusion

`guild_config.activityExcludedChannelIds` (a comma-separated list, edited on the dashboard's
settings tab) names channels that are left out. A **thread follows its parent**: a thread under an
excluded channel is excluded too. Capture and the backfill write nothing for them, and every
query hides them, including rows written before the channel was excluded.

## The voice rule

Everything derived from voice stays hidden until the voice log holds **two whole UTC calendar
months** of data (`voice-ready.ts`). Until then voice figures are `null`, never 0, and no other
number uses voice: active members, groups, quiet members and club activity come from messages
alone. The date voice unlocks is in `GET /api/activity/user/voice-status`. See
[foundation.md](activity/foundation.md#shared-helpers) and the voice rule in
[queries-president.md](activity/queries-president.md).

## Running the backfill

Live capture only sees what happens while the bot runs. The backfill reads channel history from
Discord into the same log. An admin starts it from the dashboard: **diagnostics**, the **data** tab,
the backfill modal. It can also be started with `POST /api/activity/backfill` (admin only; body
`{ "reactions": true }` to read reactions as well), stopped with `POST /api/activity/backfill/stop`
and watched with `GET /api/activity/backfill`. It is resumable and safe to repeat. See
[backfill.md](activity/backfill.md).

## The Wrapped lifecycle

The yearly Wrapped is run by hand, by an admin, in three manual steps. Nothing runs by itself, and
nothing is sent until an admin says so. Use the **data** tab of the diagnostics page, or the
`/wrapped` command.

1. **Process** (`/wrapped start`): builds every member's snapshot and the server's, makes the links.
   Nobody is written to and nothing is announced.
2. **Send DMs** (`/wrapped send`): DMs each opted-in member their personal link,
   `/wrapped/<token>`. Members opt in with the sign-up message or `/wrapped optin`.
3. **Post the announcement** (`/wrapped announce`): posts the public server link,
   `/wrapped/s/<token>`, to the announcement channel.

Sign-ups (a message with buttons, closable and reopenable) and the public server link are part of
the same flow. An admin can also run a **private preview**: `/wrapped preview` or the preview
section of the Wrapped panel sends the admin the exact DMs, announcement and server link a real run
would, without touching any member, and it expires after 14 days. See [wrapped.md](activity/wrapped.md)
and [web-wrapped.md](activity/web-wrapped.md) for the story pages.

## Adding a view or a page

- **A view** (a new number or list): add the query in the tier's `queries/<tier>.ts`, the response
  type in `types/<tier>.ts` (types only, no imports, so the web app can share them), and the route
  in `api/<tier>.ts`. A new president route must keep the privacy rules in
  [queries-president.md](activity/queries-president.md); the privacy sweep finds it by
  `access === "president"` and fails if it leaks.
- **A page or panel**: each tier file in `src/web/app/activity/<tier>/pages.tsx` exports an array of
  `{ id, label, el, minRole? }` that `ACTIVITY_PAGES` spreads into `PAGES`. Add a narrator lede for
  the id in `App.tsx`. See [web.md](activity/web.md) for the registry, chart wrappers and the
  `useActivity` hook, and [web-ui.md](web-ui.md) for the design system rules and
  how to add a page. Build from `src/web/app/ui/`; do not invent one-off controls.

## Index

| File | Covers |
|---|---|
| [foundation.md](activity/foundation.md) | the tables, config columns, shared helpers (periods, voice readiness, exclusion, privacy), the write API, the seed script and the plugin layout |
| [capture.md](activity/capture.md) | live capture: gateway listeners, the voice heartbeat and the command and credit hooks |
| [backfill.md](activity/backfill.md) | reading channel history from Discord into the log: routes, what is read, resuming |
| [queries-user.md](activity/queries-user.md) | the everyone-tier routes and shapes |
| [queries-president.md](activity/queries-president.md) | the president tier and its privacy rules: hidden small counts, fixed periods, no subtraction |
| [queries-admin.md](activity/queries-admin.md) | the admin tier, with names |
| [wrapped.md](activity/wrapped.md) | Wrapped server side: snapshots, links, the three steps, sign-ups, DMs, cards, `/wrapped`, routes and the private preview |
| [web.md](activity/web.md) | the activity web shell: page registry, chart wrappers, data hook, config controls |
| [web-user.md](activity/web-user.md) | the everyone-tier page |
| [web-president.md](activity/web-president.md) | the president page, numbers only |
| [web-admin.md](activity/web-admin.md) | the admin diagnostics page, backfill and Wrapped controls |
| [web-wrapped.md](activity/web-wrapped.md) | the public Wrapped story pages for a member and for the server |
