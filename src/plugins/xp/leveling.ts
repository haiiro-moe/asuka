/**
 * Mee6-style leveling curve. XP required to advance *from* level L to L+1:
 *   5*L^2 + 50*L + 100
 * Totals are cumulative sums of that per-level cost.
 */

/** XP needed to go from `level` to `level + 1`. */
export function xpToNextLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Total XP required to *reach* `level` from zero. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNextLevel(l);
  return total;
}

/** The level a member with `xp` total experience has reached. */
export function levelFromXp(xp: number): number {
  let level = 0;
  while (xp >= totalXpForLevel(level + 1)) level++;
  return level;
}

/** Progress within the current level: { current, needed } toward the next. */
export function levelProgress(xp: number): {
  level: number;
  current: number;
  needed: number;
} {
  const level = levelFromXp(xp);
  const base = totalXpForLevel(level);
  return {
    level,
    current: xp - base,
    needed: xpToNextLevel(level),
  };
}
