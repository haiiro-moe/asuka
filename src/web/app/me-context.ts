import { createContext, useContext } from "react";
import type { Me } from "./api.ts";

/** The signed-in dashboard user, provided by App once /api/me resolves. */
export const MeContext = createContext<Me | null>(null);

export function useMe(): Me | null {
  return useContext(MeContext);
}

export const ROLE_RANK: Record<Me["role"], number> = {
  user: 0,
  president: 1,
  admin: 2,
};
