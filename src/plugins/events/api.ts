import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import type { ApiRoute, BotContext } from "../../core/plugin.ts";
import { nowSec } from "../../core/util.ts";
import { recordModAction } from "../moderation/log.ts";
import {
  listEvents,
  serializeEvent,
  getEvent,
  getGroup,
  announceEventCreated,
  toggleParticipation,
  participantIds,
  LOCATION_CHANNEL_TYPES,
  CHANNEL_TYPE_LABEL,
} from "./service.ts";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

const RECURRENCES = [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "monthly_day",
  "monthly_weekday",
  "yearly",
  "custom_days",
] as const;

const REWARD_KINDS = ["role", "credits", "xp", "store_item"] as const;

const isSnowflake = (v: unknown): v is string =>
  typeof v === "string" && /^\d{5,25}$/.test(v);
const isHttpUrl = (v: unknown): v is string =>
  typeof v === "string" && /^https?:\/\//.test(v);

type ParsedRewards = { kind: string; roleId: string | null; amount: number | null; storeItemId: number | null }[];

/** Validate an admin-submitted event body. Returns insertable values + child rows. */
function parseEvent(body: Record<string, any>):
  | { error: string }
  | {
      values: Omit<
        typeof schema.events.$inferInsert,
        "id" | "createdAt" | "updatedAt" | "createdBy" | "lastRewardedFor"
      >;
      rewards: ParsedRewards;
      reminderOffsets: number[];
    } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { error: "title required" };

  const startAt = Number(body.startAt);
  if (!Number.isInteger(startAt) || startAt <= 0) {
    return { error: "startAt must be a unix timestamp" };
  }
  let endAt: number | null = null;
  if (body.endAt != null && body.endAt !== "") {
    endAt = Number(body.endAt);
    if (!Number.isInteger(endAt) || endAt <= startAt) {
      return { error: "endAt must be after startAt" };
    }
  }

  const recurrence = RECURRENCES.includes(body.recurrence) ? body.recurrence : "none";
  let recurrenceInterval = 1;
  if (recurrence === "custom_days") {
    recurrenceInterval = Number(body.recurrenceInterval);
    if (!Number.isInteger(recurrenceInterval) || recurrenceInterval < 1) {
      return { error: "recurrenceInterval must be a positive integer" };
    }
  }
  let recurrenceUntil: number | null = null;
  if (body.recurrenceUntil != null && body.recurrenceUntil !== "") {
    recurrenceUntil = Number(body.recurrenceUntil);
    if (!Number.isInteger(recurrenceUntil) || recurrenceUntil < startAt) {
      return { error: "recurrenceUntil must be at/after startAt" };
    }
  }

  let accentColor: number | null = null;
  if (body.accentColor != null && body.accentColor !== "") {
    accentColor = Number(body.accentColor);
    if (!Number.isInteger(accentColor) || accentColor < 0 || accentColor > 0xffffff) {
      return { error: "accentColor must be a 0xRRGGBB integer" };
    }
  }

  const imageUrls: string[] = [];
  if (body.imageUrls != null) {
    if (!Array.isArray(body.imageUrls)) return { error: "imageUrls must be an array" };
    for (const url of body.imageUrls) {
      if (!isHttpUrl(url)) return { error: "imageUrls must be http(s) URLs" };
      imageUrls.push(url);
    }
    if (imageUrls.length > 10) return { error: "at most 10 images" };
  }

  let groupId: number | null = null;
  if (body.groupId != null && body.groupId !== "") {
    groupId = Number(body.groupId);
    if (!Number.isInteger(groupId) || !getGroup(groupId)) {
      return { error: "groupId does not exist" };
    }
  }

  let channelId: string | null = null;
  if (body.channelId != null && body.channelId !== "") {
    if (!isSnowflake(body.channelId)) return { error: "channelId must be a channel id" };
    channelId = body.channelId;
  }

  const rewards: ParsedRewards = [];
  if (body.rewards != null) {
    if (!Array.isArray(body.rewards)) return { error: "rewards must be an array" };
    for (const r of body.rewards) {
      if (!REWARD_KINDS.includes(r?.kind)) return { error: "invalid reward kind" };
      if (r.kind === "role") {
        if (!isSnowflake(r.roleId)) return { error: "reward roleId must be a role id" };
        rewards.push({ kind: r.kind, roleId: r.roleId, amount: null, storeItemId: null });
      } else if (r.kind === "store_item") {
        const itemId = Number(r.storeItemId);
        const item = Number.isInteger(itemId)
          ? db.select().from(schema.storeItems).where(eq(schema.storeItems.id, itemId)).get()
          : undefined;
        if (!item) return { error: "reward storeItemId does not exist" };
        rewards.push({ kind: r.kind, roleId: null, amount: null, storeItemId: itemId });
      } else {
        const amount = Number(r.amount);
        if (!Number.isInteger(amount) || amount < 1) {
          return { error: "reward amount must be a positive integer" };
        }
        rewards.push({ kind: r.kind, roleId: null, amount, storeItemId: null });
      }
    }
  }

  // Default: one reminder a day before the event.
  let reminderOffsets = [1440];
  if (body.reminders != null) {
    if (!Array.isArray(body.reminders)) return { error: "reminders must be an array" };
    reminderOffsets = body.reminders.map((m: unknown) => Number(m));
    if (reminderOffsets.some((m) => !Number.isInteger(m) || m < 0)) {
      return { error: "reminders must be non-negative minute offsets" };
    }
    if (reminderOffsets.length > 20) return { error: "at most 20 reminders" };
  }

  return {
    values: {
      title,
      description: typeof body.description === "string" ? body.description : "",
      imageUrls,
      accentColor,
      groupId,
      channelId,
      allDay: body.allDay === true || body.allDay === 1 ? 1 : 0,
      startAt,
      endAt,
      recurrence,
      recurrenceInterval,
      recurrenceUntil,
    },
    rewards,
    reminderOffsets,
  };
}

