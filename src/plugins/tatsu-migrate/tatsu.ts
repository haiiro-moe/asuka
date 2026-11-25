/**
 * Minimal Tatsu API client (https://api.tatsu.gg/v1), used only by the
 * one-shot /migrate-tatsu import. Auth is a raw API key in the Authorization
 * header (guild owner obtains it via Tatsu's `t!apikey`). Rate limit is
 * 60 requests/minute, so page fetches are paced ~1/sec and 429s are retried.
 */

const BASE_URL = "https://api.tatsu.gg/v1";
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 1100;
const RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_RETRIES_PER_PAGE = 3;

export interface TatsuRanking {
  rank: number;
  score: number;
  user_id: string;
}

interface RankingsPage {
  guild_id: string;
  rankings: TatsuRanking[];
}

export class TatsuApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(
  apiKey: string,
  guildId: string,
  offset: number,
): Promise<RankingsPage> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `${BASE_URL}/guilds/${guildId}/rankings/all?offset=${offset}`,
      { headers: { Authorization: apiKey } },
    );
    if (res.status === 429 && attempt < MAX_RETRIES_PER_PAGE) {
      await sleep(RATE_LIMIT_BACKOFF_MS);
      continue;
    }
    if (res.status === 401) throw new TatsuApiError(401, "Invalid Tatsu API key.");
    if (!res.ok) {
      throw new TatsuApiError(res.status, `Tatsu API returned HTTP ${res.status}.`);
    }
    return (await res.json()) as RankingsPage;
  }
}

/**
 * Fetch the full all-time guild leaderboard, 100 members per page, invoking
 * `onPage` after each page so callers can surface progress.
 */
export async function fetchAllRankings(
  apiKey: string,
  guildId: string,
  onPage?: (fetched: number) => void | Promise<void>,
): Promise<TatsuRanking[]> {
  const all: TatsuRanking[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(apiKey, guildId, offset);
    if (!page.rankings?.length) break;
    all.push(...page.rankings);
    await onPage?.(all.length);
    if (page.rankings.length < PAGE_SIZE) break;
    await sleep(PAGE_DELAY_MS);
  }
  return all;
}
