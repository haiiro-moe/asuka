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

/** The dashboard's IBM VGA 8x16 regular face (about 15 KB), inlined into the AniList callback page. */
const IBM_REGULAR_WOFF2 = new URL("./app/fonts/IBMVGA8x16-Regular.woff2", import.meta.url);

let ibmFontFace: Promise<string> | null = null;

/**
 * An `@font-face` rule for family `IBM` with the IBM VGA regular face as a base64 data URI, read once and
 * cached. If the file cannot be read the rule is empty and the page falls back to the system monospace.
 */
function ibmFontFaceRule(): Promise<string> {
  ibmFontFace ??= Bun.file(IBM_REGULAR_WOFF2)
    .bytes()
    .then(
      (bytes) =>
        `@font-face { font-family: IBM; src: url("data:font/woff2;base64,${Buffer.from(bytes).toString("base64")}") format("woff2"); font-weight: 400; font-style: normal; font-display: block; }`,
    )
    .catch((err) => {
      console.error("[web] could not read the IBM font for the AniList page:", err);
      return "";
    });
  return ibmFontFace;
}

/**
 * Minimal standalone confirmation page for the AniList OAuth redirect landing, in haiiro: a window on the
 * base colour with the message as a narrator line (love when it failed). The page is a plain string with
 * no bundle, so the colours are the haiiro tokens (Rosé Pine: base, surface, pine, text, rose, love)
 * written out, and the IBM VGA face is inlined as a data URI ({@link ibmFontFaceRule}). It makes no
 * request to any host, not even its own.
 *
 * @param status - HTTP status of the response; 2xx shows a pine frame, anything else a love one.
 * @param message - HTML of the message (callers escape user data).
 */
async function anilistCallbackPage(status: number, message: string): Promise<Response> {
  const ok = status >= 200 && status < 300;
  const fontFace = await ibmFontFaceRule();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>asuka · anilist</title>
<style>
  ${fontFace}
  :root { --color-base: #191724; --color-surface: #1f1d2e; --color-pine: #31748f; --color-text: #e0def4;
    --color-rose: #ebbcba; --color-love: #eb6f92; --color-foam: #9ccfd8; --color-gold: #f6c177; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--color-base); color: var(--color-text);
    font-family: IBM, Unifont, "Unifont Upper", ui-monospace, monospace; font-size: 16px; line-height: 1.15; }
  .window { position: relative; box-sizing: border-box; width: 520px; max-width: calc(100% - 32px); padding: 5px;
    background: var(--color-surface); border: 5px double var(--color-pine); }
  .window.love { border-color: var(--color-love); }
  .section-header { position: absolute; top: 0; left: 15px; transform: translateY(-50%); padding: 0 1ch;
    background: var(--color-surface); }
  .content { padding: 14px 12px 12px; }
  p { margin: 0; }
  p + p { margin-top: 1.15em; }
  .nar { color: var(--color-rose); }
  .nar.love { color: var(--color-love); }
  .c2 { color: var(--color-love); } .c3 { color: var(--color-gold); } .c4 { color: var(--color-rose); }
  .c6 { color: var(--color-foam); }
  strong { color: var(--color-foam); font-weight: inherit; }
</style></head>
<body><section class="window${ok ? "" : " love"}"><span class="section-header">fish: ~/anilist</span>
<div class="content"><p><span class="c2">@</span> <span class="c6">asuka</span> <span class="c4">»</span> <span class="c3">al link</span></p>
<p class="nar${ok ? "" : " love"}">${message}</p></div></section></body></html>`;
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
      // render the token-driven announce composer / purchased panel editor /
      // Wrapped stories instead of the dashboard.
      "/club-announce/:token": index,
      "/panel/:token": index,
      "/wrapped/s/:token": index,
      "/wrapped/:token": index,

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
        if (!code || !state) return anilistCallbackPage(400, "missing code or state.");

        const userId = consumeAniListState(state);
        if (!userId) {
          return anilistCallbackPage(
            410,
            "this link expired or was already used. run /al link again in discord.",
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
            `linked to anilist as <strong>${escapeHtml(viewer.name)}</strong>. you can close this tab and go back to discord. try /al profile.`,
          );
        } catch (err) {
          console.error("[anilist] oauth callback failed:", err);
          return anilistCallbackPage(500, "something went wrong linking your anilist account. try /al link again.");
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
