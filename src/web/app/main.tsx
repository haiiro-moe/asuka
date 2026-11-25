import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ClubAnnouncePage } from "./ClubAnnouncePage.tsx";
import { PanelPage } from "./PanelPage.tsx";
import "./styles.css";

// Random vibrant background hue per load, like the cards' randomVibrantPair().
const hue = Math.floor(Math.random() * 360);
document.documentElement.style.setProperty("--hue", String(hue));

// Text sitting directly on the gradient (`.on-bg`, `.on-bg-soft`) must stay
// readable on any random hue: pick white or ink, whichever has the better
// worst-case WCAG contrast against the two gradient stops.
function hslLuminance(h: number, s: number, l: number): number {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
// The two stops of the body gradient in styles.css.
const stops = [hslLuminance(hue, 90, 62), hslLuminance((hue + 45) % 360, 90, 52)];
const whiteLum = 1;
const inkLum = 0.0105; // --color-ink #1c1917
const whiteWorst = Math.min(...stops.map((s) => contrast(whiteLum, s)));
const inkWorst = Math.min(...stops.map((s) => contrast(inkLum, s)));
const useWhite = whiteWorst >= inkWorst;
document.documentElement.style.setProperty("--on-bg-text", useWhite ? "#fff" : "#1c1917");
document.documentElement.style.setProperty("--on-bg-outline", useWhite ? "#000" : "#fffbef");

const root = createRoot(document.getElementById("root")!);
const announceMatch = location.pathname.match(/^\/club-announce\/([^/]+)/);
const panelMatch = location.pathname.match(/^\/panel\/([^/]+)/);
root.render(
  announceMatch ? (
    <ClubAnnouncePage token={announceMatch[1]!} />
  ) : panelMatch ? (
    <PanelPage token={panelMatch[1]!} />
  ) : (
    <App />
  ),
);
