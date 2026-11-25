import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.ts";
import { getConfig } from "../db/index.ts";
import { resolveWebRole, type WebRole } from "../core/permissions.ts";
import type { Client } from "discord.js";

const SESSION_TTL_SEC = 7 * 86400;
const COOKIE_NAME = "asuka_session";

export interface Session {
  userId: string;
  role: "admin" | "president" | "user";
}

// --- Cookie signing (HMAC over a base64url JSON payload) ---

function sign(data: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(data).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function createSessionCookie(session: Session): string {
  const payload = Buffer.from(
    JSON.stringify({ ...session, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC }),
  ).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/** Verify the session cookie on a request, returning the session or null. */
export function readSession(req: Request): Session | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const [payload, sig] = match[1]!.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { userId: data.userId, role: data.role };
  } catch {
    return null;
  }
}

// --- Discord OAuth2 code flow ---

export function buildAuthorizeUrl(): string {
  const params = new URLSearchParams({
    client_id: env.CLIENT_ID,
    redirect_uri: env.OAUTH_REDIRECT,
    response_type: "code",
    scope: "identify",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(code: string): Promise<string | null> {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: env.OAUTH_REDIRECT,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

async function fetchDiscordUserId(accessToken: string): Promise<string | null> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ?? null;
}

/**
 * Complete the OAuth callback: exchange the code, identify the user, and resolve
 * their dashboard role by inspecting their membership in the locked guild via
 * the live bot client. Any guild member may sign in (at least as "user");
 * returns null only when the login fails or they aren't in the guild.
 */
export async function completeLogin(
  client: Client,
  code: string,
): Promise<Session | null> {
  const token = await exchangeCode(code);
  if (!token) return null;
  const userId = await fetchDiscordUserId(token);
  if (!userId) return null;

  const guild = await client.guilds.fetch(env.GUILD_ID).catch(() => null);
  if (!guild) return null;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;

  return { userId, role: resolveWebRole(member, getConfig()) };
}

/**
 * Re-resolve a session's role from live guild membership. The role baked into
 * the cookie at login can go stale for up to `SESSION_TTL_SEC` (e.g. a member
 * elected president mid-session), so authorization must use this instead of
 * the cookie's `role` field. Returns null if the member left the guild.
 */
export async function resolveLiveRole(client: Client, userId: string): Promise<WebRole | null> {
  const guild = await client.guilds.fetch(env.GUILD_ID).catch(() => null);
  if (!guild) return null;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;
  return resolveWebRole(member, getConfig());
}
