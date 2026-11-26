import { type Client, type TextChannel } from "discord.js";
import { db, schema, getConfig } from "../../db/index.ts";
import { v2, card, Accent } from "../../core/components.ts";

type ModAction = (typeof schema.modLog.$inferInsert)["action"];

const ACTION_LABEL: Record<ModAction, string> = {
  timeout: "timeout",
  untimeout: "timeout removed",
  kick: "kick",
  ban: "ban",
  unban: "unban",
  warn: "warning",
  censor: "censor rule",
  simulate_activity: "simulated activity",
  simulate_club_activity: "simulated club activity",
  credits_grant: "credits granted",
  credits_revoke: "credits revoked",
  event_create: "event created",
  event_update: "event updated",
  event_delete: "event deleted",
  event_group_create: "event group created",
  event_group_update: "event group updated",
  event_group_delete: "event group deleted",
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
    `**target:** <@${opts.userId}> (\`${opts.userId}\`)`,
    `**moderator:** <@${opts.moderatorId}>`,
  ];
  if (opts.reason) lines.push(`**reason:** ${opts.reason}`);
  if (opts.metadata?.duration) lines.push(`**duration:** ${opts.metadata.duration}`);
  if (opts.metadata?.amount !== undefined) lines.push(`**amount:** ${opts.metadata.amount} SC`);
  if (opts.metadata?.balance !== undefined) lines.push(`**new balance:** ${opts.metadata.balance} SC`);
  if (opts.metadata?.club) lines.push(`**club:** ${opts.metadata.club}`);
  if (opts.metadata?.event) lines.push(`**event:** ${opts.metadata.event}`);
  if (opts.metadata?.group) lines.push(`**group:** ${opts.metadata.group}`);
  if (opts.metadata?.messages) lines.push(`**simulated messages:** ${opts.metadata.messages}`);
  if (opts.metadata?.xpGained) lines.push(`**xp gained:** ${opts.metadata.xpGained}`);

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
