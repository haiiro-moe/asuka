/** Thin client for AniList's public GraphQL API (https://graphql.anilist.co). */

const ENDPOINT = "https://graphql.anilist.co";

export class AniListError extends Error {}

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken?: string,
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = (await res.json().catch(() => null)) as {
    data?: T;
    errors?: { message: string; status?: number }[];
  } | null;
  if (!res.ok || !data?.data) {
    const message = data?.errors?.[0]?.message ?? `AniList request failed (${res.status})`;
    throw new AniListError(message);
  }
  return data.data;
}

/** The authenticated account behind an OAuth access token (used by /al link). */
export async function fetchViewer(accessToken: string): Promise<{ id: number; name: string }> {
  const data = await gql<{ Viewer: { id: number; name: string } }>(
    `query { Viewer { id name } }`,
    {},
    accessToken,
  );
  return data.Viewer;
}

/** AniList "Not Found." errors are expected for missing users/media. */
export function isNotFound(err: unknown): boolean {
  return err instanceof AniListError && /not found/i.test(err.message);
}

// --- Users ---

export interface AlUser {
  id: number;
  name: string;
  siteUrl: string;
  createdAt: number | null;
  avatar: { large: string | null } | null;
  bannerImage: string | null;
  options: { profileColor: string | null } | null;
  statistics: {
    anime: {
      count: number;
      meanScore: number;
      minutesWatched: number;
      episodesWatched: number;
      genres: { genre: string; count: number }[];
    };
    manga: {
      count: number;
      meanScore: number;
      chaptersRead: number;
      volumesRead: number;
    };
  };
}

const USER_QUERY = `
query ($name: String) {
  User(name: $name) {
    id name siteUrl createdAt bannerImage
    avatar { large }
    options { profileColor }
    statistics {
      anime {
        count meanScore minutesWatched episodesWatched
        genres(limit: 3, sort: COUNT_DESC) { genre count }
      }
      manga { count meanScore chaptersRead volumesRead }
    }
  }
}`;

export async function fetchUser(name: string): Promise<AlUser> {
  const data = await gql<{ User: AlUser }>(USER_QUERY, { name });
  return data.User;
}

// --- Media (anime/manga) ---

export type MediaType = "ANIME" | "MANGA";

export interface AlMedia {
  id: number;
  siteUrl: string;
  type: MediaType;
  format: string | null;
  status: string | null;
  description: string | null;
  episodes: number | null;
  chapters: number | null;
  volumes: number | null;
  duration: number | null;
  averageScore: number | null;
  meanScore: number | null;
  popularity: number | null;
  favourites: number | null;
  genres: string[];
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null } | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  coverImage: { extraLarge: string | null; large: string | null; color: string | null };
  bannerImage: string | null;
  studios: { nodes: { name: string }[] } | null;
  nextAiringEpisode: { episode: number; airingAt: number } | null;
}

const MEDIA_FIELDS = `
  id siteUrl type format status description(asHtml: false)
  episodes chapters volumes duration
  averageScore meanScore popularity favourites genres season seasonYear
  startDate { year }
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt }
`;

export async function fetchMediaById(id: number, type: MediaType): Promise<AlMedia> {
  const data = await gql<{ Media: AlMedia }>(
    `query ($id: Int, $type: MediaType) { Media(id: $id, type: $type) { ${MEDIA_FIELDS} } }`,
    { id, type },
  );
  return data.Media;
}

export async function searchMedia(
  search: string,
  type: MediaType,
  perPage = 8,
): Promise<AlMedia[]> {
  const data = await gql<{ Page: { media: AlMedia[] } }>(
    `query ($search: String, $type: MediaType, $perPage: Int) {
      Page(perPage: $perPage) { media(search: $search, type: $type, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } }
    }`,
    { search, type, perPage },
  );
  return data.Page.media;
}

