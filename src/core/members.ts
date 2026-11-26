import { eq, sql } from "drizzle-orm";
import { db, schema, getConfig } from "../db/index.ts";
import { captureCredit } from "../plugins/activity/capture/hooks.ts";
import { levelFromXp } from "../plugins/xp/leveling.ts";
import { randomInt } from "./util.ts";

type Member = typeof schema.members.$inferSelect;

/** Fetch a member row, creating it on first access. */
export function ensureMember(userId: string): Member {
  const existing = db
    .select()
    .from(schema.members)
    .where(eq(schema.members.userId, userId))
    .get();
  if (existing) return existing;
  return db.insert(schema.members).values({ userId }).returning().get();
}

/**
 * Add XP to a member and recompute their level. Returns the new level and
 * whether they leveled up so callers can announce it.
 */
export function addXp(userId: string, amount: number) {
  const member = ensureMember(userId);
  const newXp = member.xp + amount;
  const newLevel = levelFromXp(newXp);
  db.update(schema.members)
    .set({ xp: newXp, level: newLevel })
    .where(eq(schema.members.userId, userId))
    .run();
  return { xp: newXp, level: newLevel, leveledUp: newLevel > member.level };
}

/**
 * Simulate `messages` worth of message activity for a member: rolls the
 * per-message XP range that many times (same distribution as real messages)
 * and folds the count into their overall message activity. Used by admin
 * tooling, not the live message listener.
 */
export function simulateActivity(userId: string, messages: number) {
  const cfg = getConfig();
  let gainedXp = 0;
  for (let i = 0; i < messages; i++) {
    gainedXp += randomInt(cfg.xpMessageMin, cfg.xpMessageMax);
  }
  const { xp, level, leveledUp } = addXp(userId, gainedXp);
  db.update(schema.members)
    .set({ messageCount: sql`${schema.members.messageCount} + ${messages}` })
    .where(eq(schema.members.userId, userId))
    .run();
  return { xp, level, leveledUp, gainedXp };
}

/** Add (or subtract) social credits, clamped at zero. */
export function addCredits(userId: string, amount: number): number {
  ensureMember(userId);
  const row = db
    .update(schema.members)
    .set({ socialCredits: sql`max(0, ${schema.members.socialCredits} + ${amount})` })
    .where(eq(schema.members.userId, userId))
    .returning()
    .get();
  captureCredit(userId, amount, row.socialCredits);
  return row.socialCredits;
}
