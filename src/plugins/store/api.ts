import { eq } from "drizzle-orm";
import { db, schema, getConfig } from "../../db/index.ts";
import type { ApiRoute } from "../../core/plugin.ts";
import { isValidComponentsPayload } from "../../core/components.ts";
import {
  getMessageDef,
  getMessagePayload,
  setMessageOverride,
} from "../../core/messages.ts";
import { invalidateRules } from "../autoreply/cache.ts";
import { getOpenElection, getCandidates, applyTheme } from "../elections/service.ts";
import {
  buyItem,
  getItem,
  memberBalance,
  purchasesFor,
  panelLink,
  sabotageUsed,
  hasActiveSabotage,
  activeCustomRole,
  editCustomRole,
  userPurchaseCount,
  totalPurchaseCount,
  openPanelToken,
  getPanelPurchase,
  consumePanelToken,
  releasePanelToken,
  type BuyRequest,
} from "./service.ts";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

const KINDS = ["panel_access", "role", "custom_role", "sabotage"] as const;
const PANELS = ["theme", "autoreply", "botmessage"] as const;
const SABOTAGE_TYPES = ["disable_voting", "cut_votes", "silence"] as const;

/** Validate an admin-submitted item body into insertable values, or an error. */
function parseItem(body: Record<string, any>):
  | { error: string }
  | { values: Omit<typeof schema.storeItems.$inferInsert, "id" | "createdAt"> } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "name required" };
  const kind = body.kind;
  if (!KINDS.includes(kind)) return { error: "invalid kind" };
  const price = Number(body.price);
  if (!Number.isInteger(price) || price < 0) return { error: "price must be a non-negative integer" };
  const iconType = body.iconType === "image" ? "image" : "emoji";
  const icon = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : "🎁";

  const values: Omit<typeof schema.storeItems.$inferInsert, "id" | "createdAt"> = {
    name,
    description: typeof body.description === "string" ? body.description : "",
    iconType,
    icon,
    price,
    kind,
    panel: null,
    messageKey: null,
    roleId: null,
    anchorRoleId: null,
    maxPerUser: null,
    stock: null,
    sabotageType: null,
    sabotageDays: null,
    sabotagePercent: null,
    enabled: body.enabled === false || body.enabled === 0 ? 0 : 1,
  };

  // Optional purchase limits, any kind. Empty/null = unlimited.
  for (const key of ["maxPerUser", "stock"] as const) {
    if (body[key] != null && body[key] !== "") {
      const n = Number(body[key]);
      if (!Number.isInteger(n) || n < 1) return { error: `${key} must be a positive integer` };
      values[key] = n;
    }
  }

  if (kind === "panel_access") {
    if (!PANELS.includes(body.panel)) {
      return { error: "panel must be theme, autoreply or botmessage" };
    }
    values.panel = body.panel;
    if (body.panel === "botmessage") {
      if (typeof body.messageKey !== "string" || !getMessageDef(body.messageKey)) {
        return { error: "messageKey must name a registered bot message" };
      }
      values.messageKey = body.messageKey;
    }
  }
  if (kind === "role") {
    if (typeof body.roleId !== "string" || !/^\d{5,25}$/.test(body.roleId)) {
      return { error: "roleId must be a Discord role id" };
    }
    values.roleId = body.roleId;
  }
  if (kind === "custom_role" && body.anchorRoleId != null && body.anchorRoleId !== "") {
    if (typeof body.anchorRoleId !== "string" || !/^\d{5,25}$/.test(body.anchorRoleId)) {
      return { error: "anchorRoleId must be a Discord role id" };
    }
    values.anchorRoleId = body.anchorRoleId;
  }
  if (kind === "sabotage") {
    if (!SABOTAGE_TYPES.includes(body.sabotageType)) {
      return { error: "invalid sabotageType" };
    }
    values.sabotageType = body.sabotageType;
    if (body.sabotageType === "cut_votes") {
      const percent = Number(body.sabotagePercent);
      if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
        return { error: "sabotagePercent must be 1–100" };
      }
      values.sabotagePercent = percent;
    } else {
      const days = Number(body.sabotageDays);
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        return { error: "sabotageDays must be 1–30" };
      }
      values.sabotageDays = days;
    }
  }
  return { values };
}

// --- Storefront (any signed-in member) ---