function replaceChildren(eventId: number, rewards: ParsedRewards, offsets: number[]) {
  db.delete(schema.eventRewards).where(eq(schema.eventRewards.eventId, eventId)).run();
  for (const r of rewards) {
    db.insert(schema.eventRewards)
      .values({ eventId, kind: r.kind as never, roleId: r.roleId, amount: r.amount, storeItemId: r.storeItemId })
      .run();
  }
  db.delete(schema.eventReminders).where(eq(schema.eventReminders.eventId, eventId)).run();
  for (const offsetMinutes of offsets) {
    db.insert(schema.eventReminders).values({ eventId, offsetMinutes }).run();
  }
}

const listRoute: ApiRoute = {
  method: "GET",
  path: "/api/events",
  access: "user",
  handle: (_req, ctx) => Response.json(listEvents(ctx)),
};

const createRoute: ApiRoute = {
  method: "POST",
  path: "/api/events",
  access: "president",
  async handle(req, ctx) {
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");
    const parsed = parseEvent(body);
    if ("error" in parsed) return badRequest(parsed.error);

    const event = db
      .insert(schema.events)
      .values({ ...parsed.values, createdBy: ctx.session!.userId })
      .returning()
      .get();
    replaceChildren(event.id, parsed.rewards, parsed.reminderOffsets);
    await announceEventCreated(ctx, event);
    await recordModAction({
      client: ctx.client,
      action: "event_create",
      userId: ctx.session!.userId,
      moderatorId: ctx.session!.userId,
      metadata: { event: event.title, eventId: event.id },
    });
    return Response.json(serializeEvent(ctx, event), { status: 201 });
  },
};

const updateRoute: ApiRoute = {
  method: "PUT",
  path: "/api/events/:id",
  access: "president",
  async handle(req, ctx) {
    const event = getEvent(Number(ctx.params.id));
    if (!event) return Response.json({ error: "not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");
    const parsed = parseEvent(body);
    if ("error" in parsed) return badRequest(parsed.error);

    const updated = db
      .update(schema.events)
      .set({ ...parsed.values, updatedAt: nowSec() })
      .where(eq(schema.events.id, event.id))
      .returning()
      .get()!;
    replaceChildren(event.id, parsed.rewards, parsed.reminderOffsets);
    await recordModAction({
      client: ctx.client,
      action: "event_update",
      userId: ctx.session!.userId,
      moderatorId: ctx.session!.userId,
      metadata: { event: updated.title, eventId: updated.id },
    });
    return Response.json(serializeEvent(ctx, updated));
  },
};

const deleteRoute: ApiRoute = {
  method: "DELETE",
  path: "/api/events/:id",
  access: "president",
  async handle(_req, ctx) {
    const event = getEvent(Number(ctx.params.id));
    db.delete(schema.events).where(eq(schema.events.id, Number(ctx.params.id))).run();
    if (event) {
      await recordModAction({
        client: ctx.client,
        action: "event_delete",
        userId: ctx.session!.userId,
        moderatorId: ctx.session!.userId,
        metadata: { event: event.title, eventId: event.id },
      });
    }
    return new Response(null, { status: 204 });
  },
};

/** Toggle the signed-in member's participation (same as the /events 🔔 button). */
const participationRoute: ApiRoute = {
  method: "POST",
  path: "/api/events/:id/participation",
  access: "user",
  handle(_req, ctx) {
    const event = getEvent(Number(ctx.params.id));
    if (!event) return Response.json({ error: "not found" }, { status: 404 });
    const joined = toggleParticipation(event.id, ctx.session!.userId);
    return Response.json({ joined, participantIds: participantIds(event.id) });
  },
};

// --- Groups ---

function parseGroup(body: Record<string, any>): { error: string } | {
  values: { name: string; description: string; mentionRoleIds: string[] };
} {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "name required" };
  const mentionRoleIds: string[] = [];
  if (body.mentionRoleIds != null) {
    if (!Array.isArray(body.mentionRoleIds)) {
      return { error: "mentionRoleIds must be an array" };
    }
    for (const id of body.mentionRoleIds) {
      if (!isSnowflake(id)) return { error: "mentionRoleIds must be role ids" };
      mentionRoleIds.push(id);
    }
  }
  return {
    values: {
      name,
      description: typeof body.description === "string" ? body.description : "",
      mentionRoleIds,
    },
  };
}

