import {
  Events,
  type TextChannel,
  type VoiceState,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema, getConfig } from "../../db/index.ts";
import { ensureMember, addXp } from "../../core/members.ts";
import { randomInt, nowSec } from "../../core/util.ts";
import { renderBotMessage } from "../../core/messages.ts";
import { defineListener, type Plugin, type BotContext } from "../../core/plugin.ts";

/** Announce a level-up in the configured channel (or a provided fallback). */
async function announceLevelUp(
  ctx: BotContext,
  userId: string,
  level: number,
  fallback?: TextChannel,
) {
  const channelId = getConfig().levelUpChannelId;
  let channel: TextChannel | undefined = fallback;
  if (channelId) {
    const fetched = await ctx.client.channels.fetch(channelId).catch(() => null);
    if (fetched?.isTextBased() && "send" in fetched) channel = fetched as TextChannel;
  }
  if (!channel) return;
  const payload = await renderBotMessage("xp.levelup", ctx, {
    user: `<@${userId}>`,
    level,
  });
  await channel.send(payload).catch(() => {});
}

const messageXp = defineListener({
  event: Events.MessageCreate,
  async handle(ctx, message) {
    if (message.author.bot || !message.inGuild()) return;
    const cfg = getConfig();
    if (!cfg.xpEnabled) return;

    const member = ensureMember(message.author.id);
    const now = nowSec();
    if (now - member.lastMessageXpAt < cfg.xpMessageCooldownSec) return;

    db.update(schema.members)
      .set({ lastMessageXpAt: now })
      .where(eq(schema.members.userId, message.author.id))
      .run();

    const gained = randomInt(cfg.xpMessageMin, cfg.xpMessageMax);
    const result = addXp(message.author.id, gained);
    if (result.leveledUp) {
      await announceLevelUp(
        ctx,
        message.author.id,
        result.level,
        message.channel as TextChannel,
      );
    }
  },
});

/** A voice state counts toward XP only when connected and not muted/deafened. */
function isActiveVoice(state: VoiceState): boolean {
  return Boolean(
    state.channelId &&
      !state.selfMute &&
      !state.selfDeaf &&
      !state.serverMute &&
      !state.serverDeaf,
  );
}

const voiceTracking = defineListener({
  event: Events.VoiceStateUpdate,
  async handle(_ctx, _oldState, newState) {
    if (!newState.id) return;
    if (isActiveVoice(newState)) {
      db.insert(schema.voiceSessions)
        .values({
          userId: newState.id,
          channelId: newState.channelId!,
          joinedAt: nowSec(),
          lastTickAt: nowSec(),
        })
        .onConflictDoUpdate({
          target: schema.voiceSessions.userId,
          set: { channelId: newState.channelId! },
        })
        .run();
    } else {
      db.delete(schema.voiceSessions)
        .where(eq(schema.voiceSessions.userId, newState.id))
        .run();
    }
  },
});

/** Award voice XP to everyone with an active session, once per minute. */
async function voiceTick(ctx: BotContext) {
  const cfg = getConfig();
  if (!cfg.xpEnabled) return;
  const sessions = db.select().from(schema.voiceSessions).all();
  const now = nowSec();
  for (const session of sessions) {
    db.update(schema.voiceSessions)
      .set({ lastTickAt: now })
      .where(eq(schema.voiceSessions.userId, session.userId))
      .run();
    const result = addXp(session.userId, cfg.xpVoicePerMinute);
    if (result.leveledUp) {
      await announceLevelUp(ctx, session.userId, result.level);
    }
  }
}

const plugin: Plugin = {
  name: "xp",
  listeners: [messageXp, voiceTracking],
  schedules: [{ name: "voice-xp-tick", cron: "* * * * *", run: voiceTick }],
};

export default plugin;
