/**
 * Motion helpers. haiiro never eases: things step between frames or cut, and under
 * `prefers-reduced-motion` they hold still.
 *
 * @module
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True while the visitor asks for reduced motion; follows changes to the setting. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Steps through `count` frames, one every `ms` milliseconds, and returns the current frame index.
 * Holds frame 0 under reduced motion or while `running` is false.
 */
export function useStepped(count: number, ms: number, running = true): number {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (reduced || !running || count < 2) {
      setFrame(0);
      return;
    }
    const t = setInterval(() => setFrame((f) => (f + 1) % count), ms);
    return () => clearInterval(t);
  }, [reduced, running, count, ms]);
  return frame;
}
