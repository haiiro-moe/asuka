import { eq, lt } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { env } from "../../config/env.ts";
import { nowSec } from "../../core/util.ts";

/** How long a `/al link` button stays valid before the state row expires. */
const STATE_TTL_SEC = 600;

export function isConfigured(): boolean {
  return !!env.ANILIST_CLIENT_ID && !!env.ANILIST_CLIENT_SECRET;
}

/** Mint a one-time state, tying this OAuth handshake to the Discord user who started it. */
export function createPendingState(userId: string): string {
  const state = crypto.randomUUID();
  // Opportunistic sweep of abandoned handshakes; cheap and keeps the table small.
  db.delete(schema.anilistOauthStates)
    .where(lt(schema.anilistOauthStates.expiresAt, nowSec()))
    .run();
  db.insert(schema.anilistOauthStates)
    .values({ state, userId, expiresAt: nowSec() + STATE_TTL_SEC })
    .run();
  return state;
}

/** Atomically claim a pending state, returning the Discord user id or null if unknown/expired. */
export function consumePendingState(state: string): string | null {
  const row = db
    .delete(schema.anilistOauthStates)
    .where(eq(schema.anilistOauthStates.state, state))
    .returning()
    .get();
  if (!row || row.expiresAt < nowSec()) return null;
  return row.userId;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.ANILIST_CLIENT_ID,
    redirect_uri: env.ANILIST_OAUTH_REDIRECT,
    response_type: "code",
    state,
  });
  return `https://anilist.co/api/v2/oauth/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/** Exchange an authorization code for an access token (AniList issues no refresh token). */
export async function exchangeCode(code: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch("https://anilist.co/api/v2/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: env.ANILIST_CLIENT_ID,
      client_secret: env.ANILIST_CLIENT_SECRET,
      redirect_uri: env.ANILIST_OAUTH_REDIRECT,
      code,
    }),
  });
  if (!res.ok) throw new Error(`AniList token exchange failed (${res.status})`);
  const data = (await res.json()) as TokenResponse;
  return { accessToken: data.access_token, expiresAt: nowSec() + data.expires_in };
}
