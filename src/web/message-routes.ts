import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import type { ApiContext, ApiRoute } from "../core/plugin.ts";
import { isValidComponentsPayload } from "../core/components.ts";
import {
  MESSAGE_CATALOG,
  getMessageDef,
  getMessageOverride,
  getMessagePayload,
  setMessageOverride,
  clearMessageOverride,
} from "../core/messages.ts";
import {
  isOwner,
  listVariables,
  runVariableCode,
  stringifyVariableResult,
  VARIABLE_NAME_RE,
} from "../core/variables.ts";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/** Store items whose magic link edits the given message. */
function linkedItems(key: string) {
  return db
    .select()
    .from(schema.storeItems)
    .where(
      and(eq(schema.storeItems.kind, "panel_access"), eq(schema.storeItems.messageKey, key)),
    )
    .all()
    .map((i) => ({ id: i.id, name: i.name, price: i.price, enabled: !!i.enabled }));
}

// --- Bot messages (admin) ---

const listMessages: ApiRoute = {
  method: "GET",
  path: "/api/bot-messages",
  access: "admin",
  handle: (_req, ctx) =>
    Response.json({
      messages: MESSAGE_CATALOG.map((def) => ({
        key: def.key,
        label: def.label,
        description: def.description,
        category: def.category,
        params: def.params,
        components: getMessagePayload(def.key),
        overridden: !!getMessageOverride(def.key),
        linkedItems: linkedItems(def.key),
      })),
      // Names only — bodies stay owner-only. Used for {{…}} hints in the editor.
      variables: listVariables().map((v) => v.name),
      isOwner: isOwner(ctx.session?.userId),
    }),
};

