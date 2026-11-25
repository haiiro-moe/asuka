/** Inclusive random integer in [min, max]. */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Current unix time in seconds. */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const DURATION_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/**
 * Parse a human duration like "10m", "1h30m", "2d" into seconds.
 * Returns null if nothing parses.
 */
export function parseDuration(input: string): number | null {
  const matches = input.toLowerCase().matchAll(/(\d+)\s*([smhdw])/g);
  let total = 0;
  let found = false;
  for (const m of matches) {
    found = true;
    total += Number(m[1]) * DURATION_UNITS[m[2]!]!;
  }
  return found ? total : null;
}

/** Format a span of seconds into a compact human string, e.g. "1h 30m". */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const parts: string[] = [];
  const units: [string, number][] = [
    ["w", 604800],
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ];
  let remaining = seconds;
  for (const [label, size] of units) {
    if (remaining >= size) {
      parts.push(`${Math.floor(remaining / size)}${label}`);
      remaining %= size;
    }
  }
  return parts.slice(0, 2).join(" ");
}

/** Discord relative timestamp markup, e.g. <t:1700000000:R>. */
export function relativeTime(unixSeconds: number): string {
  return `<t:${unixSeconds}:R>`;
}

/**
 * Hosts the bot should reach over the LAN instead of the public internet
 * (self-hosted image servers etc. behind the same Proxmox host), mapped to
 * their internal address.
 */
const INTERNAL_HOST_MAP: Record<string, string> = {
  "safe.haiiro.moe": "10.0.0.102:3923",
};

/**
 * Rewrite a URL's host/port when it's one the bot should hit directly on the
 * LAN. Only apply this to URLs the bot process itself fetches (e.g. avatar
 * images for satori cards, or an icon fetched before `guild.setIcon`) — never
 * to URLs handed to Discord's API for it to fetch server-side (embeds,
 * Components V2 media galleries), since Discord's servers can't reach a
 * private address.
 */
export function remapInternalHost(url: string): string {
  try {
    const u = new URL(url);
    const target = INTERNAL_HOST_MAP[u.hostname.toLowerCase()];
    if (!target) return url;
    u.protocol = "http:";
    u.host = target;
    return u.toString();
  } catch {
    return url;
  }
}