/** Items on sale + the caller's SC balance + election context for sabotage. */
const storefront: ApiRoute = {
  method: "GET",
  path: "/api/store",
  access: "user",
  async handle(_req, ctx) {
    const userId = ctx.session!.userId;
    const open = getOpenElection();
    const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
    const items = db
      .select()
      .from(schema.storeItems)
      .where(eq(schema.storeItems.enabled, 1))
      .all()
      // Election-based items only show up while an election is open.
      .filter((i) => i.kind !== "sabotage" || open)
      .map((i) => ({
        ...i,
        soldOut:
          (i.kind === "sabotage" && open ? sabotageUsed(i.id, open.id) : false) ||
          (i.stock != null && totalPurchaseCount(i.id) >= i.stock),
        remainingStock: i.stock != null ? Math.max(0, i.stock - totalPurchaseCount(i.id)) : null,
        limitReached:
          i.maxPerUser != null && userPurchaseCount(i.id, userId) >= i.maxPerUser,
      }));
    return Response.json({
      balance: memberBalance(userId),
      hasCustomRole: guild ? !!activeCustomRole(guild, userId) : false,
      items,
      election: open
        ? {
            id: open.id,
            status: open.status,
            candidates: getCandidates(open.id).map((c) => ({
              userId: c.userId,
              silenced: hasActiveSabotage(open.id, c.userId, "silence"),
              votingDisabled: hasActiveSabotage(open.id, c.userId, "disable_voting"),
            })),
          }
        : null,
    });
  },
};

const buy: ApiRoute = {
  method: "POST",
  path: "/api/store/items/:id/buy",
  access: "user",
  async handle(req, ctx) {
    const item = getItem(Number(ctx.params.id));
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    const body = ((await req.json().catch(() => null)) ?? {}) as BuyRequest;
    const result = await buyItem(ctx.client, ctx.guildId, ctx.session!.userId, item, body);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  },
};

/**
 * The caller's inventory: purchase history (magic links included until
 * submitted) + their active custom role, editable from the profile page.
 */
const inventory: ApiRoute = {
  method: "GET",
  path: "/api/inventory",
  access: "user",
  async handle(_req, ctx) {
    const userId = ctx.session!.userId;
    const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
    const active = guild ? activeCustomRole(guild, userId) : null;
    return Response.json({
      balance: memberBalance(userId),
      customRole: active
        ? {
            roleId: active.role.id,
            name: active.role.name,
            color: `#${active.role.color.toString(16).padStart(6, "0")}`,
            itemName: active.purchase.itemName,
          }
        : null,
      purchases: purchasesFor(userId).map((p) => ({
        id: p.id,
        itemName: p.itemName,
        kind: p.kind,
        price: p.price,
        createdAt: p.createdAt,
        link: p.token && !p.tokenUsedAt ? panelLink(p.token) : null,
        linkUsed: p.token ? !!p.tokenUsedAt : null,
      })),
    });
  },
};

/** Rename/recolor the caller's active custom role (free, any time). */
const updateCustomRole: ApiRoute = {
  method: "PUT",
  path: "/api/inventory/custom-role",
  access: "user",
  async handle(req, ctx) {
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");
    const result = await editCustomRole(ctx.client, ctx.guildId, ctx.session!.userId, body);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  },
};

// --- Admin item editor ---

const listItems: ApiRoute = {
  method: "GET",
  path: "/api/store/items",
  access: "admin",
  handle: () => Response.json(db.select().from(schema.storeItems).all()),
};

const createItem: ApiRoute = {
  method: "POST",
  path: "/api/store/items",
  access: "admin",
  async handle(req) {
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");
    const parsed = parseItem(body);
    if ("error" in parsed) return badRequest(parsed.error);
    const inserted = db.insert(schema.storeItems).values(parsed.values).returning().get();
    return Response.json(inserted, { status: 201 });
  },
};

const updateItem: ApiRoute = {
  method: "PUT",
  path: "/api/store/items/:id",
  access: "admin",
  async handle(req, ctx) {
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");
    const parsed = parseItem(body);
    if ("error" in parsed) return badRequest(parsed.error);
    const updated = db
      .update(schema.storeItems)
      .set(parsed.values)
      .where(eq(schema.storeItems.id, Number(ctx.params.id)))
      .returning()
      .get();
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(updated);
  },
};

