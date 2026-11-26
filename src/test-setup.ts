/**
 * Preloaded by `bun test` (see `[test]` in bunfig.toml).
 *
 * `src/config/env.ts` throws on import when a required Discord variable is
 * missing, and `src/db/index.ts` imports it, so any test touching the database
 * would crash before it ran. These placeholders are never used to reach
 * Discord. `??=` keeps a value that is already set in the environment.
 */
process.env.DISCORD_TOKEN ??= "test-discord-token";
process.env.CLIENT_ID ??= "000000000000000001";
process.env.CLIENT_SECRET ??= "test-client-secret";
process.env.GUILD_ID ??= "000000000000000002";
