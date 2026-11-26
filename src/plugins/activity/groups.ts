/**
 * Group detection for the president tier.
 *
 * Members and the ties between them (replies, shared voice time) form a web.
 * {@link detectGroups} splits that web into groups of members who mostly talk
 * to each other, and {@link countBridges} counts the ties that cross from one
 * group into another.
 *
 * Both are pure functions of their input. Nothing here reads the database, the
 * clock or a random source, so the same edges always give the same groups.
 * The ids only ever leave this module as group members: the president queries
 * turn the groups into sizes and counts before anything is returned.
 */

/** A tie between two members. It has no direction. */
export interface Edge {
  /** One member. */
  a: string;
  /** The other member. */
  b: string;
  /**
   * How strong the tie is: any positive number, in whatever unit the caller
   * uses. An edge whose weight is not a positive, finite number is no tie and
   * is ignored, and so is an edge from a member to themselves.
   */
  weight: number;
}

/** Sweeps over all members after which label propagation stops, settled or not. */
const MAX_SWEEPS = 100;

/**
 * Two vote totals closer than this count as a tie. Totals are sums of
 * logarithms, so two that are equal on paper can differ in their last bits.
 */
const TIE_EPSILON = 1e-9;

/** Order ids by code unit, the same on every machine and in every locale. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** For each member, the members they are tied to and the weight of each tie. */
type Web = Map<string, Map<string, number>>;

/**
 * Build the web from a list of edges.
 *
 * Edges between the same two members, in either direction, are added up. The
 * edges are sorted first, so the sums, and with them everything derived from
 * the web, do not depend on the order the edges came in.
 *
 * @param edges - The ties, in any order.
 * @returns The web. Each tie is stored under both of its members.
 */
function buildWeb(edges: Edge[]): Web {
  const ties: { lo: string; hi: string; weight: number }[] = [];
  for (const { a, b, weight } of edges) {
    if (a === b || !Number.isFinite(weight) || weight <= 0) continue;
    ties.push(a < b ? { lo: a, hi: b, weight } : { lo: b, hi: a, weight });
  }
  ties.sort((x, y) => compareIds(x.lo, y.lo) || compareIds(x.hi, y.hi) || x.weight - y.weight);

  const web: Web = new Map();
  const add = (from: string, to: string, weight: number) => {
    let row = web.get(from);
    if (!row) {
      row = new Map();
      web.set(from, row);
    }
    row.set(to, (row.get(to) ?? 0) + weight);
  };
  for (const { lo, hi, weight } of ties) {
    add(lo, hi, weight);
    add(hi, lo, weight);
  }
  return web;
}

/**
 * How much a neighbour's vote counts, for every tie of the web.
 *
 * A tie's weight is first put on a log scale (`log2(1 + weight)`, so a weight
 * of 1 stays 1): two members who answer each other two hundred times are close,
 * but not two hundred times closer than two who did so once, and without this
 * one very strong tie would outvote the rest of a group. Then every contact the
 * two members share adds the weaker of the two ties to that contact: a tie
 * inside a circle of mutual contacts counts for more than a lone tie between
 * two circles. That is what keeps one stray reply from merging two groups.
 *
 * @param web - The web, from {@link buildWeb}.
 * @param ids - Every member of the web, sorted.
 * @param contacts - Each member's contacts, sorted.
 * @returns The strength of each tie, stored under both of its members.
 */
function tieStrengths(web: Web, ids: string[], contacts: Map<string, string[]>): Web {
  const scaled = (a: string, b: string) => Math.log2(1 + web.get(a)!.get(b)!);
  const strengths: Web = new Map(ids.map((id) => [id, new Map<string, number>()]));
  for (const a of ids) {
    for (const b of contacts.get(a)!) {
      if (a >= b) continue;
      let strength = scaled(a, b);
      for (const shared of contacts.get(a)!) {
        if (shared !== b && web.get(b)!.has(shared)) {
          strength += Math.min(scaled(a, shared), scaled(b, shared));
        }
      }
      strengths.get(a)!.set(b, strength);
      strengths.get(b)!.set(a, strength);
    }
  }
  return strengths;
}

