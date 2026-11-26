# Activity analytics: president tier

The president sees how the server is doing, never who is doing what. This page covers the
president-tier queries and routes of the `activity` plugin: what they return, how each number is
defined, and the privacy rules that everything on this tier has to keep. Read
[foundation.md](foundation.md) first for the tables, the periods and the shared helpers.

| File | Holds |
|---|---|
| `src/plugins/activity/queries/president.ts` | The five queries, the fixed periods, the rules for what may be shown (`showAlone`, `showBeside`) and the tuning constants. |
| `src/plugins/activity/groups.ts` | `detectGroups` and `countBridges`: pure group detection, no database. |
| `src/plugins/activity/api/president.ts` | `presidentRoutes`, the five HTTP routes. |
| `src/plugins/activity/types/president.ts` | The response types. Types only, no imports, so the web app can import it. |
| `queries/president.test.ts`, `groups.test.ts` | The tests, including the privacy invariants. |

## Privacy rules

These are the contract. A change that breaks one of them is a bug, however useful the new number
would be.

### 1. No identity leaves the query module

- A response holds numbers, lists of numbers and `null`. There is no string in any of them, so there
  is nowhere a name or an id could be.
- Member and channel ids are read inside `queries/president.ts` to count and to group. Only sizes
  and counts are returned. The group lists that `detectGroups` returns are turned into sizes before
  they leave `memberWeb`.
- Lists are ordered by something that says nothing about people: group sizes largest first, weeks
  oldest first.
- **The route file imports only `queries/president.ts`** (and `groups.ts` if it ever needs it), plus
  types. It must not import `queries/admin.ts`, `queries/user.ts`, the database or the tables, so a
  handler has no way to build a response with a name in it. `president.test.ts` reads the route
  file's source and fails on any other import.
- A handler never lets an error out. An error's text can quote ids, and an uncaught error is shown
  to the caller when the server runs in development mode. The cause is logged on the server and the
  president gets `500 { "error": "internal error" }`. The 400 for a bad period does not repeat the
  value it was given.

### 2. No count of one or two members

"1 member went quiet" points at a person. Every number that counts members, or pairs of members,
goes through `hideSmall` and is `null` at 1 and 2. `null` means **hidden**, not zero: the dashboard
draws it as "off". A real 0 is sent as 0, because it identifies nobody.

| Field | Counts | Hidden when (in either period) |
|---|---|---|
| `connection.connected` | members | never 1 or 2 by construction (a sum of groups of 3 or more) |
| `connection.total`, `engagement.activeMembers` | members | `groups.other` is hidden |
| `connection.bridges` | pairs of members | 1 or 2 |
| `connection.quiet` | members | 1 or 2 |
| `groups.sizes` | members per group | groups under 3 are not listed at all |
| `groups.other` | members | 1 or 2 |
| `clubs.clubsActive`, `clubs.clubsQuiet` | clubs | either of the two is 1 or 2 (both are hidden together) |
| `clubs.avgAttendance` | members per event | above 0 and under 3 |

The longer of the two periods hides more than this: see rule 5.

**A pair, or a member tied to nobody, is never shown as such.** There is no count of pairs and no
count of unconnected members. They only ever count into `groups.other` and the totals, and only
when those can be shown.

Not hidden, because they do not count members: `connection.groups` (a count of groups that each
have 3 or more members), `engagement.messages`, `engagement.voiceHours`, `weekly.replies`,
`weekly.voiceHours` and `clubs.eventsHeld`. A privacy sweep that looks for "a 1 or a 2 anywhere"
has to skip these.

### 3. A hidden count cannot be recovered by subtraction

Hiding a number is worth nothing if two other numbers give it back. The rule that prevents it:

> **A hidden count never enters a published number.**

The active members of a period are split into parts that do not overlap: each group of 3 or more is
one part, and **everyone else is one single remainder** (members of a pair, and members tied to
nobody). The remainder is `groups.other`. Every published member count is a sum of whole parts:

| Published | Is |
|---|---|
| `groups.sizes[i]` | one group |
| `connection.connected` | all groups |
| `groups.other` | the remainder |
| `connection.total` = `engagement.activeMembers` | all groups + the remainder |

When the remainder is 1 or 2 it is hidden, and then `total` and `activeMembers` are hidden as well,
because `total - connected` would be exactly the remainder. What is left (`sizes`, `connected`)
does not contain it, so no arithmetic on what is left can produce it. When the remainder is 0 or at
least 3, everything is shown and `total - connected - other` is 0: the only member counts the
numbers imply are sums of whole parts, each 0 or at least 3.