const listGroupsRoute: ApiRoute = {
  method: "GET",
  path: "/api/event-groups",
  access: "user",
  handle: () => Response.json(db.select().from(schema.eventGroups).all()),
};

const createGroupRoute: ApiRoute = {
  method: "POST",
  path: "/api/event-groups",
  access: "president",
  async handle(req, ctx) {
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");
    const parsed = parseGroup(body);
    if ("error" in parsed) return badRequest(parsed.error);
    const row = db.insert(schema.eventGroups).values(parsed.values).returning().get();
    await recordModAction({
      client: ctx.client,
      action: "event_group_create",
      userId: ctx.session!.userId,
      moderatorId: ctx.session!.userId,
      metadata: { group: row.name, groupId: row.id },
    });
    return Response.json(row, { status: 201 });
  },
};

const updateGroupRoute: ApiRoute = {
  method: "PUT",
  path: "/api/event-groups/:id",
  access: "president",
  async handle(req, ctx) {
    const id = Number(ctx.params.id);
    if (!getGroup(id)) return Response.json({ error: "not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");
    const parsed = parseGroup(body);
    if ("error" in parsed) return badRequest(parsed.error);
    const row = db
      .update(schema.eventGroups)
      .set(parsed.values)
      .where(eq(schema.eventGroups.id, id))
      .returning()
      .get()!;
    await recordModAction({
      client: ctx.client,
      action: "event_group_update",
      userId: ctx.session!.userId,
      moderatorId: ctx.session!.userId,
      metadata: { group: row.name, groupId: row.id },
    });
    return Response.json(row);
  },
};

const deleteGroupRoute: ApiRoute = {
  method: "DELETE",
  path: "/api/event-groups/:id",
  access: "president",
  async handle(_req, ctx) {
    const group = getGroup(Number(ctx.params.id));
    db.delete(schema.eventGroups)
      .where(eq(schema.eventGroups.id, Number(ctx.params.id)))
      .run();
    if (group) {
      await recordModAction({
        client: ctx.client,
        action: "event_group_delete",
        userId: ctx.session!.userId,
        moderatorId: ctx.session!.userId,
        metadata: { group: group.name, groupId: group.id },
      });
    }
    return new Response(null, { status: 204 });
  },
};

/** Channels eligible as event locations + guild roles, for the editor pickers. */
const optionsRoute: ApiRoute = {
  method: "GET",
  path: "/api/event-options",
  access: "president",
  handle(_req, ctx: BotContext) {
    const guild = ctx.client.guilds.cache.get(ctx.guildId);
    const channels = [...(guild?.channels.cache.values() ?? [])]
      .filter((c) => LOCATION_CHANNEL_TYPES.includes(c.type))
      .map((c) => ({ id: c.id, name: c.name, type: CHANNEL_TYPE_LABEL[c.type] ?? "other" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const roles = [...(guild?.roles.cache.values() ?? [])]
      .filter((r) => r.id !== ctx.guildId) // skip @everyone
      .map((r) => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const storeItems = db
      .select()
      .from(schema.storeItems)
      .all()
      .map((i) => ({ id: i.id, name: i.name, kind: i.kind }));
    return Response.json({ channels, roles, storeItems });
  },
};

export const eventApiRoutes: ApiRoute[] = [
  listRoute,
  createRoute,
  updateRoute,
  deleteRoute,
  participationRoute,
  listGroupsRoute,
  createGroupRoute,
  updateGroupRoute,
  deleteGroupRoute,
  optionsRoute,
];