/**
 * Split a web of members into groups.
 *
 * This is label propagation, made deterministic. Every member starts with
 * their own id as their label, and takes the label that their contacts vote
 * for most strongly; when several labels are level, the smallest one wins. A
 * vote is as strong as the tie it comes over (see `tieStrengths` in this
 * file: log-scaled weight plus shared contacts).
 *
 * The first round is taken by everyone at once, from the starting labels, so
 * each member simply sides with their closest contact. After that the members
 * are visited in sorted order, again and again, each seeing the labels as they
 * are at that moment, until a whole sweep changes nothing (or after 100
 * sweeps). Members who end with the same label and are tied together through
 * each other form one group.
 *
 * Taking the first round at once matters: visited one by one from the start,
 * a member would see contacts that have not chosen yet, each alone with their
 * own label, next to one who already has a group's label, and a level vote
 * would hand them that group's label only because of how the ids sort.
 *
 * There is no randomness and no dependence on input order: the same edges, in
 * any order and either direction, always give exactly the same groups.
 *
 * @param edges - The ties between members. See {@link Edge} for what is ignored.
 * @returns The groups: every member that has at least one tie, in exactly one
 *   group. Members are sorted within a group. Groups are ordered largest first,
 *   then by their first member. A member without any tie is in no group, and no
 *   edges give an empty list.
 *
 * @example
 * ```ts
 * // Two triangles joined by the single edge c-d.
 * detectGroups([
 *   { a: "a", b: "b", weight: 1 }, { a: "b", b: "c", weight: 1 }, { a: "a", b: "c", weight: 1 },
 *   { a: "d", b: "e", weight: 1 }, { a: "e", b: "f", weight: 1 }, { a: "d", b: "f", weight: 1 },
 *   { a: "c", b: "d", weight: 1 },
 * ]);
 * // [["a", "b", "c"], ["d", "e", "f"]]
 * ```
 */
export function detectGroups(edges: Edge[]): string[][] {
  const web = buildWeb(edges);
  const ids = [...web.keys()].sort(compareIds);
  const contacts = new Map(ids.map((id) => [id, [...web.get(id)!.keys()].sort(compareIds)]));
  const strengths = tieStrengths(web, ids, contacts);

  // First round, everyone at once: each contact still holds their own id, so
  // the strongest vote is the closest contact. Contacts are sorted, and only a
  // stronger one replaces the choice, so the smallest id wins a level vote.
  const labels = new Map<string, string>();
  for (const id of ids) {
    let closest = id;
    let closestStrength = Number.NEGATIVE_INFINITY;
    for (const contact of contacts.get(id)!) {
      const strength = strengths.get(id)!.get(contact)!;
      if (strength > closestStrength + TIE_EPSILON) {
        closest = contact;
        closestStrength = strength;
      }
    }
    labels.set(id, closest);
  }

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let changed = false;
    for (const id of ids) {
      const votes = new Map<string, number>();
      for (const contact of contacts.get(id)!) {
        const label = labels.get(contact)!;
        votes.set(label, (votes.get(label) ?? 0) + strengths.get(id)!.get(contact)!);
      }
      let best = labels.get(id)!;
      let bestVotes = Number.NEGATIVE_INFINITY;
      for (const [label, total] of votes) {
        const level = Math.abs(total - bestVotes) <= TIE_EPSILON;
        if ((!level && total > bestVotes) || (level && label < best)) {
          best = label;
          bestVotes = total;
        }
      }
      if (best !== labels.get(id)) {
        labels.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // One label can end up on two parts that no longer touch: split those.
  const groups: string[][] = [];
  const placed = new Set<string>();
  for (const start of ids) {
    if (placed.has(start)) continue;
    const label = labels.get(start)!;
    const group = [start];
    placed.add(start);
    for (let i = 0; i < group.length; i++) {
      for (const contact of contacts.get(group[i]!)!) {
        if (!placed.has(contact) && labels.get(contact) === label) {
          placed.add(contact);
          group.push(contact);
        }
      }
    }
    groups.push(group.sort(compareIds));
  }
  return groups.sort((x, y) => y.length - x.length || compareIds(x[0]!, y[0]!));
}

/**
 * Count the bridges between groups: the pairs of members who are tied to each
 * other but belong to two different groups.
 *
 * A pair counts once, however many edges join it. An edge is skipped when it
 * is no tie (see {@link Edge}) or when one of its members is in none of the
 * given groups, so passing only some of the groups counts only the bridges
 * among those.
 *
 * @param edges - The ties between members.
 * @param groups - The groups to count bridges between, as lists of member ids.
 *   A member listed in more than one group counts as part of the last one.
 * @returns The number of bridging pairs. Two triangles joined by one edge have 1.
 */
export function countBridges(edges: Edge[], groups: string[][]): number {
  const groupOf = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const id of group) groupOf.set(id, index);
  });

  const bridges = new Map<string, Set<string>>();
  let count = 0;
  for (const { a, b, weight } of edges) {
    if (a === b || !Number.isFinite(weight) || weight <= 0) continue;
    const groupA = groupOf.get(a);
    const groupB = groupOf.get(b);
    if (groupA === undefined || groupB === undefined || groupA === groupB) continue;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    let seen = bridges.get(lo);
    if (!seen) {
      seen = new Set();
      bridges.set(lo, seen);
    }
    if (!seen.has(hi)) {
      seen.add(hi);
      count += 1;
    }
  }
  return count;
}
