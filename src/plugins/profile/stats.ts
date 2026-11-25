import { eq, desc, gt, sql, and } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { levelProgress } from "../xp/leveling.ts";

/** 1-based rank of a member on the social-credits leaderboard. */
export function getCreditRank(userId: string): number {
  const member = db
    .select({ credits: schema.members.socialCredits })
    .from(schema.members)
    .where(eq(schema.members.userId, userId))
    .get();
  if (!member) return 0;
  const ahead = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.members)
    .where(gt(schema.members.socialCredits, member.credits))
    .get();
  return (ahead?.n ?? 0) + 1;
}

/** Names of the approved clubs a member belongs to. */
export function getMemberClubs(userId: string): string[] {
  return db
    .select({ name: schema.clubs.name })
    .from(schema.clubMembers)
    .innerJoin(schema.clubs, eq(schema.clubMembers.clubId, schema.clubs.id))
    .where(
      and(
        eq(schema.clubMembers.userId, userId),
        eq(schema.clubs.status, "approved"),
      ),
    )
    .all()
    .map((r) => r.name);
}

/** A unicode progress bar, e.g. ▰▰▰▱▱▱▱▱▱▱. */
export function progressBar(current: number, needed: number, width = 10): string {
  const ratio = needed > 0 ? Math.min(1, current / needed) : 0;
  const filled = Math.round(ratio * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

/** Total members on the leaderboard. */
export function memberCount(): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.members)
      .get()?.n ?? 0
  );
}

/** One page of the social-credits leaderboard (pageSize rows). */
export function leaderboardPage(page: number, pageSize = 10) {
  return db
    .select()
    .from(schema.members)
    .orderBy(desc(schema.members.socialCredits), desc(schema.members.xp))
    .limit(pageSize)
    .offset(page * pageSize)
    .all();
}

export { levelProgress };
