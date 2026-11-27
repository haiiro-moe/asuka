import type { GuildOptions } from "./ui/channel-ids.ts";

export interface Me {
  userId: string;
  role: "admin" | "president" | "user";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? res.statusText);
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  getConfig: () => request<Record<string, any>>("GET", "/api/config"),
  updateConfig: (patch: Record<string, any>) =>
    request<Record<string, any>>("PUT", "/api/config", patch),
  stats: () => request<any>("GET", "/api/stats"),
  leaderboard: () => request<any[]>("GET", "/api/leaderboard"),

  autoreplies: () => request<any[]>("GET", "/api/autoreplies"),
  createAutoreply: (data: any) => request<any>("POST", "/api/autoreplies", data),
  updateAutoreply: (id: number, data: any) =>
    request<any>("PUT", `/api/autoreplies/${id}`, data),
  deleteAutoreply: (id: number) => request<void>("DELETE", `/api/autoreplies/${id}`),

  clubs: () => request<any[]>("GET", "/api/clubs"),
  clubDetail: (id: number) => request<any>("GET", `/api/clubs/${id}`),
  memberProfile: (id: string) => request<any>("GET", `/api/members/${id}`),
  approveClub: (id: number) => request<any>("POST", `/api/clubs/${id}/approve`),
  terminateClub: (id: number) => request<any>("POST", `/api/clubs/${id}/terminate`),

  elections: () => request<any>("GET", "/api/elections"),
  startElection: () => request<any>("POST", "/api/elections/start"),
  closeElection: (id: number) => request<any>("POST", `/api/elections/${id}/close`),

  modlog: () => request<any[]>("GET", "/api/modlog"),
  warnings: () => request<any[]>("GET", "/api/warnings"),

  president: () => request<any>("GET", "/api/president"),
  changeTheme: (data: { name?: string; iconUrl?: string }) =>
    request<{ applied: string[] }>("POST", "/api/theme", data),
  presidencyHistory: () => request<any[]>("GET", "/api/presidency-history"),

  usernames: (ids: string[]) =>
    request<Record<string, string>>("POST", "/api/usernames", { ids }),

  store: () => request<any>("GET", "/api/store"),
  buyItem: (id: number, body: Record<string, any> = {}) =>
    request<any>("POST", `/api/store/items/${id}/buy`, body),
  inventory: () => request<any>("GET", "/api/inventory"),
  updateCustomRole: (body: { roleName: string; roleColor: string }) =>
    request<any>("PUT", "/api/inventory/custom-role", body),

  botMessages: () =>
    request<{ messages: any[]; variables: string[]; isOwner: boolean }>(
      "GET",
      "/api/bot-messages",
    ),
  updateBotMessage: (key: string, components: unknown[]) =>
    request<any>("PUT", `/api/bot-messages/${key}`, { components }),
  resetBotMessage: (key: string) => request<any>("DELETE", `/api/bot-messages/${key}`),
  linkBotMessageItem: (key: string, itemId: number) =>
    request<any>("PUT", `/api/bot-messages/${key}/link`, { itemId }),
  createBotMessageItem: (key: string, data: { name: string; price: number }) =>
    request<any>("POST", `/api/bot-messages/${key}/store-item`, data),

  variables: () => request<any[]>("GET", "/api/variables"),
  createVariable: (data: any) => request<any>("POST", "/api/variables", data),
  updateVariable: (id: number, data: any) =>
    request<any>("PUT", `/api/variables/${id}`, data),
  deleteVariable: (id: number) => request<void>("DELETE", `/api/variables/${id}`),
  testVariable: (code: string) =>
    request<{ ok: true; result: string; ms: number }>("POST", "/api/variables/test", { code }),

  events: () => request<any[]>("GET", "/api/events"),
  toggleEventParticipation: (id: number) =>
    request<{ joined: boolean; participantIds: string[] }>(
      "POST",
      `/api/events/${id}/participation`,
    ),
  createEvent: (data: any) => request<any>("POST", "/api/events", data),
  updateEvent: (id: number, data: any) => request<any>("PUT", `/api/events/${id}`, data),
  deleteEvent: (id: number) => request<void>("DELETE", `/api/events/${id}`),
  eventGroups: () => request<any[]>("GET", "/api/event-groups"),
  createEventGroup: (data: any) => request<any>("POST", "/api/event-groups", data),
  updateEventGroup: (id: number, data: any) =>
    request<any>("PUT", `/api/event-groups/${id}`, data),
  deleteEventGroup: (id: number) => request<void>("DELETE", `/api/event-groups/${id}`),
  /** The guild's channels and roles for the config pickers (admin only). Both lists are empty when the guild is not cached. */
  guildOptions: () => request<GuildOptions>("GET", "/api/guild-options"),
  eventOptions: () =>
    request<{
      channels: { id: string; name: string; type: string }[];
      roles: { id: string; name: string }[];
      storeItems: { id: number; name: string; kind: string }[];
    }>("GET", "/api/event-options"),

  storeItems: () => request<any[]>("GET", "/api/store/items"),
  createStoreItem: (data: any) => request<any>("POST", "/api/store/items", data),
  updateStoreItem: (id: number, data: any) =>
    request<any>("PUT", `/api/store/items/${id}`, data),
  deleteStoreItem: (id: number) => request<void>("DELETE", `/api/store/items/${id}`),
};
