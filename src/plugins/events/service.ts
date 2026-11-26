import { ChannelType, type Client, type GuildBasedChannel } from "discord.js";
import { and, asc, eq } from "drizzle-orm";
import { db, schema, getConfig } from "../../db/index.ts";
import { addCredits, addXp, ensureMember } from "../../core/members.ts";
import { v2, card, Accent } from "../../core/components.ts";
import { renderBotMessage } from "../../core/messages.ts";
import { nowSec, formatDuration } from "../../core/util.ts";
import { panelLink } from "../store/service.ts";
import type { BotContext } from "../../core/plugin.ts";
import {
  nextOccurrence,
  previousOccurrence,
  occurrencesBetween,
  occurrenceDuration,
  isCompleted,
  RECURRENCE_LABELS,
  type RecurrenceSpec,
} from "./recurrence.ts";

export type EventRow = typeof schema.events.$inferSelect;
export type EventGroup = typeof schema.eventGroups.$inferSelect;
export type EventReward = typeof schema.eventRewards.$inferSelect;
export type EventReminder = typeof schema.eventReminders.$inferSelect;

export function specOf(event: EventRow): RecurrenceSpec {
  return {
    startAt: event.startAt,
    recurrence: event.recurrence,
    recurrenceInterval: event.recurrenceInterval,
    recurrenceUntil: event.recurrenceUntil,
  };
}

export function getEvent(id: number): EventRow | undefined {
  return db.select().from(schema.events).where(eq(schema.events.id, id)).get();
}

export function getGroup(id: number): EventGroup | undefined {
  return db.select().from(schema.eventGroups).where(eq(schema.eventGroups.id, id)).get();
}

export function rewardsFor(eventId: number): EventReward[] {
  return db
    .select()
    .from(schema.eventRewards)
    .where(eq(schema.eventRewards.eventId, eventId))
    .all();
}

export function remindersFor(eventId: number): EventReminder[] {
  return db
    .select()
    .from(schema.eventReminders)
    .where(eq(schema.eventReminders.eventId, eventId))
    .orderBy(asc(schema.eventReminders.offsetMinutes))
    .all();
}

export function participantIds(eventId: number): string[] {
  return db
    .select()
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.eventId, eventId))
    .all()
    .map((p) => p.userId);
}

export function isParticipant(eventId: number, userId: string): boolean {
  return !!db
    .select()
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.eventParticipants.userId, userId),
      ),
    )
    .get();
}

/** Toggle a member's participation. Returns the new state. */
export function toggleParticipation(eventId: number, userId: string): boolean {
  if (isParticipant(eventId, userId)) {
    db.delete(schema.eventParticipants)
      .where(
        and(
          eq(schema.eventParticipants.eventId, eventId),
          eq(schema.eventParticipants.userId, userId),
        ),
      )
      .run();
    return false;
  }
  ensureMember(userId);
  db.insert(schema.eventParticipants).values({ eventId, userId }).run();
  return true;
}

/** Channel kinds that may host an event. */
export const LOCATION_CHANNEL_TYPES: ChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildAnnouncement,
];

export const CHANNEL_TYPE_LABEL: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildAnnouncement]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildForum]: "forum",
};

function locationInfo(client: Client, guildId: string, channelId: string | null) {
  if (!channelId) return { channelName: null, channelType: null };
  const channel = client.guilds.cache
    .get(guildId)
    ?.channels.cache.get(channelId) as GuildBasedChannel | undefined;
  return {
    channelName: channel?.name ?? null,
    channelType: channel ? (CHANNEL_TYPE_LABEL[channel.type] ?? "other") : null,
  };
}

/** How far ahead the API expands occurrences for calendar rendering. */
const OCCURRENCE_HORIZON_SEC = 190 * 86400; // ~6 months

/**
 * Serialize an event for the dashboard/API: raw row plus resolved group,
 * location, rewards, reminders, participants, next occurrence, completion
 * state and expanded upcoming occurrences (for the calendar).
 */
export function serializeEvent(ctx: BotContext, event: EventRow) {
  const now = nowSec();
  const spec = specOf(event);
  const group = event.groupId != null ? getGroup(event.groupId) : undefined;
  return {
    ...event,
    group: group ? { id: group.id, name: group.name } : null,
    ...locationInfo(ctx.client, ctx.guildId, event.channelId),
    rewards: rewardsFor(event.id),
    reminders: remindersFor(event.id).map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
    })),
    participantIds: participantIds(event.id),
    recurrenceLabel: RECURRENCE_LABELS[event.recurrence],
    nextOccurrence: nextOccurrence(spec, now),
    completed: isCompleted(spec, event.endAt, now),
    occurrences: occurrencesBetween(
      spec,
      now - 45 * 86400,
      now + OCCURRENCE_HORIZON_SEC,
    ),
  };
}