/** Lightweight title list for slash-command autocomplete. */
export async function suggestMedia(
  search: string,
  type: MediaType,
): Promise<{ id: number; label: string }[]> {
  const data = await gql<{
    Page: {
      media: {
        id: number;
        format: string | null;
        seasonYear: number | null;
        startDate: { year: number | null } | null;
        title: { romaji: string | null; english: string | null };
      }[];
    };
  }>(
    `query ($search: String, $type: MediaType) {
      Page(perPage: 10) {
        media(search: $search, type: $type, sort: SEARCH_MATCH) {
          id format seasonYear startDate { year }
          title { romaji english }
        }
      }
    }`,
    { search, type },
  );
  return data.Page.media.map((m) => {
    const title = m.title.english ?? m.title.romaji ?? `#${m.id}`;
    const year = m.seasonYear ?? m.startDate?.year;
    const suffix = [m.format?.replaceAll("_", " "), year].filter(Boolean).join(" · ");
    return { id: m.id, label: suffix ? `${title} (${suffix})` : title };
  });
}

// --- Characters ---

export interface AlCharacter {
  id: number;
  siteUrl: string;
  favourites: number | null;
  description: string | null;
  name: { full: string | null; native: string | null };
  image: { large: string | null };
  media: { nodes: { title: { romaji: string | null; english: string | null } }[] } | null;
}

const CHARACTER_FIELDS = `
  id siteUrl favourites description(asHtml: false)
  name { full native }
  image { large }
  media(perPage: 3, sort: POPULARITY_DESC) { nodes { title { romaji english } } }
`;

export async function fetchCharacterById(id: number): Promise<AlCharacter> {
  const data = await gql<{ Character: AlCharacter }>(
    `query ($id: Int) { Character(id: $id) { ${CHARACTER_FIELDS} } }`,
    { id },
  );
  return data.Character;
}

export async function searchCharacters(search: string, perPage = 8): Promise<AlCharacter[]> {
  const data = await gql<{ Page: { characters: AlCharacter[] } }>(
    `query ($search: String, $perPage: Int) {
      Page(perPage: $perPage) { characters(search: $search) { ${CHARACTER_FIELDS} } }
    }`,
    { search, perPage },
  );
  return data.Page.characters;
}

export async function suggestCharacters(
  search: string,
): Promise<{ id: number; label: string }[]> {
  const data = await gql<{
    Page: {
      characters: {
        id: number;
        name: { full: string | null };
        media: { nodes: { title: { romaji: string | null } }[] } | null;
      }[];
    };
  }>(
    `query ($search: String) {
      Page(perPage: 10) {
        characters(search: $search) {
          id name { full } media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { romaji } } }
        }
      }
    }`,
    { search },
  );
  return data.Page.characters.map((c) => {
    const from = c.media?.nodes?.[0]?.title?.romaji;
    return {
      id: c.id,
      label: from ? `${c.name.full ?? `#${c.id}`} (${from})` : (c.name.full ?? `#${c.id}`),
    };
  });
}

// --- Formatting helpers shared by cards and text fallbacks ---

/** Strip AniList description markup (HTML tags + spoilers) down to plain text. */
export function cleanDescription(raw: string | null | undefined, maxLen = 360): string {
  if (!raw) return "";
  const text = raw
    .replace(/~!.*?!~/gs, "") // spoiler blocks
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function mediaTitle(media: AlMedia): string {
  return media.title.english ?? media.title.romaji ?? `#${media.id}`;
}

/** "TV · 25 episodes · Spring 2013 · Finished" style meta line. */
export function mediaMetaLine(media: AlMedia): string {
  const parts: string[] = [];
  if (media.format) parts.push(media.format === "TV" ? "TV" : titleCase(media.format));
  if (media.type === "ANIME" && media.episodes) {
    parts.push(`${media.episodes} episode${media.episodes === 1 ? "" : "s"}`);
  }
  if (media.type === "MANGA" && media.chapters) parts.push(`${media.chapters} chapters`);
  if (media.season && media.seasonYear) {
    parts.push(`${titleCase(media.season)} ${media.seasonYear}`);
  } else if (media.startDate?.year) {
    parts.push(String(media.startDate.year));
  }
  if (media.status) parts.push(titleCase(media.status));
  return parts.join("  ·  ");
}
