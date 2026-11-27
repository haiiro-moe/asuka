/**
 * Test fixtures of the relations graph: deterministic sample pairs. Tests and the render harness only.
 *
 * @module
 */
import type { RelationPair } from "../../../../../plugins/activity/types/admin.ts";

/**
 * A snowflake-like member id for sample `i`.
 *
 * @param i - The sample index.
 */
export function sampleId(i: number): string {
  return String(100000000000000000n + BigInt(i) * 7919n);
}

/**
 * A deterministic sample: up to `n` members and `m` pairs, weights falling off with the rank.
 *
 * @param n - Members to draw from.
 * @param m - Pairs wanted.
 */
export function samplePairs(n: number, m: number): RelationPair[] {
  const out: RelationPair[] = [];
  const seen = new Set<string>();
  let k = 0;
  for (let step = 1; out.length < m && step < n * 4; step++) {
    for (let i = 0; i < n && out.length < m; i++) {
      const j = (i * 3 + step * 5 + k++) % n;
      if (i === j) continue;
      const [a, b] = sampleId(i) < sampleId(j) ? [sampleId(i), sampleId(j)] : [sampleId(j), sampleId(i)];
      if (seen.has(`${a}-${b}`)) continue;
      seen.add(`${a}-${b}`);
      out.push({ a, b, weight: Math.max(1, Math.round(400 / (1 + out.length * 0.4))) });
    }
  }
  return out;
}

/**
 * A deterministic, more server-like sample: `n` members in four loose circles, popular members
 * favoured, `m` pairs (fewer when the circles run out), weights falling off with the rank.
 *
 * @param n - Members.
 * @param m - Pairs wanted.
 */
export function circlePairs(n: number, m: number): RelationPair[] {
  let s = 12345;
  const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  const seen = new Set<string>();
  const out: RelationPair[] = [];
  for (let tries = 0; out.length < m && tries < m * 50; tries++) {
    const i = Math.floor(n * next() ** 1.6);
    const sameCircle = next() < 0.8;
    let j = Math.floor(n * next() ** 1.3);
    if (sameCircle) j = (Math.floor(j / 4) * 4 + (i % 4)) % n;
    if (i === j) continue;
    const [a, b] = sampleId(i) < sampleId(j) ? [sampleId(i), sampleId(j)] : [sampleId(j), sampleId(i)];
    if (seen.has(`${a}-${b}`)) continue;
    seen.add(`${a}-${b}`);
    out.push({ a, b, weight: 0 });
  }
  out.forEach((p, k) => (p.weight = Math.max(1, Math.round(420 / (1 + k * 0.35)))));
  return out;
}
