/**
 * AniList dark-theme palette, lifted from anilist.co computed styles
 * (site-theme-dark CSS variables) so the cards match the website.
 */
export const AL = {
  bg: "#0b1622", //          --color-background
  card: "#151f2e", //        --color-foreground
  overlay: "#1f2631", //     --color-overlay
  text: "#9fadbd", //        --color-text
  textLight: "#728aa1", //   --color-text-light
  textLighter: "#8596a5", // --color-text-lighter
  heading: "#edf1f5", //     header/username color
  blue: "#3db4f2", //        --color-blue
  green: "#7bd555",
  red: "#e85d75",
  orange: "#f79a63",
} as const;

/** AniList profile accent colors (User.options.profileColor names). */
const PROFILE_COLORS: Record<string, string> = {
  blue: "#3db4f2",
  purple: "#c063ff",
  green: "#4cca51",
  orange: "#ef881a",
  red: "#e13333",
  pink: "#fc9dd6",
  gray: "#677b94",
};

export function profileAccent(profileColor: string | null | undefined): string {
  if (!profileColor) return AL.blue;
  if (profileColor.startsWith("#")) return profileColor;
  return PROFILE_COLORS[profileColor.toLowerCase()] ?? AL.blue;
}

/** Score → AniList-style traffic light (green/orange/red). */
export function scoreColor(score: number): string {
  if (score >= 75) return AL.green;
  if (score >= 60) return AL.orange;
  return AL.red;
}
