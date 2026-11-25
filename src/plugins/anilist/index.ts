import {
  SlashCommandBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import {
  v2,
  card,
  ContainerBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  pngAttachment,
} from "../../core/components.ts";
import type { Command, Plugin } from "../../core/plugin.ts";
import {
  fetchImageDataUri,
  renderAniListProfilePng,
  renderAniListMediaPng,
  renderAniListCharacterPng,
} from "../../core/images/index.tsx";
import {
  isConfigured as isAniListConfigured,
  createPendingState,
  buildAuthorizeUrl,
} from "./oauth.ts";
import {
  fetchUser,
  fetchMediaById,
  searchMedia,
  suggestMedia,
  fetchCharacterById,
  searchCharacters,
  suggestCharacters,
  cleanDescription,
  mediaTitle,
  mediaMetaLine,
  isNotFound,
  type AlMedia,
  type AlCharacter,
  type MediaType,
} from "./api.ts";

/** AniList brand blue (matches the site accent used on the cards). */
const ANILIST_ACCENT = 0x3db4f2;

const EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function getLink(userId: string) {
  return db
    .select()
    .from(schema.anilistLinks)
    .where(eq(schema.anilistLinks.userId, userId))
    .get();
}

function linkButton(url: string, label = "View on AniList"): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url),
  );
}

function errorCard(lines: string[]) {
  return v2(card({ accent: 0xe85d75, title: "AniList", lines }));
}

/** PNG card + link button when rendering works, text card otherwise. */
function imageReply(
  png: Buffer | null,
  filename: string,
  url: string,
  fallback: { title: string; lines: string[] },
) {
  if (png) {
    const { file, gallery } = pngAttachment(png, filename);
    const container = new ContainerBuilder()
      .setAccentColor(ANILIST_ACCENT)
      .addMediaGalleryComponents(gallery)
      .addActionRowComponents(linkButton(url));
    return { ...v2(container), files: [file] };
  }
  const container = card({
    accent: ANILIST_ACCENT,
    title: fallback.title,
    lines: fallback.lines,
  }).addActionRowComponents(linkButton(url));
  // Clear any previous upload when this payload lands in an editReply.
  return { ...v2(container), files: [] };
}

// --- Subcommand handlers ---

async function handleLink(interaction: ChatInputCommandInteraction) {
  if (!isAniListConfigured()) {
    return interaction.reply({
      ...errorCard(["AniList linking isn't set up on this bot yet — ask an admin to configure it."]),
      flags: EPHEMERAL,
    });
  }
  const state = createPendingState(interaction.user.id);
  await interaction.reply({
    ...v2(
      card({
        accent: ANILIST_ACCENT,
        title: "Link your AniList account",
        lines: [
          "Click below to sign in with AniList and authorize this bot.",
          "The link expires in 10 minutes and is only usable once.",
        ],
      }).addActionRowComponents(linkButton(buildAuthorizeUrl(state), "Sign in with AniList")),
    ),
    flags: EPHEMERAL,
  });
}

async function handleUnlink(interaction: ChatInputCommandInteraction) {
  const existing = getLink(interaction.user.id);
  db.delete(schema.anilistLinks)
    .where(eq(schema.anilistLinks.userId, interaction.user.id))
    .run();
  await interaction.reply({
    ...v2(
      card({
        accent: ANILIST_ACCENT,
        title: "AniList unlinked",
        lines: [
          existing
            ? `Removed the link to **${existing.username}**.`
            : "There was no linked AniList account.",
        ],
      }),
    ),
    flags: EPHEMERAL,
  });
}

