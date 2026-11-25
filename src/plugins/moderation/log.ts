import { type Client, type TextChannel } from "discord.js";
import { db, schema, getConfig } from "../../db/index.ts";
import { v2, card, Accent } from "../../core/components.ts";

type ModAction = (typeof schema.modLog.$inferInsert)["action"];

const ACTION_LABEL: Record<ModAction, string> = {
  timeout: "⏳ Timeout",
  untimeout: "▶️ Timeout removed",
  kick: "👢 Kick",
  ban: "🔨 Ban",
  unban: "♻️ Unban",
  warn: "⚠️ Warning",
  censor: "🚫 Censor rule",
  simulate_activity: "🧪 Simulated activity",
  simulate_club_activity: "🧪 Simulated club activity",
  credits_grant: "🪙 Credits granted",
  credits_revoke: "🪙 Credits revoked",
  event_create: "📅 Event created",
  event_update: "📅 Event updated",
  event_delete: "📅 Event deleted",
  event_group_create: "🏷️ Event group created",
  event_group_update: "🏷️ Event group updated",
  event_group_delete: "🏷️ Event group deleted",
};

const ACTION_ACCENT: Record<ModAction, number> = {
  timeout: Accent.warning,
  untimeout: Accent.success,
  kick: Accent.warning,
  ban: Accent.danger,
  unban: Accent.success,
  warn: Accent.warning,
  censor: Accent.primary,
  simulate_activity: Accent.primary,
  simulate_club_activity: Accent.primary,
  credits_grant: Accent.success,
  credits_revoke: Accent.warning,
  event_create: Accent.primary,
  event_update: Accent.primary,
  event_delete: Accent.warning,
  event_group_create: Accent.primary,
  event_group_update: Accent.primary,
  event_group_delete: Accent.warning,
};

/**
 * Record a moderation action to the audit log table and, if configured, post a
 * Components V2 summary to the mod-log channel.
 */
export async function recordModAction(opts: {
  client: Client;
  action: ModAction;
  userId: string;
  moderatorId: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  db.insert(schema.modLog)
    .values({
      action: opts.action,
      userId: opts.userId,
      moderatorId: opts.moderatorId,
      reason: opts.reason ?? null,
      metadata: opts.metadata ?? null,
    })
    .run();

  const config = getConfig();
  if (!config.modLogChannelId) return;

  const channel = await opts.client.channels
    .fetch(config.modLogChannelId)
    .catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  const lines = [
    `**Target:** <@${opts.userId}> (\`${opts.userId}\`)`,
    `**Moderator:** <@${opts.moderatorId}>`,
  ];
  if (opts.reason) lines.push(`**Reason:** ${opts.reason}`);
  if (opts.metadata?.duration) lines.push(`**Duration:** ${opts.metadata.duration}`);
  if (opts.metadata?.amount !== undefined) lines.push(`**Amount:** ${opts.metadata.amount} SC`);
  if (opts.metadata?.balance !== undefined) lines.push(`**New balance:** ${opts.metadata.balance} SC`);
  if (opts.metadata?.club) lines.push(`**Club:** ${opts.metadata.club}`);
  if (opts.metadata?.event) lines.push(`**Event:** ${opts.metadata.event}`);
  if (opts.metadata?.group) lines.push(`**Group:** ${opts.metadata.group}`);
  if (opts.metadata?.messages) lines.push(`**Simulated messages:** ${opts.metadata.messages}`);
  if (opts.metadata?.xpGained) lines.push(`**XP gained:** ${opts.metadata.xpGained}`);

  await (channel as TextChannel)
    .send(
      v2(
        card({
          accent: ACTION_ACCENT[opts.action],
          title: ACTION_LABEL[opts.action],
          lines,
        }),
      ),
    )
    .catch((err) => console.error("[moderation] failed to post mod log:", err));
}