There is one remainder on purpose. With pairs and lone members as two separate hidden numbers, a
shown sum of the two could give one of them away.

The same reasoning is applied to the clubs: `clubsActive + clubsQuiet` is the number of approved
clubs, which every member can see on the clubs page. If only one of the two were hidden, that public
number would give it back, so both are hidden when either is 1 or 2.

`connection`, `groupSizes` and `engagement` all take their member counts from one place
(`memberView` in `queries/president.ts`, which applies `showAlone` or `showBeside`). Keep it that
way: a second place that counts active members could disagree with the first by exactly the hidden
remainder.

### 4. Fixed periods only

A president route accepts `?period=week` or `?period=term`, and `week` when the parameter is
missing. Anything else, including the other activity periods (`7d`, `30d`, `year`, `all`) and the
empty string, is `400 { "error": "period must be week or term" }`.

| Value | Period (`from` inclusive, `to` exclusive) |
|---|---|
| `week` | the seven full UTC days before today: today 00:00 UTC minus 7 days, up to today 00:00 UTC |
| `term` | `president.termStart` up to today 00:00 UTC. Without a term on record, the 90 days before today 00:00 UTC. A term that began today is empty. |

Neither ends at "now". A window that ends now moves with every request, and two requests a few
minutes apart could be subtracted to see what one member did in between. These periods move once a
day, at 00:00 UTC, so two requests on the same UTC day return identical numbers. The price is that
the numbers are up to a day old.

`presidentPeriod(value, now?)` builds them, and `presidentScope(value, now?)` wraps the period a
request asks for together with the other one when that is the shorter (rule 5). `presidentScope`
is the only period source a president route may use; `parsePeriodParam` is for the other tiers.

What makes the past hold still:

- Live capture only writes rows stamped now, which is after the period's end.
- A voice segment that is still open counts as running to the end of the period, not to its last
  heartbeat, so the heartbeat does not move the voice hours.
- Membership changes, events and sign-ups stamped after the period's end are ignored.

What can still change a past period: the history backfill adding old messages, an admin changing
the excluded channels, a new term start, and the three tables that keep no history (see
"Known limits").

### 5. The two periods cannot be subtracted from each other

Both periods end at the same moment, so one always lies inside the other: usually the week inside
the term, and in the first days of a term the term inside the week. Every member of the shorter
period is a member of the longer one. "15 active this week, 16 this term" therefore says that
exactly one member was active earlier in the term and not since, as plainly as a count of 1 would.

The rule (`presidentScope` picks the shorter period, `showBeside` applies it):

> **The shorter period is shown as it is. A number of the longer period that is 1 or 2 away from
> the same number of the shorter period is hidden, together with everything it could be rebuilt
> from.**

It is applied to every count of members, pairs or clubs that both periods have:

| Number of the longer period | Shown only when |
|---|---|
| a size in `groups.sizes` | the shorter period lists a group of the same size (each of its groups is the twin of one group at most), or the size is not 1 or 2 away from **any** size listed for the shorter period. Otherwise the group is left out of the list. |
| all of `groups.sizes` | the groups do not add up to 1 or 2 more or less than the shorter period's `connected`. Otherwise none is listed. |
| `connection.connected` | every group is listed. With one left out, the true number would give its size away. |
| `groups.other`, `connection.total`, `engagement.activeMembers` | `connected` is shown, the shorter period shows its own `other` and `total`, and neither `other` nor `total` is 1 or 2 away from the shorter period's. The three are shown or hidden together. |
| `connection.bridges` | it is not 1 or 2 away from the bridges shown for the shorter period. |
| `connection.quiet` | it is not 1 or 2 away from the shorter period's. Today the two are always equal, because both are judged at the shared end. |
| `clubs.clubsActive`, `clubs.clubsQuiet` | neither is 1 or 2 away from the shorter period's. |
| `clubs.avgAttendance` | the occurrences outside the shorter period would, taken alone, have an average that may be shown. Otherwise `average x held` of the two periods could be subtracted to get the one or two sign-ups of a single event. |

Three things about it that are easy to get wrong:

- **A group that is left out is counted nowhere.** It is not folded into `other`: that would put a
  hidden size into a shown number. `connected`, `other` and `total` are hidden with it.
  `connection.groups` still counts it, because a count of groups is not a count of people, so the
  page can say "3 groups" next to two bars.
- **The longer period shows no total when the shorter period shows none.** Next to a hidden total,
  a shown one can pin the hidden one down: if the week shows a group of 8 and hides "one or two
  more", a term total of 9 says that it was exactly one more, because the week's members are all in
  the term.
