/**
 * Card renderers: one function per PNG card the bot posts. Every renderer returns null
 * on failure (fonts, layout, raster) so call sites fall back to their text-only payload.
 *
 * @packageDocumentation
 */
import { tryRenderPng } from "./render.tsx";
import { TitleBanner, BANNER_WIDTH, BANNER_HEIGHT } from "./components/title-banner.tsx";
import {
  ProfileCard,
  profileCardHeight,
  PROFILE_WIDTH,
  type ProfileCardProps,
} from "./components/profile-card.tsx";
import {
  ElectionProfileCard,
  ELECTION_PROFILE_WIDTH,
  ELECTION_PROFILE_HEIGHT,
  electionProfileHeight,
  type ElectionProfileCardProps,
} from "./components/election-profile-card.tsx";
import {
  LeaderboardCard,
  leaderboardCardHeight,
  LEADERBOARD_WIDTH,
  type LeaderboardCardProps,
} from "./components/leaderboard-card.tsx";
import {
  ElectionResultsCard,
  electionResultsCardHeight,
  ELECTION_RESULTS_WIDTH,
  type ElectionResultsCardProps,
} from "./components/election-results-card.tsx";
import {
  WinnerCard,
  WINNER_CARD_WIDTH,
  WINNER_CARD_HEIGHT,
  type WinnerCardProps,
} from "./components/winner-card.tsx";
import {
  AniListProfileCard,
  ANILIST_PROFILE_WIDTH,
  ANILIST_PROFILE_HEIGHT,
  type AniListProfileCardProps,
} from "./components/anilist-profile-card.tsx";
import {
  AniListMediaCard,
  anilistMediaCardHeight,
  ANILIST_MEDIA_WIDTH,
  type AniListMediaCardProps,
} from "./components/anilist-media-card.tsx";
import {
  AniListCharacterCard,
  ANILIST_CHARACTER_WIDTH,
  ANILIST_CHARACTER_HEIGHT,
  type AniListCharacterCardProps,
} from "./components/anilist-character-card.tsx";
import {
  WrappedCard,
  WRAPPED_CARD_WIDTH,
  wrappedCardHeight,
  type WrappedCardProps,
} from "./components/wrapped-card.tsx";
import {
  WrappedServerCard,
  WRAPPED_SERVER_CARD_WIDTH,
  wrappedServerCardHeight,
  type WrappedServerCardProps,
} from "./components/wrapped-server-card.tsx";
import { fetchImageDataUri } from "./util.ts";
import type { ServerWrapped, WrappedData } from "../../plugins/activity/types/wrapped.ts";

export { fetchImageDataUri } from "./util.ts";
export type {
  ProfileCardProps,
  ElectionProfileCardProps,
  LeaderboardCardProps,
  ElectionResultsCardProps,
  WinnerCardProps,
  AniListProfileCardProps,
  AniListMediaCardProps,
  AniListCharacterCardProps,
  WrappedCardProps,
  WrappedServerCardProps,
};
export type { PresidencyTerm } from "./components/profile-card.tsx";
export type { LeaderboardRow } from "./components/leaderboard-card.tsx";
export type { ElectionResultsRow } from "./components/election-results-card.tsx";

/**
 * Announcement title banner (haiiro page head over the still backdrop).
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderTitleBannerPng(title: string): Promise<Buffer | null> {
  return tryRenderPng(<TitleBanner title={title} />, {
    width: BANNER_WIDTH,
    height: BANNER_HEIGHT,
  });
}

/**
 * Member profile card.
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderProfileCardPng(props: ProfileCardProps): Promise<Buffer | null> {
  return tryRenderPng(<ProfileCard {...props} />, {
    width: PROFILE_WIDTH,
    height: profileCardHeight(props),
  });
}

/**
 * Election-view profile card (candidate stats).
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderElectionProfileCardPng(
  props: ElectionProfileCardProps,
): Promise<Buffer | null> {
  return tryRenderPng(<ElectionProfileCard {...props} />, {
    width: ELECTION_PROFILE_WIDTH,
    height: electionProfileHeight(props),
  });
}

/**
 * One leaderboard page.
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderLeaderboardCardPng(props: LeaderboardCardProps): Promise<Buffer | null> {
  return tryRenderPng(<LeaderboardCard {...props} />, {
    width: LEADERBOARD_WIDTH,
    height: leaderboardCardHeight(props),
  });
}

/**
 * Election results with vote counts.
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderElectionResultsPng(
  props: ElectionResultsCardProps,
): Promise<Buffer | null> {
  return tryRenderPng(<ElectionResultsCard {...props} />, {
    width: ELECTION_RESULTS_WIDTH,
    height: electionResultsCardHeight(props),
  });
}

/**
 * Election winner announcement card.
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderWinnerCardPng(props: WinnerCardProps): Promise<Buffer | null> {
  return tryRenderPng(<WinnerCard {...props} />, {
    width: WINNER_CARD_WIDTH,
    height: WINNER_CARD_HEIGHT,
  });
}

/**
 * AniList user profile card.
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderAniListProfilePng(
  props: AniListProfileCardProps,
): Promise<Buffer | null> {
  return tryRenderPng(<AniListProfileCard {...props} />, {
    width: ANILIST_PROFILE_WIDTH,
    height: ANILIST_PROFILE_HEIGHT,
  });
}

/**
 * AniList anime/manga card.
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderAniListMediaPng(props: AniListMediaCardProps): Promise<Buffer | null> {
  return tryRenderPng(<AniListMediaCard {...props} />, {
    width: ANILIST_MEDIA_WIDTH,
    height: anilistMediaCardHeight(props),
  });
}

/**
 * AniList character card.
 * Returns the PNG, or null on any render failure so the caller can send its text fallback.
 */
export function renderAniListCharacterPng(
  props: AniListCharacterCardProps,
): Promise<Buffer | null> {
  return tryRenderPng(<AniListCharacterCard {...props} />, {
    width: ANILIST_CHARACTER_WIDTH,
    height: ANILIST_CHARACTER_HEIGHT,
  });
}

/**
 * The shareable Wrapped card of one member (their own numbers only).
 * Returns the PNG, or null on any render failure so the caller can send its fallback.
 *
 * @param data - The member's Wrapped snapshot.
 * @param displayName - The member's display name.
 * @param avatarUrl - The member's avatar as a PNG or JPEG URL (Discord: `extension: "png"`,
 *   resvg cannot decode webp); fetched with {@link fetchImageDataUri}. Null or left out
 *   draws the placeholder.
 */
export async function renderWrappedCardPng(
  data: WrappedData,
  displayName: string,
  avatarUrl: string | null = null,
): Promise<Buffer | null> {
  const avatarDataUri = avatarUrl ? await fetchImageDataUri(avatarUrl) : null;
  return tryRenderPng(<WrappedCard data={data} displayName={displayName} avatarDataUri={avatarDataUri} />, {
    width: WRAPPED_CARD_WIDTH,
    height: wrappedCardHeight(data),
  });
}

/**
 * The shareable server Wrapped card (whole-server numbers; only the best club and the
 * president are named).
 * Returns the PNG, or null on any render failure so the caller can send its fallback.
 *
 * @param data - The server's Wrapped snapshot.
 */
export function renderWrappedServerCardPng(data: ServerWrapped): Promise<Buffer | null> {
  return tryRenderPng(<WrappedServerCard data={data} />, {
    width: WRAPPED_SERVER_CARD_WIDTH,
    height: wrappedServerCardHeight(data),
  });
}
