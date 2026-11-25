import { useEffect, useState } from "react";
import { api } from "./api.ts";

// Module-level cache so display names are resolved once across all pages.
const cache = new Map<string, string>();

/**
 * Resolve a set of user ids to display names. Returns a lookup that falls back
 * to the raw id until the name arrives. Batches unknown ids in one request.
 */
export function useNames(ids: (string | null | undefined)[]): (id: string) => string {
  const [, bump] = useState(0);
  const key = ids.filter(Boolean).join(",");

  useEffect(() => {
    const missing = [...new Set(ids.filter((id): id is string => !!id && !cache.has(id)))];
    if (missing.length === 0) return;
    api
      .usernames(missing)
      .then((map) => {
        for (const [id, name] of Object.entries(map)) cache.set(id, name);
        bump((n) => n + 1);
      })
      .catch(() => {});
  }, [key]);

  return (id: string) => cache.get(id) ?? id;
}

/** Render a user's display name (falls back to the id while loading). */
export function UserName({ id }: { id: string }) {
  const name = useNames([id]);
  return <span>{name(id)}</span>;
}

/** A display name linking to the member's profile page (#/member/:id). */
export function UserLink({ id }: { id: string }) {
  return (
    <a href={`#/member/${id}`} className="underline decoration-2 hover:text-accent">
      <UserName id={id} />
    </a>
  );
}