- **Only what the shorter period shows is looked at, never what it hides.** A rule that compared
  against a hidden number would give that number away through what it lets through.

For the longer period `null` therefore does not mean "1 or 2". It means hidden: for being small,
or for being too close to the other period's number.

The rule is checked by enumeration (`president.test.ts`, "every pair of small periods"). For every
pair of periods with up to three groups of 3 to 8 members and up to 10 members outside them, the
test confirms that what is shown keeps the table above, and that nothing hidden (either period's
remainder, the members active only outside the shorter period, the difference in connected members,
a group that is left out) has only one value that fits what is shown.

What the rule does not cover: `engagement.messages`, `weekly.replies`, the voice hours and
`clubs.eventsHeld` count messages, hours and events, not people, and are shown for both periods as
they are. Their difference is the same kind of number, for the part of the longer period that lies
outside the shorter one.

The cost is that the term's group picture is often incomplete. A circle that had one or two more
members earlier in the term than in the last week is exactly what must not be shown, and that is
common.

### 6. Excluded channels

Every query filters with `notExcluded(channelColumn, parentColumn)`: `activity_messages` with its
parent column, so a thread under an excluded channel is hidden too, and `activity_voice` with its
channel column only. A channel excluded today drops out of the next request, for past periods as
well.

## Routes

All are `GET`, `access: "president"` (admins pass too), and take `?period=week|term`.

| Route | Query | Response type |
|---|---|---|
| `/api/activity/president/connection` | `connection(scope)` | `PresidentConnection` |
| `/api/activity/president/weekly` | `weeklySeries(scope)` | `PresidentWeeklySeries` |
| `/api/activity/president/groups` | `groupSizes(scope)` | `PresidentGroupSizes` |
| `/api/activity/president/engagement` | `engagement(scope)` | `PresidentEngagement` |
| `/api/activity/president/clubs` | `clubEventHealth(scope)` | `PresidentClubEventHealth` |

Every query takes the `PresidentScope` of the request, from `presidentScope(value, now?)`: the
period, and the shorter period when the request is for the longer one. A handler builds it once.

```jsonc
// GET /api/activity/president/connection?period=week
{ "connected": 11, "total": 14, "groups": 2, "bridges": 4, "quiet": 3 }

// GET /api/activity/president/groups?period=week
{ "sizes": [7, 4], "other": 3 }

// GET /api/activity/president/weekly?period=week
{ "replies": [39, 29], "voiceHours": [19.5, 11.1] }

// GET /api/activity/president/engagement?period=week
{ "messages": 443, "activeMembers": 14, "voiceHours": 30.6 }

// GET /api/activity/president/clubs?period=week
{ "clubsActive": null, "clubsQuiet": null, "eventsHeld": 2, "avgAttendance": 4 }

// GET /api/activity/president/connection?period=term, with one group left out (rule 5)
{ "connected": null, "total": null, "groups": 3, "bridges": 8, "quiet": 3 }

// GET /api/activity/president/groups?period=term, the same day
{ "sizes": [12, 4], "other": null }
```

`presidentRoutes` is what `api.ts` collects. `createPresidentRoutes(now)` builds the same routes
around a clock, which is how the tests pin the day.

## What the numbers mean

### Active members

A member is **active** in a period when they wrote at least one message or spent time in a voice
channel in it, outside the excluded channels. Being mentioned or answered does not make a member
active.

### Ties

Two active members are **tied** when, in the period, they answered each other or sat in the same
voice channel:

- one reply, in either direction, weighs 1;
- shared voice time weighs 1 per 10 minutes (`VOICE_TIE_SECONDS`), measured inside the period;
- the two are added, and a tie needs a weight of at least 1 (`MIN_TIE_WEIGHT`), so one reply is
  a tie and five minutes in the same channel are not.

Not a tie: a mention (the ping of a reply is not even recorded as one), a reply to a bot, a reply to
oneself, and a reply to a member who was not active in the period (someone answering an old message
of a member who has since gone silent does not pull that member back in).

### Groups

`detectGroups(edges)` splits the tied members into groups by **deterministic label propagation**:

1. Each tie gets a strength: its weight on a log scale (`log2(1 + weight)`), plus, for every
   contact the two members share, the weaker of their two ties to that contact. The log scale
   keeps two members who answer each other hundreds of times from being split off as a group of
   their own. The shared contacts make a tie inside a circle count for more than a lone tie
   between two circles, so one stray reply does not merge two groups.