export function listEvents(ctx: BotContext) {
  return db
    .select()
    .from(schema.events)
    .orderBy(asc(schema.events.startAt))
    .all()
    .map((e) => serializeEvent(ctx, e));
}

// --- Announcement / reminders ---

function locationMention(channelId: string | null): string {
  return channelId ? `<#${channelId}>` : "—";
}

/** "start – end" range in Discord timestamps, honoring the all-day flag. */
export function formatWhen(event: EventRow, occurrenceStart = event.startAt): string {
  const dur = occurrenceDuration(event.startAt, event.endAt);
  const end = dur ? occurrenceStart + dur : null;
  if (event.allDay) {
    const startDay = `<t:${occurrenceStart}:D>`;
    return end && end - occurrenceStart >= 86400
      ? `${startDay} – <t:${end}:D> (all day)`
      : `${startDay} (all day)`;
  }
  return end
    ? `<t:${occurrenceStart}:F> – <t:${end}:t>`
    : `<t:${occurrenceStart}:F>`;
}

function withEventStyling(
  payload: Awaited<ReturnType<typeof renderBotMessage>>,
  event: EventRow,
) {
  const first = payload.components[0] as
    | { type?: number; accent_color?: number; components?: unknown[] }
    | undefined;
  if (first?.type === 17) {
    if (event.accentColor != null) first.accent_color = event.accentColor;
    if (event.imageUrls.length && Array.isArray(first.components)) {
      first.components.push({
        type: 12, // MediaGallery
        items: event.imageUrls.slice(0, 10).map((url) => ({ media: { url } })),
      });
    }
  }
  return payload;
}

/**
 * Post the "event created" announcement to the events channel, mentioning the
 * group's configured roles. Best-effort: logs and moves on when unconfigured.
 */
export async function announceEventCreated(ctx: BotContext, event: EventRow) {
  const channelId = getConfig().eventsChannelId;
  if (!channelId) return;
  const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;

  const group = event.groupId != null ? getGroup(event.groupId) : undefined;
  const payload = withEventStyling(
    await renderBotMessage("events.announce", ctx, {
      title: event.title,
      description: event.description || "—",
      start: `<t:${event.startAt}:F>`,
      when: formatWhen(event),
      location: locationMention(event.channelId),
      group: group?.name ?? "—",
      recurrence: RECURRENCE_LABELS[event.recurrence],
    }),
    event,
  );

  const roleIds = group?.mentionRoleIds ?? [];
  if (roleIds.length) {
    payload.components.push({
      type: 10,
      content: roleIds.map((id) => `<@&${id}>`).join(" "),
    } as never);
  }
  await channel
    .send({
      ...payload,
      // v2() suppresses all pings; group mentions must actually notify.
      allowedMentions: { parse: [], roles: roleIds },
    })
    .catch((err) => console.error("[events] announce failed:", err));
}

/**
 * Fire due reminders: for each enabled event's next occurrence, any reminder
 * whose fire time has passed (and which hasn't fired for that occurrence yet)
 * posts to the events channel and DMs every participant.
 */
export async function fireDueReminders(ctx: BotContext) {
  const now = nowSec();
  const events = db.select().from(schema.events).all();
  for (const event of events) {
    const occ = nextOccurrence(specOf(event), now);
    if (occ === null) continue;
    for (const reminder of remindersFor(event.id)) {
      const fireAt = occ - reminder.offsetMinutes * 60;
      if (now < fireAt || reminder.lastFiredFor >= occ) continue;
      db.update(schema.eventReminders)
        .set({ lastFiredFor: occ })
        .where(eq(schema.eventReminders.id, reminder.id))
        .run();
      await sendReminder(ctx, event, occ).catch((err) =>
        console.error(`[events] reminder for "${event.title}" failed:`, err),
      );
    }
  }
}

