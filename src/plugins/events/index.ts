import {
  SlashCommandBuilder,
  ButtonStyle,
  Events,
  type Client,
} from "discord.js";
import { asc } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import {
  v2,
  card,
  text,
  Accent,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  MediaGalleryBuilder,
  ackButtonLoading,
  MessageFlags,
} from "../../core/components.ts";
import { MediaGalleryItemBuilder } from "discord.js";
import { nowSec } from "../../core/util.ts";
import { defineListener, type Command, type Plugin } from "../../core/plugin.ts";
import { RECURRENCE_LABELS } from "./recurrence.ts";
import {
  specOf,
  formatWhen,
  getGroup,
  participantIds,
  isParticipant,
  toggleParticipation,
  fireDueReminders,
  grantDueRewards,
  type EventRow,
} from "./service.ts";
import { nextOccurrence } from "./recurrence.ts";
import { eventApiRoutes } from "./api.ts";

/** Upcoming (non-completed) events ordered by their next occurrence. */
function upcomingEvents(): { event: EventRow; occurrence: number }[] {
  const now = nowSec();
  return db
    .select()
    .from(schema.events)
    .orderBy(asc(schema.events.startAt))
    .all()
    .flatMap((event) => {
      const occurrence = nextOccurrence(specOf(event), now);
      return occurrence === null ? [] : [{ event, occurrence }];
    })
    .sort((a, b) => a.occurrence - b.occurrence);
}

/** One event per page: [◀] [🔔 participation toggle] [▶]. */
function eventsView(page: number, viewerId: string) {
  const upcoming = upcomingEvents();
  if (upcoming.length === 0) {
    return v2(
      card({
        accent: Accent.primary,
        title: "📅 Events",
        lines: ["No upcoming events. Check back later!"],
      }),
    );
  }

  const total = upcoming.length;
  const clamped = Math.min(Math.max(0, page), total - 1);
  const { event, occurrence } = upcoming[clamped]!;
  const participants = participantIds(event.id);
  const joined = isParticipant(event.id, viewerId);
  const group = event.groupId != null ? getGroup(event.groupId) : undefined;

  const container = new ContainerBuilder().setAccentColor(
    event.accentColor ?? Accent.primary,
  );
  if (event.imageUrls.length) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        event.imageUrls
          .slice(0, 10)
          .map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }
  container.addTextDisplayComponents(text(`## 📅 ${event.title}`));
  if (event.description) container.addTextDisplayComponents(text(event.description));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**When:** ${formatWhen(event, occurrence)} (<t:${occurrence}:R>)`,
        `**Where:** ${event.channelId ? `<#${event.channelId}>` : "—"}`,
        `**Repeats:** ${RECURRENCE_LABELS[event.recurrence]}`,
        group ? `**Group:** ${group.name}` : null,
        `**Participants:** ${participants.length}${joined ? " — including you 🔔" : ""}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    new TextDisplayBuilder().setContent(`-# Event ${clamped + 1}/${total}`),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ev:page:${clamped - 1}`)
        .setEmoji("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(clamped <= 0),
      new ButtonBuilder()
        .setCustomId(`ev:join:${event.id}:${clamped}`)
        .setEmoji(joined ? "🔕" : "🔔")
        .setStyle(joined ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ev:page:${clamped + 1}`)
        .setEmoji("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(clamped >= total - 1),
    ),
  );
  return v2(container);
}

const eventsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("events")
    .setDescription("Browse upcoming server events, one at a time."),
  async execute(interaction) {
    const payload = eventsView(0, interaction.user.id);
    await interaction.reply({
      ...payload,
      flags: payload.flags | MessageFlags.Ephemeral,
    });
  },
};

/** ev:page:<n> pagination and ev:join:<eventId>:<page> participation toggles. */
const buttons = defineListener({
  event: Events.InteractionCreate,
  async handle(_ctx, interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith("ev:")) return;
    const [, action, a, b] = interaction.customId.split(":");
    await ackButtonLoading(interaction);
    try {
      let page = 0;
      if (action === "page") {
        page = Number(a);
      } else if (action === "join") {
        toggleParticipation(Number(a), interaction.user.id);
        page = Number(b);
      }
      await interaction.editReply(eventsView(page, interaction.user.id));
    } catch (err) {
      console.error("[events] button failed:", err);
      await interaction
        .editReply(
          v2(
            card({
              accent: Accent.danger,
              title: "Something went wrong",
              lines: ["Run /events again."],
            }),
          ),
        )
        .catch(() => {});
    }
  },
});

const plugin: Plugin = {
  name: "events",
  commands: [eventsCommand],
  listeners: [buttons],
  schedules: [
    {
      name: "events-tick",
      cron: "* * * * *",
      async run(ctx) {
        if (!ctx.config().eventsEnabled) return;
        await fireDueReminders(ctx);
        await grantDueRewards(ctx);
      },
    },
  ],
  api: eventApiRoutes,
};

export default plugin;