2. Every member starts with their own id as label. In the first round, taken by everyone at once,
   each member takes the label of their closest contact.
3. Then the members are visited in sorted id order, again and again. Each takes the label their
   contacts vote for most strongly, a vote being as strong as the tie. A level vote goes to the
   smallest label. It stops when a full sweep changes nothing, or after 100 sweeps.
4. Members with the same label who are connected through each other are one group.

There is no randomness, and the edges are sorted before anything is added up, so the same ties
always give the same groups, in any input order. Two triangles joined by one edge are two groups.

A group is a guess about who talks to whom, good enough for sizes and counts. It is not shown to
anyone as a list of members, on any tier.

### `connection`

| Field | Meaning |
|---|---|
| `connected` | Members in a group of 3 or more. Nothing else: two members who only talk to each other, and a member tied to nobody, are not connected, and are never shown as a number of their own. |
| `total` | Active members: `connected` plus `groups.other`. |
| `groups` | Number of groups of 3 or more. Equals `groups.sizes.length`, except for the longer period when a group is left out of the list (rule 5). |
| `bridges` | Pairs of tied members who are in two different groups of 3 or more. A pair counts once. A tie to a member outside those groups is not a bridge. `countBridges` returns 1 for two triangles joined by one edge. |
| `quiet` | Members who have gone quiet, as of the end of the period. |

**Gone quiet**: a member who was active in the 90 days (`QUIET_LOOKBACK_DAYS`) before the last
30 days (`QUIET_DAYS`), was not active in those last 30 days, and whose last recorded membership
change before the period's end is not a leave. It is judged at the end of the period and does not
depend on where the period starts, so `week` and `term` show the same number.

The 90-day lookback is there because the log cannot tell who is still a member: the backfill
records the old messages of people who left long before recording began, and without a bound they
would count as quiet forever. Someone silent for more than 120 days is gone, not quiet.

This is not the admin tier's `drift` list counted. `drift` is defined over the admin's own period
("active in the previous period, nothing in the last 30 days") and ends now, not at 00:00 UTC, so
the president's number and the length of the admin's list can differ.

### `groups`

`sizes` are the groups of 3 or more, largest first. `other` is everybody active outside them, added
up: pairs and members tied to nobody alike (`mergeSmallGroups`, with every untied member counted as
a group of one). Groups of 14, 9 and 5, a pair and one lone member give
`{ "sizes": [14, 9, 5], "other": 3 }`. For the longer period a group can be missing from `sizes`,
and `other` hidden, under rule 5.

### `weekly`

One entry per **UTC calendar week**, Monday 00:00 to Monday 00:00, for every week the period touches,
oldest first. The buckets are fixed to the calendar, so a week that is over never changes. The first
and the last week can be partial: only the part inside the period is counted. The last entry is the
UTC week that holds yesterday, so the page can label the columns by counting weeks back from that
one. The `week` period touches two calendar weeks unless today is a Monday.

- `replies`: messages that answer another member (not a bot, not oneself).
- `voiceHours`: hours connected to voice, added up over members, one decimal. A session that runs
  across a Monday is split between the two weeks.

### `engagement`

- `messages`: messages written in the period.
- `activeMembers`: the active members. Always the same value as `connection.total`.
- `voiceHours`: hours connected to voice, added up over members, one decimal.

### `clubs`

- `clubsActive` / `clubsQuiet`: approved clubs, created before the period's end, with and without
  activity in the period. A club is active when a message was written in its thread or its channel,
  or in a thread under its channel, or when someone was in its voice channel. Spaces archived by a
  downgrade still count as the club's. A club whose spaces are all excluded from analytics is left
  out of both numbers: nothing about it is measured.
- `eventsHeld`: event occurrences that started in the period, recurring events included.
- `avgAttendance`: members signed up per held occurrence, one decimal. Sign-ups are kept per event,
  not per occurrence, so every occurrence counts the event's sign-ups. 0 when nothing was held or
  nobody signed up.

## Known limits

- **For the shorter period, `null` says "1 or 2".** That is how `hideSmall` is defined in the
  foundation: a hidden number is known to exist, only not whether it is 1 or 2. For the longer
  period it says less, because a number can also be hidden for being close to the shorter period's.
- **Numbers can be compared from one day to the next.** The periods move daily, so `quiet` going
  from 3 to 4 says that one more member crossed the 30-day line that day. Fixed periods make this
  a daily step instead of a minute-by-minute one; they do not remove it.