async function sendReminder(ctx: BotContext, event: EventRow, occurrenceStart: number) {
  const participants = participantIds(event.id);
  const params = {
    title: event.title,
    start: `<t:${occurrenceStart}:F>`,
    relative: `<t:${occurrenceStart}:R>`,
    location: locationMention(event.channelId),
    participants: participants.length,
  };

  const channelId = getConfig().eventsChannelId;
  if (channelId) {
    const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && "send" in channel) {
      const payload = withEventStyling(
        await renderBotMessage("events.reminder-channel", ctx, params),
        event,
      );
      await channel
        .send(payload)
        .catch((err) => console.error("[events] channel reminder failed:", err));
    }
  }

  const dm = withEventStyling(
    await renderBotMessage("events.reminder-dm", ctx, params),
    event,
  );
  for (const userId of participants) {
    const user = await ctx.client.users.fetch(userId).catch(() => null);
    await user?.send(dm).catch(() => {}); // DMs may be closed — fine.
  }
}

// --- Rewards ---

/**
 * Grant a store item as an event reward (free — no SC is charged). Only
 * self-contained kinds make sense here: `role` grants the role, `panel_access`
 * mints a magic link (delivered via the reward DM). Other kinds are skipped.
 */
async function grantStoreItem(
  ctx: BotContext,
  userId: string,
  itemId: number,
): Promise<string | null> {
  const item = db
    .select()
    .from(schema.storeItems)
    .where(eq(schema.storeItems.id, itemId))
    .get();
  if (!item) return null;

  if (item.kind === "role" && item.roleId) {
    const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
    const member = await guild?.members.fetch(userId).catch(() => null);
    if (!member) return null;
    const added = await member.roles.add(item.roleId).catch(() => null);
    if (!added) return null;
    db.insert(schema.storePurchases)
      .values({
        itemId: item.id,
        itemName: item.name,
        kind: item.kind,
        userId,
        price: 0,
        roleId: item.roleId,
      })
      .run();
    return `**${item.name}** (role)`;
  }

  if (item.kind === "panel_access" && item.panel) {
    const token = crypto.randomUUID();
    db.insert(schema.storePurchases)
      .values({
        itemId: item.id,
        itemName: item.name,
        kind: item.kind,
        userId,
        price: 0,
        token,
        panel: item.panel,
        messageKey: item.messageKey,
      })
      .run();
    return `**${item.name}** — ${panelLink(token)}`;
  }

  console.warn(`[events] store item ${item.id} (${item.kind}) can't be auto-granted`);
  return null;
}

/**
 * Grant rewards for occurrences that have ended since the last grant. Each
 * participant receives every configured reward once per occurrence, plus a
 * summary DM.
 */
export async function grantDueRewards(ctx: BotContext) {
  const now = nowSec();
  const events = db.select().from(schema.events).all();
  for (const event of events) {
    const rewards = rewardsFor(event.id);
    if (!rewards.length) continue;
    const spec = specOf(event);
    const prev = previousOccurrence(spec, now);
    if (prev === null || prev <= event.lastRewardedFor) continue;
    if (prev + occurrenceDuration(event.startAt, event.endAt) > now) continue;

    db.update(schema.events)
      .set({ lastRewardedFor: prev })
      .where(eq(schema.events.id, event.id))
      .run();

    for (const userId of participantIds(event.id)) {
      const granted: string[] = [];
      for (const reward of rewards) {
        if (reward.kind === "credits" && reward.amount) {
          addCredits(userId, reward.amount);
          granted.push(`**${reward.amount} SC**`);
        } else if (reward.kind === "xp" && reward.amount) {
          addXp(userId, reward.amount);
          granted.push(`**${reward.amount} XP**`);
        } else if (reward.kind === "role" && reward.roleId) {
          const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
          const member = await guild?.members.fetch(userId).catch(() => null);
          if (member && (await member.roles.add(reward.roleId).catch(() => null))) {
            granted.push(`<@&${reward.roleId}> role`);
          }
        } else if (reward.kind === "store_item" && reward.storeItemId) {
          const line = await grantStoreItem(ctx, userId, reward.storeItemId);
          if (line) granted.push(line);
        }
      }
      if (granted.length) {
        const user = await ctx.client.users.fetch(userId).catch(() => null);
        await user
          ?.send(
            v2(
              card({
                accent: event.accentColor ?? Accent.success,
                title: `rewards: ${event.title}`,
                lines: granted.map((g) => `- ${g}`),
              }),
            ),
          )
          .catch(() => {});
      }
    }
    console.log(
      `[events] granted ${rewards.length} reward(s) for "${event.title}" @ ${prev} ` +
        `(${formatDuration(now - prev)} after start)`,
    );
  }
}