const deleteItem: ApiRoute = {
  method: "DELETE",
  path: "/api/store/items/:id",
  access: "admin",
  handle(_req, ctx) {
    db.delete(schema.storeItems)
      .where(eq(schema.storeItems.id, Number(ctx.params.id)))
      .run();
    return new Response(null, { status: 204 });
  },
};

// --- Purchased panel access (magic links; the token is the auth) ---

/**
 * Open a magic link. Opening is free and repeatable — the token is only
 * burned by the editor's single submission (POST below).
 */
const openPanel: ApiRoute = {
  method: "GET",
  path: "/api/panel/:token",
  access: "public",
  handle(_req, ctx) {
    const purchase = openPanelToken(ctx.params.token!);
    if (!purchase) {
      const existing = getPanelPurchase(ctx.params.token!);
      return existing
        ? Response.json({ error: "already used" }, { status: 410 })
        : Response.json({ error: "not found" }, { status: 404 });
    }
    let data: Record<string, unknown> = {};
    if (purchase.panel === "theme") {
      data = { template: getConfig().serverNameTemplate };
    } else if (purchase.panel === "botmessage") {
      const def = purchase.messageKey ? getMessageDef(purchase.messageKey) : undefined;
      if (!def) {
        return Response.json(
          { error: "the linked bot message no longer exists" },
          { status: 500 },
        );
      }
      data = {
        key: def.key,
        label: def.label,
        description: def.description,
        params: def.params,
        components: getMessagePayload(def.key),
      };
    }
    return Response.json({ panel: purchase.panel, itemName: purchase.itemName, data });
  },
};

/** Submit the one-shot editor behind a previously opened magic link. */
const submitPanel: ApiRoute = {
  method: "POST",
  path: "/api/panel/:token",
  access: "public",
  async handle(req, ctx) {
    const token = ctx.params.token!;
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");

    // Validate before consuming so a bad payload doesn't burn the submission.
    const peek = getPanelPurchase(token);
    if (!peek) return Response.json({ error: "not found" }, { status: 404 });
    if (peek.panel === "theme") {
      if (!body.name && !body.iconUrl) return badRequest("Provide a name and/or an icon URL.");
    } else if (peek.panel === "autoreply") {
      if (!body.name || !body.trigger) return badRequest("name and trigger required");
      if (!isValidComponentsPayload(body.responseComponents)) {
        return badRequest("responseComponents must be a non-empty Components V2 array");
      }
    } else if (peek.panel === "botmessage") {
      if (!peek.messageKey || !getMessageDef(peek.messageKey)) {
        return Response.json(
          { error: "the linked bot message no longer exists" },
          { status: 500 },
        );
      }
      if (!isValidComponentsPayload(body.components)) {
        return badRequest("components must be a non-empty Components V2 array");
      }
    } else {
      return Response.json({ error: "unknown panel" }, { status: 500 });
    }

    const purchase = consumePanelToken(token);
    if (!purchase) {
      return Response.json({ error: "already used" }, { status: 410 });
    }

    if (purchase.panel === "theme") {
      const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
      if (!guild) {
        releasePanelToken(token);
        return Response.json({ error: "guild unavailable — try again" }, { status: 500 });
      }
      const result = await applyTheme(guild, {
        name: body.name || undefined,
        iconUrl: body.iconUrl || undefined,
        actorId: purchase.userId,
        bypassCooldown: true,
      });
      if ("error" in result) {
        releasePanelToken(token);
        return Response.json(result, { status: 400 });
      }
      return Response.json(result);
    }

    if (purchase.panel === "botmessage") {
      setMessageOverride(purchase.messageKey!, body.components);
      return Response.json({ ok: true, applied: [`Bot message updated`] });
    }

    // autoreply
    const inserted = db
      .insert(schema.autoreplies)
      .values({
        name: body.name,
        trigger: body.trigger,
        matchType: ["exact", "contains", "regex"].includes(body.matchType)
          ? body.matchType
          : "contains",
        caseSensitive: body.caseSensitive ? 1 : 0,
        responseComponents: body.responseComponents,
        enabled: 1,
      })
      .returning()
      .get();
    invalidateRules();
    return Response.json({ ok: true, id: inserted.id });
  },
};

export const storeApiRoutes: ApiRoute[] = [
  storefront,
  buy,
  inventory,
  updateCustomRole,
  listItems,
  createItem,
  updateItem,
  deleteItem,
  openPanel,
  submitPanel,
];