- **The longer period is often incomplete.** Rule 5 hides a group, and the totals with it, whenever
  a circle differs by one or two members between the week and the term. On a small server that is
  the usual case, so the term view will often show only some of its groups.
- **Rule 5 compares numbers, not people.** A group of the longer period is left out when its size
  is close to any size of the shorter period, whether or not it is the same circle, and is listed
  when the shorter period has a group of exactly its size, whether or not it is the same circle.
  The first hides more than strictly needed. The second is what lets an unchanged circle be shown
  at all: without it, a week with groups of 6 and 4 would blank the same two groups in the term,
  because 6 is 2 away from 4. The page cannot say which week group a term group "is".
- **Counts of messages, replies, hours and events can still be subtracted across the periods.**
  They are not counts of people (see rule 5).
- **Clubs, events and sign-ups have no history.** They are read as they are now. A club approved or
  ended today, an event edited today, or a sign-up withdrawn today changes `clubs` during the day.
  The president causes most of these themselves, and the club list and the sign-ups are visible to
  every member anyway.
- **Voice is read with a scan.** `activity_voice` has no index on `started_at` alone, so each query
  reads the whole table. It is small next to the messages (which are read through the `ts` index,
  period by period). An index would be the first thing to add if voice history grows large.
- **Nothing is cached.** The five routes each read the period again. A cache keyed by the period
  would be safe, since the period is fixed for the day, but it would have to be dropped when the
  backfill runs or the excluded channels change.

## Tuning

All in `queries/president.ts`, except the first two, which the whole plugin shares.

| Constant | Value | Meaning |
|---|---|---|
| `MIN_GROUP` (`privacy.ts`) | 3 | Smallest count of members that may be shown. |
| `QUIET_DAYS` (`time.ts`) | 30 | Days without a message or voice before a member has gone quiet. |
| `QUIET_LOOKBACK_DAYS` | 90 | How long before those days a member must have been active to count. |
| `VOICE_TIE_SECONDS` | 600 | Shared voice time that weighs as much as one reply. |
| `MIN_TIE_WEIGHT` | 1 | Weakest tie that links two members. |

## For the page that draws this

- Draw `null` as "off" (hidden), never as 0 and never as a dash that could be read as "none".
- Do not compute a number the API hides. If `total` is `null`, do not show `connected + other`, and
  do not add anything up to stand in for it. If `connected` is `null`, do not show the sum of the
  bars.
- `connection.groups` can be larger than the number of bars (`groups.sizes.length`): a group can
  be left out of the list for the longer period. Say so ("3 groups, 2 shown"), do not draw an empty
  bar, and do not put the two periods' bars side by side as if they were the same circles.
- The tile for `connected` is "in groups": members in a group of 3 or more.
- The page offers `week` and `term` and nothing else.
- All buckets are UTC, and the page says so.

## Tests

```sh
nix develop -c bun test src/plugins/activity/groups.test.ts src/plugins/activity/queries/president.test.ts
```

The tests that pin the rules above:

| Rule | Test |
|---|---|
| No id, no name, numbers only | "no president response holds an id, a name or anything but numbers": every route, both periods, over data seeded with 18-digit ids; no run of 15 or more digits, no `userId`, `channelId` or `name` key, every leaf a number or `null`. |
| No count of 1 or 2 | "no count of one or two members is ever shown", and one test per field. |
| No recovery by subtraction | "a hidden remainder cannot be recovered by subtraction" tries `total - shown groups`, `total - connected` and `activeMembers - connected` next to a hidden pair and next to hidden lone members; "the published member counts always add up, whatever is hidden". |
| Fixed periods | "two requests minutes apart return identical numbers" (injected clock, live activity recorded in between), "the numbers move once the UTC day has ended". |
| The two periods cannot be subtracted | "a member active earlier in the term but not this week hides the term's total" (15 against 16 in the raw data), "a difference of three or more between the periods is shown", "no difference between the periods is shown", one test each for a group that grew, the sum of the groups, bridges, clubs, attendance and quiet, "when the term is younger than a week, the week is the longer period", "forty scrambled terms: no count is one or two away from the week's", and the two "every pair of small periods" tests on `showBeside` itself. |
| Only `week` and `term` | "routes reject ?period=30d with 400", "routes reject every period but week and term, and never echo it". |
| Route file imports | "the route file imports only the president queries and the group detection". |
| Errors say nothing | "a failure inside a handler is a plain 500 that says nothing about its cause". |
| Deterministic groups | `groups.test.ts`: two triangles joined by one edge, the same input twice, any edge order. |
