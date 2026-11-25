import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

type Rule = typeof schema.autoreplies.$inferSelect;

let cache: Rule[] | null = null;

/** Enabled auto-reply rules, loaded once and cached until invalidated. */
export function getRules(): Rule[] {
  if (cache === null) {
    cache = db
      .select()
      .from(schema.autoreplies)
      .where(eq(schema.autoreplies.enabled, 1))
      .all();
  }
  return cache;
}

/** Drop the cache so the next access reloads from the database. */
export function invalidateRules() {
  cache = null;
}