async function handleProfile(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("member") ?? interaction.user;
  const link = getLink(target.id);
  if (!link) {
    return interaction.reply({
      ...errorCard([
        target.id === interaction.user.id
          ? "You haven't linked an AniList account yet — use `/al link`."
          : `<@${target.id}> hasn't linked an AniList account.`,
      ]),
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply();
  try {
    const alUser = await fetchUser(link.username);
    const [avatarDataUri, bannerDataUri] = await Promise.all([
      alUser.avatar?.large ? fetchImageDataUri(alUser.avatar.large) : null,
      alUser.bannerImage ? fetchImageDataUri(alUser.bannerImage) : null,
    ]);
    const anime = alUser.statistics.anime;
    const manga = alUser.statistics.manga;
    const daysWatched = anime.minutesWatched / 60 / 24;

    const png = await renderAniListProfilePng({
      username: alUser.name,
      avatarDataUri,
      bannerDataUri,
      profileColor: alUser.options?.profileColor ?? null,
      animeCount: anime.count,
      daysWatched,
      animeMeanScore: anime.meanScore,
      mangaCount: manga.count,
      chaptersRead: manga.chaptersRead,
      mangaMeanScore: manga.meanScore,
      topGenres: anime.genres.map((g) => g.genre),
    });

    await interaction.editReply(
      imageReply(png, `anilist-${alUser.name}.png`, alUser.siteUrl, {
        title: `${alUser.name} on AniList`,
        lines: [
          `**Anime:** ${anime.count} titles · ${daysWatched.toFixed(1)} days watched · mean ${anime.meanScore || "—"}`,
          `**Manga:** ${manga.count} titles · ${manga.chaptersRead} chapters read · mean ${manga.meanScore || "—"}`,
        ],
      }),
    );
  } catch (err) {
    await interaction.editReply(
      errorCard([
        isNotFound(err)
          ? `AniList user **${link.username}** no longer exists — re-link with \`/al link\`.`
          : "AniList is unreachable right now — try again in a bit.",
      ]),
    );
  }
}

/** Resolve a search option that may be an autocomplete pick (numeric id). */
async function resolveMedia(query: string, type: MediaType): Promise<AlMedia | null> {
  if (/^\d+$/.test(query)) {
    return fetchMediaById(Number(query), type).catch(() => null);
  }
  const results = await searchMedia(query, type, 1).catch(() => []);
  return results[0] ?? null;
}

async function handleMedia(interaction: ChatInputCommandInteraction, type: MediaType) {
  const query = interaction.options.getString("query", true);
  await interaction.deferReply();
  const media = await resolveMedia(query, type);
  if (!media) {
    return interaction.editReply(errorCard([`Nothing found for **${query}**.`]));
  }

  const [coverDataUri, bannerDataUri] = await Promise.all([
    media.coverImage.extraLarge || media.coverImage.large
      ? fetchImageDataUri((media.coverImage.extraLarge ?? media.coverImage.large)!)
      : null,
    media.bannerImage ? fetchImageDataUri(media.bannerImage) : null,
  ]);

  const nextEp = media.nextAiringEpisode
    ? {
        episode: media.nextAiringEpisode.episode,
        inDays: Math.max(
          1,
          Math.round((media.nextAiringEpisode.airingAt - Date.now() / 1000) / 86400),
        ),
      }
    : null;

  const png = await renderAniListMediaPng({
    title: mediaTitle(media),
    metaLine: mediaMetaLine(media),
    description: cleanDescription(media.description, 420),
    coverDataUri,
    bannerDataUri,
    coverColor: media.coverImage.color,
    averageScore: media.averageScore,
    popularity: media.popularity,
    favourites: media.favourites,
    genres: media.genres,
    studio: media.studios?.nodes?.[0]?.name ?? null,
    nextEpisode: nextEp,
  });

  await interaction.editReply(
    imageReply(png, `anilist-${type.toLowerCase()}-${media.id}.png`, media.siteUrl, {
      title: mediaTitle(media),
      lines: [
        mediaMetaLine(media),
        media.averageScore != null ? `**Score:** ${media.averageScore}%` : "",
        media.genres.length ? `**Genres:** ${media.genres.slice(0, 5).join(", ")}` : "",
        cleanDescription(media.description, 300),
      ].filter(Boolean),
    }),
  );
}

async function resolveCharacter(query: string): Promise<AlCharacter | null> {
  if (/^\d+$/.test(query)) {
    return fetchCharacterById(Number(query)).catch(() => null);
  }
  const results = await searchCharacters(query, 1).catch(() => []);
  return results[0] ?? null;
}

async function handleCharacter(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query", true);
  await interaction.deferReply();
  const character = await resolveCharacter(query);
  if (!character) {
    return interaction.editReply(errorCard([`Nothing found for **${query}**.`]));
  }

  const imageDataUri = character.image?.large
    ? await fetchImageDataUri(character.image.large)
    : null;
  const name = character.name.full ?? `#${character.id}`;
  const appearsIn = (character.media?.nodes ?? [])
    .map((n) => n.title.english ?? n.title.romaji ?? "")
    .filter(Boolean);

  const png = await renderAniListCharacterPng({
    name,
    nativeName: character.name.native,
    imageDataUri,
    favourites: character.favourites,
    description: cleanDescription(character.description, 380),
    appearsIn,
  });

  await interaction.editReply(
    imageReply(png, `anilist-character-${character.id}.png`, character.siteUrl, {
      title: name,
      lines: [
        character.name.native ?? "",
        character.favourites != null ? `**Favorites:** ${character.favourites}` : "",
        appearsIn.length ? `**Appears in:** ${appearsIn.join(", ")}` : "",
        cleanDescription(character.description, 300),
      ].filter(Boolean),
    }),
  );
}

// --- Autocomplete ---

async function autocomplete(interaction: AutocompleteInteraction) {
  const sub = interaction.options.getSubcommand();
  const query = interaction.options.getFocused().trim();
  if (query.length < 2) return interaction.respond([]);
  try {
    const suggestions =
      sub === "character"
        ? await suggestCharacters(query)
        : await suggestMedia(query, sub === "manga" ? "MANGA" : "ANIME");
    await interaction.respond(
      suggestions.slice(0, 25).map((s) => ({
        name: s.label.slice(0, 100),
        value: String(s.id),
      })),
    );
  } catch {
    await interaction.respond([]).catch(() => {});
  }
}

const al: Command = {
  data: new SlashCommandBuilder()
    .setName("al")
    .setDescription("AniList: link your account, show profiles, search anime/manga/characters.")
    .addSubcommand((s) =>
      s.setName("link").setDescription("Link your AniList account via AniList sign-in."),
    )
    .addSubcommand((s) =>
      s.setName("unlink").setDescription("Remove your AniList link."),
    )
    .addSubcommand((s) =>
      s
        .setName("profile")
        .setDescription("Show a member's AniList profile.")
        .addUserOption((o) =>
          o.setName("member").setDescription("Member (defaults to you)"),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("anime")
        .setDescription("Look up an anime on AniList.")
        .addStringOption((o) =>
          o
            .setName("query")
            .setDescription("Title to search")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("manga")
        .setDescription("Look up a manga on AniList.")
        .addStringOption((o) =>
          o
            .setName("query")
            .setDescription("Title to search")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("character")
        .setDescription("Look up a character on AniList.")
        .addStringOption((o) =>
          o
            .setName("query")
            .setDescription("Name to search")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),
  async execute(interaction) {
    switch (interaction.options.getSubcommand()) {
      case "link":
        return handleLink(interaction);
      case "unlink":
        return handleUnlink(interaction);
      case "profile":
        return handleProfile(interaction);
      case "anime":
        return handleMedia(interaction, "ANIME");
      case "manga":
        return handleMedia(interaction, "MANGA");
      case "character":
        return handleCharacter(interaction);
    }
  },
  autocomplete,
};

const plugin: Plugin = {
  name: "anilist",
  commands: [al],
};

export default plugin;
