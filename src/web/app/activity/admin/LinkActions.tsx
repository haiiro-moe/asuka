/**
 * The page's link controls: `copy link` (to the clipboard, with a fallback line when the clipboard
 * refuses) and an `open` link in a new tab. Used by the real server Wrapped link and by the preview
 * links.
 *
 * @module
 */
import { useState } from "react";
import { InkButton, InkLink, Saved, cx } from "../../ui/index.ts";

/** Props of {@link LinkActions}. */
export interface LinkActionsProps {
  /** The link. */
  url: string;
  /** The open link's word. Defaults to `open`. */
  openLabel?: string;
  /** Classes on the row; defaults to the window's button row (`.btns`). */
  className?: string;
}

/**
 * `copy link` and `open` for one URL, in a row.
 *
 * @param props - See {@link LinkActionsProps}.
 */
export function LinkActions({ url, openLabel = "open", className }: LinkActionsProps) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };
  return (
    <span className={cx("flex flex-wrap items-center gap-2", className)}>
      <InkButton tone="pine" onClick={copy}>
        copy link
      </InkButton>
      <InkLink tone="foam" href={url} target="_blank" rel="noopener noreferrer">
        {openLabel}
      </InkLink>
      {copied === "yes" && <Saved>copied.</Saved>}
      {copied === "no" && (
        <span className="c2" role="status">
          The clipboard said no. Open the link and copy it from the address bar.
        </span>
      )}
    </span>
  );
}
