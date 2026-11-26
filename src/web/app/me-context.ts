import { createContext, useContext } from "react";
import type { Me } from "./api.ts";

/** The signed-in dashboard user, provided by App once /api/me resolves (null before that). */
export const MeContext = createContext<Me | null>(null);

/** The signed-in dashboard user, or null outside the dashboard (token pages) and while loading. */
export function useMe(): Me | null {
  return useContext(MeContext);
}

/** Web role tiers, lowest first: user < president < admin. */
export const ROLE_RANK: Record<Me["role"], number> = {
  user: 0,
  president: 1,
  admin: 2,
};

/**
 * Whether `role` is one of the web roles the dashboard knows ({@link ROLE_RANK}). Guards against a
 * server that answers `/api/me` with a role this build has never heard of.
 *
 * @param role - The role from `/api/me`.
 */
export function isKnownRole(role: unknown): role is Me["role"] {
  return typeof role === "string" && Object.hasOwn(ROLE_RANK, role);
}

/**
 * Whether `me` holds at least the `min` web role.
 *
 * @param me - The signed-in user, or null (never passes).
 * @param min - The lowest role that passes.
 */
export function hasRole(me: Me | null, min: Me["role"]): boolean {
  return !!me && isKnownRole(me.role) && ROLE_RANK[me.role] >= ROLE_RANK[min];
}
