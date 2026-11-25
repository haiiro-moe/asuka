import { Events } from "discord.js";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { defineListener, type Plugin } from "../../core/plugin.ts";
import { getOpenElection, VOTE_EMOJI } from "../elections/service.ts";
import { hasActiveSabotage, refreshExpiredSilences } from "./service.ts";
import { storeApiRoutes } from "./api.ts";

/**
 * Disable-voting sabotage: while active against a candidate, any vote
 * reaction added to their card is cancelled immediately. Votes cast before
 * the sabotage are left alone.
 */
const voteBlock = defineListener({
  event: Events.MessageReactionAdd,
  async handle(_ctx, reaction, user) {
    if (user.bot) return;
    if (reaction.emoji.name !== VOTE_EMOJI) return;
    const open = getOpenElection();
    if (!open || open.status !== "open") return;
    const candidate = db
      .select()
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.electionId, open.id),
          eq(schema.candidates.messageId, reaction.message.id),
        ),
      )
      .get();
    if (!candidate) return;
    if (!hasActiveSabotage(open.id, candidate.userId, "disable_voting")) return;
    await reaction.users.remove(user.id).catch(() => {});
  },
});

const plugin: Plugin = {
  name: "store",
  listeners: [voteBlock],
  schedules: [
    {
      name: "store-sabotage-expiry",
      cron: "*/15 * * * *",
      run: (ctx) => refreshExpiredSilences(ctx.client),
    },
  ],
  api: storeApiRoutes,
};

export default plugin;
