import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { env } from "../config/env.ts";
import * as schema from "./schema.ts";

// bun test sets NODE_ENV=test — keep tests off the real database file.
const sqlite = new Database(
  process.env.NODE_ENV === "test" ? ":memory:" : env.DATABASE_PATH,
  { create: true },
);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
export { schema };

/** Apply migrations and ensure singleton rows exist. Call once on boot. */
export function initDb() {
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  // Ensure singleton rows (guild config + president) exist.
  db.insert(schema.guildConfig).values({ id: 1 }).onConflictDoNothing().run();
  db.insert(schema.president).values({ id: 1 }).onConflictDoNothing().run();
}

/** Fetch the singleton guild configuration row. */
export function getConfig() {
  const row = db
    .select()
    .from(schema.guildConfig)
    .where(eq(schema.guildConfig.id, 1))
    .get();
  if (!row) throw new Error("guild_config not initialized; call initDb() first");
  return row;
}

export type GuildConfig = ReturnType<typeof getConfig>;
