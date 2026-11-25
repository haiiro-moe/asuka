import type { ReactNode } from "react";
import { randomVibrantPair } from "../util.ts";

/**
 * Vibrant comic-style card background: two-tone gradient, halftone dot
 * overlay, thick black border. Children stack in a column with a gap.
 */
export function ComicBackground(props: { children: ReactNode }) {
  const [from, to] = randomVibrantPair();
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
        borderRadius: 28,
        border: "6px solid #000",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          width: "100%",
          height: "100%",
          padding: 26,
          // Satori won't tile radial-gradient dots, so the halftone-ish comic
          // texture comes from repeating diagonal stripes instead.
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.08) 0px, rgba(0, 0, 0, 0.08) 16px, rgba(0, 0, 0, 0) 16px, rgba(0, 0, 0, 0) 32px)",
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

/** An ivory comic panel for card content sitting on the vibrant background. */
export function Panel(props: { children: ReactNode; grow?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "14px 20px",
        backgroundColor: "#fffbef",
        border: "4px solid #000",
        borderRadius: 16,
        boxShadow: "6px 6px 0 rgba(0, 0, 0, 0.55)",
        flexGrow: props.grow ? 1 : 0,
      }}
    >
      {props.children}
    </div>
  );
}
