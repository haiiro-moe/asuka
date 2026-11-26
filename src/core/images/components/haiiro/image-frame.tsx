import { border, color, font, fontSize, ink, lineHeight } from "./tokens.ts";
import { cleanText } from "./text.tsx";

/** SVG data URI from markup. Base64 keeps satori's URL parsing out of the way. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * A `w` x `h` checker of muted over base in 2px squares (the system's `.dith`
 * placeholder), as an SVG data URI built from a pattern, so it stays a few hundred bytes
 * at any size.
 */
function checkerUri(w: number, h: number): string {
  return svgDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">` +
      `<defs><pattern id="d" width="4" height="4" patternUnits="userSpaceOnUse">` +
      `<rect width="4" height="4" fill="${color.base}"/>` +
      `<rect width="2" height="2" fill="${color.muted}"/><rect x="2" y="2" width="2" height="2" fill="${color.muted}"/>` +
      `</pattern></defs><rect width="${w}" height="${h}" fill="url(#d)"/></svg>`,
  );
}

/** Props for {@link ImageFrame}. */
export interface ImageFrameProps {
  /** Image as a PNG/JPEG data URI (see `fetchImageDataUri`), or null for the placeholder. */
  src: string | null;
  /** Outer width in px, hairline included. Also the height unless `height` is given. */
  size: number;
  /**
   * Outer height in px (default `size`, a square). The system shows content images as
   * square crops; a taller box is for AniList covers only.
   */
  height?: number;
  /** A character drawn over the placeholder when there is no image (e.g. a name's initial). */
  initial?: string;
}

/**
 * A content image (avatar, AniList cover or character art, event image, store icon) in
 * full colour: cropped to fill the box (`object-fit: cover`), 1px `ink-muted` hairline,
 * no radius, no shadow, scaled smoothly. Content images are never dithered (decisions
 * D-012/D-015); without an image the box shows the system's two-tone dither placeholder.
 *
 * @param props - {@link ImageFrameProps}
 */
export function ImageFrame(props: ImageFrameProps) {
  const w = Math.round(props.size);
  const h = Math.round(props.height ?? props.size);
  const iw = w - 2 * border.hairline;
  const ih = h - 2 * border.hairline;
  const letter = props.initial ? cleanText(props.initial).slice(0, 1) : "";
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: w,
        height: h,
        flexShrink: 0,
        border: `${border.hairline}px solid ${ink.muted}`,
        backgroundColor: color.base,
      }}
    >
      <img
        src={props.src ?? checkerUri(iw, ih)}
        width={iw}
        height={ih}
        style={{ width: iw, height: ih, objectFit: "cover" }}
      />
      {!props.src && letter ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            width: iw,
            height: ih,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: iw >= 64 ? fontSize.large : fontSize.body,
              lineHeight,
              color: color.text,
              backgroundColor: color.base,
              paddingLeft: 4,
              paddingRight: 4,
            }}
          >
            {letter.toUpperCase()}
          </span>
        </div>
      ) : null}
    </div>
  );
}
