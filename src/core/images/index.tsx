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
};
export type { PresidencyTerm } from "./components/profile-card.tsx";
export type { LeaderboardRow } from "./components/leaderboard-card.tsx";
export type { ElectionResultsRow } from "./components/election-results-card.tsx";

/** All renderers return null on failure so callers can fall back to text. */

export function renderTitleBannerPng(title: string): Promise<Buffer | null> {
  return tryRenderPng(<TitleBanner title={title} />, {
    width: BANNER_WIDTH,
    height: BANNER_HEIGHT,
  });
}

export function renderProfileCardPng(props: ProfileCardProps): Promise<Buffer | null> {
  return tryRenderPng(<ProfileCard {...props} />, {
    width: PROFILE_WIDTH,
    height: profileCardHeight(props),
  });
}

export function renderElectionProfileCardPng(
  props: ElectionProfileCardProps,
): Promise<Buffer | null> {
  return tryRenderPng(<ElectionProfileCard {...props} />, {
    width: ELECTION_PROFILE_WIDTH,
    height: ELECTION_PROFILE_HEIGHT,
  });
}

export function renderLeaderboardCardPng(props: LeaderboardCardProps): Promise<Buffer | null> {
  return tryRenderPng(<LeaderboardCard {...props} />, {
    width: LEADERBOARD_WIDTH,
    height: leaderboardCardHeight(props),
  });
}

export function renderElectionResultsPng(
  props: ElectionResultsCardProps,
): Promise<Buffer | null> {
  return tryRenderPng(<ElectionResultsCard {...props} />, {
    width: ELECTION_RESULTS_WIDTH,
    height: electionResultsCardHeight(props),
  });
}

export function renderWinnerCardPng(props: WinnerCardProps): Promise<Buffer | null> {
  return tryRenderPng(<WinnerCard {...props} />, {
    width: WINNER_CARD_WIDTH,
    height: WINNER_CARD_HEIGHT,
  });
}

export function renderAniListProfilePng(
  props: AniListProfileCardProps,
): Promise<Buffer | null> {
  return tryRenderPng(<AniListProfileCard {...props} />, {
    width: ANILIST_PROFILE_WIDTH,
    height: ANILIST_PROFILE_HEIGHT,
  });
}

export function renderAniListMediaPng(props: AniListMediaCardProps): Promise<Buffer | null> {
  return tryRenderPng(<AniListMediaCard {...props} />, {
    width: ANILIST_MEDIA_WIDTH,
    height: anilistMediaCardHeight(props),
  });
}

export function renderAniListCharacterPng(
  props: AniListCharacterCardProps,
): Promise<Buffer | null> {
  return tryRenderPng(<AniListCharacterCard {...props} />, {
    width: ANILIST_CHARACTER_WIDTH,
    height: ANILIST_CHARACTER_HEIGHT,
  });
}
