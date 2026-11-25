import { useEffect, useState } from "react";

// Shared class strings for the dashboard pages (comic theme in styles.css).
export const card = "comic-panel p-4";
export const btn = "comic-btn px-4 py-1.5 text-sm";
export const btnGhost = "comic-btn comic-btn--ghost px-3 py-1.5 text-sm";
export const input = "comic-input px-2 py-1 text-sm w-full";

export function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => fn().then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    reload();
  }, deps);
  return { data, error, reload, setData };
}
