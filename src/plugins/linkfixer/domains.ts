/**
 * Platform → "fixed embed" domain table, ported from seriaati/embed-fixer's
 * fixes.py (the project the supported-platform list was sourced from), minus
 * Kemono and FurAffinity (skipped for now) and using URL/string parsing
 * instead of regex for matching — a message can carry many candidate URLs
 * and this runs on every non-bot message, so a Set/Map hostname lookup plus
 * cheap string ops beats compiling/testing a pile of regexes per link.
 */

export interface Fix {
  old: string;
  new: string;
}

export interface PlatformFix {
  key: string;
  label: string;
  hosts: string[];
  matchPath(segs: string[], url: URL): boolean;
  fixes: Fix[];
}

const isDigits = (s: string | undefined): s is string => {
  if (!s || s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
};

const segs = (url: URL): string[] => url.pathname.split("/").filter(Boolean);

export const PLATFORMS: PlatformFix[] = [
  {
    key: "twitter",
    label: "Twitter/X",
    hosts: ["twitter.com", "www.twitter.com", "x.com", "www.x.com"],
    matchPath: (s) => s.length >= 3 && s[1] === "status" && isDigits(s[2]),
    fixes: [
      { old: "twitter.com", new: "tw.gakkoufx.club" },
      { old: "x.com", new: "tw.gakkoufx.club" },
    ],
  },
  {
    key: "pixiv",
    label: "Pixiv",
    hosts: ["pixiv.net", "www.pixiv.net"],
    matchPath: (s) => {
      const idx = s.indexOf("artworks");
      return idx !== -1 && idx <= 1 && isDigits(s[idx + 1]);
    },
    fixes: [{ old: "pixiv.net", new: "px.gakkoufx.club" }],
  },
  {
    key: "tiktok",
    label: "TikTok",
    hosts: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
    matchPath: (s, url) => {
      if (url.hostname === "vm.tiktok.com" || url.hostname === "vt.tiktok.com") {
        return s.length >= 1;
      }
      if (s[0] === "t") return s.length >= 2;
      return !!s[0]?.startsWith("@") && s[1] === "video" && isDigits(s[2]);
    },
    fixes: [{ old: "tiktok.com", new: "tnktok.com" }],
  },
  {
    key: "reddit",
    label: "Reddit",
    hosts: ["reddit.com", "www.reddit.com", "old.reddit.com"],
    matchPath: (s) =>
      s.length >= 3 &&
      (s[0] === "r" || s[0] === "user") &&
      (s[2] === "comments" || s[2] === "s"),
    fixes: [{ old: "reddit.com", new: "fxreddit.seria.moe" }],
  },
  {
    key: "instagram",
    label: "Instagram",
    hosts: ["instagram.com", "www.instagram.com"],
    matchPath: (s) =>
      s.length >= 2 && (s[0] === "share" || s[0] === "p" || s[0] === "reel" || s[0] === "reels"),
    fixes: [{ old: "instagram.com", new: "in.gakkoufx.club" }],
  },
  {
    key: "twitch_clips",
    label: "Twitch Clips",
    hosts: ["clips.twitch.tv", "m.twitch.tv", "twitch.tv", "www.twitch.tv"],
    matchPath: (s, url) => {
      if (url.hostname === "clips.twitch.tv") return s.length >= 1;
      if (url.hostname === "m.twitch.tv") return s[0] === "clip";
      return s[1] === "clip";
    },
    fixes: [
      { old: "clips.twitch.tv", new: "fxtwitch.seria.moe/clip" },
      { old: "m.twitch.tv", new: "fxtwitch.seria.moe" },
      { old: "twitch.tv", new: "fxtwitch.seria.moe" },
    ],
  },
  {
    key: "iwara",
    label: "Iwara",
    hosts: ["iwara.tv", "www.iwara.tv"],
    matchPath: (s) => s[0] === "video" && s.length >= 3,
    fixes: [{ old: "iwara.tv", new: "fxiwara.seria.moe" }],
  },
  {
    key: "bluesky",
    label: "Bluesky",
    hosts: ["bsky.app", "www.bsky.app"],
    matchPath: (s) => s[0] === "profile" && s[2] === "post" && s.length >= 4,
    fixes: [{ old: "bsky.app", new: "bskx.app" }],
  },
  {
    key: "facebook",
    label: "Facebook",
    hosts: ["facebook.com", "www.facebook.com"],
    matchPath: (s) => s.length >= 1,
    fixes: [{ old: "facebook.com", new: "facebed.seria.moe" }],
  },
  {
    key: "bilibili",
    label: "Bilibili",
    hosts: ["bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv", "www.b23.tv"],
    matchPath: (s, url) => {
      if (url.hostname.endsWith("b23.tv")) return s.length >= 1;
      return s[0] === "video";
    },
    fixes: [
      { old: "m.bilibili.com", new: "fxbilibili.seria.moe" },
      { old: "bilibili.com", new: "fxbilibili.seria.moe" },
      { old: "b23.tv", new: "fxbilibili.seria.moe/b23" },
    ],
  },
  {
    key: "bilibili_opus",
    label: "Bilibili Opus",
    hosts: ["bilibili.com", "www.bilibili.com", "m.bilibili.com", "t.bilibili.com"],
    matchPath: (s, url) => {
      if (url.hostname === "t.bilibili.com") return isDigits(s[0]);
      return s[0] === "opus" && isDigits(s[1]);
    },
    fixes: [{ old: "bilibili.com", new: "vxbilibili.com" }],
  },
  {
    key: "tumblr",
    label: "Tumblr",
    hosts: ["tumblr.com", "www.tumblr.com"],
    matchPath: (s) => s.length >= 2 && isDigits(s[1]),
    fixes: [{ old: "tumblr.com", new: "tpmblr.com" }],
  },
  {
    key: "threads",
    label: "Threads",
    hosts: ["threads.net", "www.threads.net", "threads.com", "www.threads.com"],
    matchPath: (s) => !!s[0]?.startsWith("@") || (s[0] === "share" && s.length >= 2),
    fixes: [
      { old: "threads.net", new: "fixthreads.seria.moe" },
      { old: "threads.com", new: "fixthreads.seria.moe" },
    ],
  },
  {
    key: "ptt",
    label: "PTT",
    hosts: ["ptt.cc", "www.ptt.cc"],
    matchPath: (s) =>
      s[0] === "bbs" && s.length >= 3 && !!s[2]?.startsWith("M.") && !!s[2]?.endsWith(".html"),
    fixes: [{ old: "ptt.cc", new: "fxptt.seria.moe" }],
  },
  {
    key: "deviantart",
    label: "DeviantArt",
    hosts: ["deviantart.com", "www.deviantart.com"],
    matchPath: (s) => {
      if (s.length < 3 || s[1] !== "art") return false;
      const slug = s[2]!;
      return isDigits(slug.slice(slug.lastIndexOf("-") + 1));
    },
    fixes: [{ old: "deviantart.com", new: "fixdeviantart.com" }],
  },
  {
    key: "pinterest",
    label: "Pinterest",
    hosts: ["pinterest.com", "www.pinterest.com"],
    matchPath: (s) => s[0] === "pin" && isDigits(s[1]),
    fixes: [{ old: "pinterest.com", new: "pinterestez.com" }],
  },
  {
    key: "youtube",
    label: "YouTube",
    hosts: ["youtube.com", "www.youtube.com", "youtu.be"],
    matchPath: (s, url) => {
      if (url.hostname === "youtu.be") return s.length >= 1;
      return s[0] === "watch" && !!url.searchParams.get("v");
    },
    fixes: [
      { old: "youtube.com", new: "koutube.com" },
      { old: "youtu.be", new: "koutu.be" },
    ],
  },
];

const hostIndex = new Map<string, PlatformFix[]>();
for (const platform of PLATFORMS) {
  for (const host of platform.hosts) {
    const bucket = hostIndex.get(host);
    if (bucket) bucket.push(platform);
    else hostIndex.set(host, [platform]);
  }
}

/** Match a single URL against the platform table and return its fixed-domain form, if any. */
export function fixUrl(rawUrl: string): { key: string; label: string; fixedUrl: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const candidates = hostIndex.get(url.hostname.toLowerCase());
  if (!candidates) return null;

  const pathSegs = segs(url);
  for (const platform of candidates) {
    if (!platform.matchPath(pathSegs, url)) continue;
    for (const fix of platform.fixes) {
      if (rawUrl.includes(fix.old)) {
        return { key: platform.key, label: platform.label, fixedUrl: rawUrl.replace(fix.old, fix.new) };
      }
    }
  }
  return null;
}

const isWhitespace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r";

/** Pull http(s) tokens out of message content without a regex scan. */
export function extractUrls(content: string): string[] {
  const urls: string[] = [];
  let i = 0;
  const len = content.length;
  while (i < len) {
    while (i < len && isWhitespace(content[i]!)) i++;
    const start = i;
    while (i < len && !isWhitespace(content[i]!)) i++;
    if (i > start) {
      const token = content.slice(start, i);
      if (token.startsWith("http://") || token.startsWith("https://")) urls.push(token);
    }
  }
  return urls;
}