const updateMessage: ApiRoute = {
  method: "PUT",
  path: "/api/bot-messages/:key",
  access: "admin",
  async handle(req, ctx) {
    const key = ctx.params.key!;
    if (!getMessageDef(key)) return Response.json({ error: "not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isValidComponentsPayload(body.components)) {
      return badRequest("components must be a non-empty Components V2 array");
    }
    setMessageOverride(key, body.components);
    return Response.json({ ok: true, components: getMessagePayload(key), overridden: true });
  },
};

const resetMessage: ApiRoute = {
  method: "DELETE",
  path: "/api/bot-messages/:key",
  access: "admin",
  handle(_req, ctx) {
    const key = ctx.params.key!;
    if (!getMessageDef(key)) return Response.json({ error: "not found" }, { status: 404 });
    clearMessageOverride(key);
    return Response.json({ ok: true, components: getMessagePayload(key), overridden: false });
  },
};

/**
 * Point an existing panel-access store item's one-time magic link at this
 * message (each purchase then sells a single edit of it).
 */
const linkMessageItem: ApiRoute = {
  method: "PUT",
  path: "/api/bot-messages/:key/link",
  access: "admin",
  async handle(req, ctx) {
    const key = ctx.params.key!;
    if (!getMessageDef(key)) return Response.json({ error: "not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const itemId = Number(body?.itemId);
    if (!Number.isInteger(itemId)) return badRequest("itemId required");
    const item = db
      .select()
      .from(schema.storeItems)
      .where(eq(schema.storeItems.id, itemId))
      .get();
    if (!item) return Response.json({ error: "item not found" }, { status: 404 });
    if (item.kind !== "panel_access") {
      return badRequest("only panel-access items can carry a message edit link");
    }
    db.update(schema.storeItems)
      .set({ panel: "botmessage", messageKey: key })
      .where(eq(schema.storeItems.id, itemId))
      .run();
    return Response.json({ ok: true, linkedItems: linkedItems(key) });
  },
};

/** One-click creation of a store item selling a single edit of this message. */
const createMessageItem: ApiRoute = {
  method: "POST",
  path: "/api/bot-messages/:key/store-item",
  access: "admin",
  async handle(req, ctx) {
    const key = ctx.params.key!;
    const def = getMessageDef(key);
    if (!def) return Response.json({ error: "not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const name = typeof body?.name === "string" && body.name.trim()
      ? body.name.trim()
      : `Edit “${def.label}”`;
    const price = Number(body?.price);
    if (!Number.isInteger(price) || price < 0) {
      return badRequest("price must be a non-negative integer");
    }
    const inserted = db
      .insert(schema.storeItems)
      .values({
        name,
        description:
          typeof body?.description === "string"
            ? body.description
            : `one-time magic link to rewrite the bot's “${def.label}” message.`,
        icon: "»",
        price,
        kind: "panel_access",
        panel: "botmessage",
        messageKey: key,
      })
      .returning()
      .get();
    return Response.json(
      { ok: true, item: { id: inserted.id, name: inserted.name }, linkedItems: linkedItems(key) },
      { status: 201 },
    );
  },
};

// --- Variables (bot owner only — these snippets run arbitrary JS on the bot) ---

function ownerOnly(ctx: ApiContext): Response | null {
  return isOwner(ctx.session?.userId)
    ? null
    : Response.json({ error: "bot owner only" }, { status: 403 });
}

function parseVariableBody(body: Record<string, unknown> | null):
  | { error: string }
  | { name: string; description: string; code: string } {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code : "";
  if (!VARIABLE_NAME_RE.test(name)) {
    return { error: "name must match [a-zA-Z_][a-zA-Z0-9_.-]* (max 64 chars)" };
  }
  if (!code.trim()) return { error: "code required" };
  return {
    name,
    code,
    description: typeof body?.description === "string" ? body.description : "",
  };
}

const listVariablesRoute: ApiRoute = {
  method: "GET",
  path: "/api/variables",
  access: "admin",
  handle: (_req, ctx) => ownerOnly(ctx) ?? Response.json(listVariables()),
};

const createVariable: ApiRoute = {
  method: "POST",
  path: "/api/variables",
  access: "admin",
  async handle(req, ctx) {
    const denied = ownerOnly(ctx);
    if (denied) return denied;
    const parsed = parseVariableBody(
      (await req.json().catch(() => null)) as Record<string, unknown> | null,
    );
    if ("error" in parsed) return badRequest(parsed.error);
    const existing = db
      .select()
      .from(schema.botVariables)
      .where(eq(schema.botVariables.name, parsed.name))
      .get();
    if (existing) return Response.json({ error: "name already exists" }, { status: 409 });
    const inserted = db.insert(schema.botVariables).values(parsed).returning().get();
    return Response.json(inserted, { status: 201 });
  },
};

const updateVariable: ApiRoute = {
  method: "PUT",
  path: "/api/variables/:id",
  access: "admin",
  async handle(req, ctx) {
    const denied = ownerOnly(ctx);
    if (denied) return denied;
    const parsed = parseVariableBody(
      (await req.json().catch(() => null)) as Record<string, unknown> | null,
    );
    if ("error" in parsed) return badRequest(parsed.error);
    const updated = db
      .update(schema.botVariables)
      .set({ ...parsed, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(schema.botVariables.id, Number(ctx.params.id)))
      .returning()
      .get();
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(updated);
  },
};

const deleteVariable: ApiRoute = {
  method: "DELETE",
  path: "/api/variables/:id",
  access: "admin",
  handle(_req, ctx) {
    const denied = ownerOnly(ctx);
    if (denied) return denied;
    db.delete(schema.botVariables)
      .where(eq(schema.botVariables.id, Number(ctx.params.id)))
      .run();
    return new Response(null, { status: 204 });
  },
};

/** Dry-run a snippet against the live bot and report the substituted value. */
const testVariable: ApiRoute = {
  method: "POST",
  path: "/api/variables/test",
  access: "admin",
  async handle(req, ctx) {
    const denied = ownerOnly(ctx);
    if (denied) return denied;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (typeof body?.code !== "string" || !body.code.trim()) return badRequest("code required");
    const started = performance.now();
    try {
      const result = await runVariableCode(body.code, ctx);
      return Response.json({
        ok: true,
        result: stringifyVariableResult(result),
        ms: Math.round(performance.now() - started),
      });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 422 },
      );
    }
  },
};

export const messageRoutes: ApiRoute[] = [
  listMessages,
  updateMessage,
  resetMessage,
  linkMessageItem,
  createMessageItem,
  listVariablesRoute,
  createVariable,
  updateVariable,
  deleteVariable,
  testVariable,
];
