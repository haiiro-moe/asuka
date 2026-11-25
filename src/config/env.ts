// Validated environment configuration. Bun auto-loads .env, so no dotenv.

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const env = {
  /** Discord bot token. */
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  /** Application (client) id, used for OAuth and command registration. */
  CLIENT_ID: required("CLIENT_ID"),
  /** OAuth2 client secret, used by the web UI login flow. */
  CLIENT_SECRET: required("CLIENT_SECRET"),
  /** The single guild this bot is locked to. The bot leaves every other guild. */
  GUILD_ID: required("GUILD_ID"),
  /** OAuth2 redirect URI registered in the Discord developer portal. */
  OAUTH_REDIRECT: optional("OAUTH_REDIRECT", "http://localhost:3000/auth/callback"),
  /** Public base URL of the web dashboard, used to build links posted in Discord (e.g. /club announce). */
  PUBLIC_URL: optional("PUBLIC_URL", "http://localhost:3000"),
  /** Secret used to sign session cookies (HMAC). */
  SESSION_SECRET: optional("SESSION_SECRET", "dev-insecure-session-secret-change-me"),
  /** Port the web UI listens on. */
  WEB_PORT: Number(optional("WEB_PORT", "3000")),
  /** SQLite database file path. */
  DATABASE_PATH: optional("DATABASE_PATH", "./asuka.sqlite"),
  /** When true, enables HMR/dev console for the web server. */
  DEV: optional("NODE_ENV", "development") !== "production",
  /** AniList OAuth app id (https://anilist.co/settings/developer). Empty = /al link disabled. */
  ANILIST_CLIENT_ID: optional("ANILIST_CLIENT_ID", ""),
  /** AniList OAuth app secret. */
  ANILIST_CLIENT_SECRET: optional("ANILIST_CLIENT_SECRET", ""),
  /** Must exactly match the redirect URL configured on the AniList app. */
  ANILIST_OAUTH_REDIRECT: optional(
    "ANILIST_OAUTH_REDIRECT",
    "http://localhost:3000/auth/anilist/callback",
  ),
} as const;

export type Env = typeof env;
