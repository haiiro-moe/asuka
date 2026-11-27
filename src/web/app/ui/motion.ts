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
 * Holds frame 0 under reduced motion or while `running` is false. A changed `restart` key starts
 * again from frame 0 at once (the old frame is never returned for the new key), which lets a caller
 * run a one-shot sequence: start it with a new key and stop `running` on the last frame. The interval
 * is cleared on stop, restart and unmount.
 */
export function useStepped(count: number, ms: number, running = true, restart?: string | number): number {
  const reduced = useReducedMotion();
  const [state, setState] = useState<{ key: string | number | undefined; frame: number }>({ key: restart, frame: 0 });
  useEffect(() => {
    setState({ key: restart, frame: 0 });
    if (reduced || !running || count < 2) return;
    const t = setInterval(() => setState((s) => ({ key: restart, frame: (s.frame + 1) % count })), ms);
    return () => clearInterval(t);
  }, [reduced, running, count, ms, restart]);
  return state.key === restart ? state.frame : 0;
}
