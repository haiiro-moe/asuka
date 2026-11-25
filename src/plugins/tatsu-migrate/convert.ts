import type { GuildConfig } from "../../db/index.ts";
import { totalXpForLevel, xpToNextLevel } from "../xp/leveling.ts";
import { randomInt } from "../../core/util.ts";

/**
 * Tatsu's leveling curve: total score required to *reach* level L is
 * 625*L^2/9 (community-derived, matches Tatsu's published XP graph). We
 * convert by preserving the level a member had in Tatsu — plus their
 * fractional progress toward the next one — rather than importing raw score,
 * since the two bots' curves diverge quickly.
 */
export function tatsuTotalScoreForLevel(level: number): number {
  return (625 * level * level) / 9;
}

/** The Tatsu level a member with `score` server score has reached. */
export function tatsuLevelFromScore(score: number): number {
  if (score <= 0) return 0;
  const level = Math.floor(Math.sqrt((9 * score) / 625));
  // Guard against float error right at a level boundary.
  return tatsuTotalScoreForLevel(level + 1) <= score ? level + 1 : level;
}

/**
 * Map a Tatsu server score onto our (Mee6-style) XP scale so the member lands
 * on the same level with the same progress toward the next. Monotonic in
 * `score`, so Tatsu leaderboard order is preserved.
 */
export function tatsuScoreToXp(score: number): { xp: number; level: number } {
  if (score <= 0) return { xp: 0, level: 0 };
  const level = tatsuLevelFromScore(score);
  const floor = tatsuTotalScoreForLevel(level);
  const ceil = tatsuTotalScoreForLevel(level + 1);
  const frac = Math.min((score - floor) / (ceil - floor), 0.999);
  return {
    xp: totalXpForLevel(level) + Math.floor(frac * xpToNextLevel(level)),
    level,
  };
}

/** Tatsu's default server score gain is 10–20 per rewarded message. */
const TATSU_SCORE_PER_MESSAGE = 15;

/** Rough message count implied by a Tatsu server score. */
export function estimateMessages(score: number): number {
  return Math.floor(score / TATSU_SCORE_PER_MESSAGE);
}

/**
 * Replay the economy plugin's credit loop over `messages` simulated messages:
 * thresholds roll every creditWindowMin–Max messages and pay
 * creditRewardMin–Max credits (see economy/index.ts). Returns the earned
 * total plus the first unmet threshold so live messages continue seamlessly.
 */
export function simulateCredits(
  messages: number,
  cfg: Pick<
    GuildConfig,
    "creditWindowMin" | "creditWindowMax" | "creditRewardMin" | "creditRewardMax"
  >,
): { credits: number; nextCreditRewardAt: number } {
  let credits = 0;
  let nextAt = randomInt(cfg.creditWindowMin, cfg.creditWindowMax);
  while (nextAt <= messages) {
    credits += randomInt(cfg.creditRewardMin, cfg.creditRewardMax);
    nextAt += randomInt(cfg.creditWindowMin, cfg.creditWindowMax);
  }
  return { credits, nextCreditRewardAt: nextAt };
}
