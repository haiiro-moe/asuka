/**
 * Shared helpers of the dashboard pages: the haiiro primitives (re-exported from `./ui/`), the legacy
 * class strings the pages used before the haiiro redesign, and {@link useAsync}.
 *
 * New code should use the components (`Window`, `InkButton`, `PromptField`, ...). The class strings stay
 * so pages keep compiling while they move over; they now map onto haiiro classes.
 *
 * @module
 */
import { useEffect, useState } from "react";

export * from "./ui/index.ts";

/**
 * The default accent for new bot messages, auto-replies, store roles and club announcements: the palette's
 * pine (`#31748f`), as the integer Discord and the API store. Never Discord blurple or the old club pink
 * (decision D-020). Text is never drawn on it at body size (pine is about 3.4:1 on base).
 */
export const ACCENT_DEFAULT = 0x31748f;

/**
 * A framed block of content: a haiiro Window without a label. Prefer `<Window label="fish: ~/path">`.
 * @deprecated Use the `Window` component.
 */
export const card = "window p-3";

/**
 * The gold InkButton: the one action of a window (save, apply, buy, start). Prefer `<InkButton tone="gold">`.
 * @deprecated Use the `InkButton` component.
 */
export const btn = "ink c3";

/**
 * The muted InkButton: cancel, dismiss, secondary actions. Prefer `<InkButton tone="muted">` or
 * `tone="flat"` for row actions.
 * @deprecated Use the `InkButton` component.
 */
export const btnGhost = "ink c1";

/**
 * A bare text box: the system's TextArea box (hairline on base) at one line. Prefer `PromptField`,
 * `TextArea` or `Select`.
 * @deprecated Use `PromptField`, `TextArea` or `Select`.
 */
export const input = "area min-h-0 px-2 py-1";

/**
 * Runs an async loader on mount (and whenever `deps` change) and keeps its result.
 *
 * @param fn - The loader, usually an `api.*` call.
 * @param deps - Re-run the loader when these change (React effect dependencies).
 * @returns `data` (null until the first success), `error` (the last failure's message, or null),
 *   `reload` to run the loader again, and `setData` to patch the cached value after a mutation.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => fn().then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    reload();
  }, deps);
  return { data, error, reload, setData };
}
