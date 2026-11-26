import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { InkLink } from "./ui.ts";

// Module-level cache so display names are resolved once across all pages.
const cache = new Map<string, string>();

/** Ids already requested (in flight or done), so a known id is never requested twice. */
const requested = new Set<string>();
/** Ids queued during this tick, flushed as one request. */
let queue: string[] = [];
/** Components to re-render when names arrive. */
const listeners = new Set<() => void>();

/** Queue ids for one batched `/api/usernames` request per tick. */
function request(ids: string[]): void {
  const fresh = ids.filter((id) => !cache.has(id) && !requested.has(id));
  if (fresh.length === 0) return;
  for (const id of fresh) requested.add(id);
  if (queue.length === 0) {
    setTimeout(() => {
      const batch = queue;
      queue = [];
      api
        .usernames(batch)
        .then((map) => {
          for (const [id, name] of Object.entries(map)) cache.set(id, name);
          for (const l of [...listeners]) l();
        })
        .catch(() => {
          for (const id of batch) requested.delete(id);
        });
    }, 0);
  }
  queue.push(...fresh);
}

/**
 * Resolve a set of user ids to display names. Returns a lookup that falls back
 * to the raw id until the name arrives. Ids requested in the same tick across
 * all callers are batched into one request, and known ids are never re-requested.
 */
export function useNames(ids: (string | null | undefined)[]): (id: string) => string {
  const [, bump] = useState(0);
  const key = ids.filter(Boolean).join(",");

  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    request(ids.filter((id): id is string => !!id));
  }, [key]);

  return (id: string) => cache.get(id) ?? id;
}

/** Render a user's display name (falls back to the id while loading). */
export function UserName({ id }: { id: string }) {
  const name = useNames([id]);
  return <span>{name(id)}</span>;
}

/**
 * A display name linking to the member's profile page (`#/member/:id`), as a pine InkLink
 * (the global foam focus ring applies).
 */
export function UserLink({ id }: { id: string }) {
  return (
    <InkLink tone="pine" href={`#/member/${id}`}>
      <UserName id={id} />
    </InkLink>
  );
}
