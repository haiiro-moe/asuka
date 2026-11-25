import { env } from "../config/env.ts";
import { db, schema } from "../db/index.ts";
import type { ApiRoute, BotContext } from "../core/plugin.ts";
import {
  buildAuthorizeUrl,
  completeLogin,
  createSessionCookie,
  clearSessionCookie,
  readSession,
  resolveLiveRole,
} from "./auth.ts";
import { dashboardRoutes } from "./routes.ts";
import { WEB_ROLE_RANK } from "../core/permissions.ts";
import {
  consumePendingState as consumeAniListState,
  exchangeCode as exchangeAniListCode,
} from "../plugins/anilist/oauth.ts";
import { fetchViewer as fetchAniListViewer } from "../plugins/anilist/api.ts";
import index from "./app/index.html";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Minimal standalone confirmation page for the AniList OAuth redirect landing. */
function anilistCallbackPage(status: number, message: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Asuka · AniList</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b1622; color: #edf1f5;
    display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { max-width: 420px; text-align: center; padding: 2rem; }
  p { color: #9fadbd; line-height: 1.5; }
</style></head>
<body><div class="card"><p>${message}</p></div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** Compile an ApiRoute path pattern (e.g. "/api/clubs/:id") into a matcher. */
function compile(route: ApiRoute) {
  const keys: string[] = [];
  const pattern = route.path
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}$`), keys, route };
}

export function startWebServer(pluginRoutes: ApiRoute[], ctx: BotContext) {
  const compiled = [...pluginRoutes, ...dashboardRoutes].map(compile);

  /** Match + authorize + dispatch an /api request. */
  async function handleApi(req: Request): Promise<Response> {
    const url = new URL(req.url);

    for (const { regex, keys, route } of compiled) {
      if (route.method !== req.method) continue;
      const match = regex.exec(url.pathname);
      if (!match) continue;
      const params: Record<string, string> = {};
      keys.forEach((k, i) => (params[k] = match[i + 1]!));

      // Public routes skip the dashboard cookie session entirely — the
      // handler authenticates itself (e.g. a one-time token in `params`).
      if (route.access === "public") return route.handle(req, { ...ctx, params, session: null });

      const session = readSession(req);
      if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
      // Role is re-resolved from live guild membership on every request rather
      // than trusted from the (up to 7-day-old) cookie — otherwise a member
      // who becomes president/admin mid-session stays stuck at their old tier.
      const role = await resolveLiveRole(ctx.client, session.userId);
      if (!role) return Response.json({ error: "unauthorized" }, { status: 401 });
      // Tiered access: user < president < admin.
      if (WEB_ROLE_RANK[role] < WEB_ROLE_RANK[route.access]) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      return route.handle(req, { ...ctx, params, session: { ...session, role } });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const server = Bun.serve({
    port: env.WEB_PORT,
    development: env.DEV ? { hmr: true, console: true } : false,
    routes: {
      "/": index,
      // Same SPA shell; the React entrypoint branches on location.pathname to
      // render the token-driven announce composer / purchased panel editor
      // instead of the dashboard.
      "/club-announce/:token": index,
      "/panel/:token": index,

      "/auth/login": () =>
        new Response(null, { status: 302, headers: { Location: buildAuthorizeUrl() } }),

      "/auth/callback": async (req) => {
        const code = new URL(req.url).searchParams.get("code");
        if (!code) return new Response("Missing code", { status: 400 });
        const session = await completeLogin(ctx.client, code);
        if (!session) {
          return new Response("Access denied: you must be a member of the server.", {
            status: 403,
          });
        }
        return new Response(null, {
          status: 302,
          headers: { Location: "/", "Set-Cookie": createSessionCookie(session) },
        });
      },

      "/auth/anilist/callback": async (req) => {
        const url = new URL(req.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return anilistCallbackPage(400, "Missing code or state.");

        const userId = consumeAniListState(state);
        if (!userId) {
          return anilistCallbackPage(
            410,
            "This link expired or was already used — run /al link again in Discord.",
          );
        }

        try {
          const { accessToken, expiresAt } = await exchangeAniListCode(code);
          const viewer = await fetchAniListViewer(accessToken);
          db.insert(schema.anilistLinks)
            .values({
              userId,
              anilistId: viewer.id,
              username: viewer.name,
              accessToken,
              tokenExpiresAt: expiresAt,
            })
            .onConflictDoUpdate({
              target: schema.anilistLinks.userId,
              set: {
                anilistId: viewer.id,
                username: viewer.name,
                accessToken,
                tokenExpiresAt: expiresAt,
              },
            })
            .run();
          return anilistCallbackPage(
            200,
            `Linked to AniList as <strong>${escapeHtml(viewer.name)}</strong>. You can close this tab and go back to Discord — try /al profile.`,
          );
        } catch (err) {
          console.error("[anilist] oauth callback failed:", err);
          return anilistCallbackPage(500, "Something went wrong linking your AniList account — try /al link again.");
        }
      },

      "/auth/logout": () =>
        new Response(null, {
          status: 302,
          headers: { Location: "/", "Set-Cookie": clearSessionCookie() },
        }),

      "/api/me": async (req) => {
        const session = readSession(req);
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
        const role = await resolveLiveRole(ctx.client, session.userId);
        if (!role) return Response.json({ error: "unauthorized" }, { status: 401 });
        return Response.json({ ...session, role });
      },

      "/api/*": handleApi,
    },
  });

  console.log(`[web] listening on http://localhost:${server.port}`);
  return server;
}
