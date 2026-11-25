import { Events, MessageFlags, type TextChannel } from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema, getConfig } from "../../db/index.ts";
import { isValidComponentsPayload } from "../../core/components.ts";
import { defineListener, type ApiRoute, type Plugin } from "../../core/plugin.ts";
import { getRules, invalidateRules } from "./cache.ts";

type Rule = typeof schema.autoreplies.$inferSelect;

/** Does a message match a rule's trigger? Exported for tests. */
export function matches(rule: Rule, content: string): boolean {
  const haystack = rule.caseSensitive ? content : content.toLowerCase();
  const needle = rule.caseSensitive ? rule.trigger : rule.trigger.toLowerCase();
  switch (rule.matchType) {
    case "exact":
      return haystack.trim() === needle.trim();
    case "contains":
      return haystack.includes(needle);
    case "regex":
      try {
        return new RegExp(rule.trigger, rule.caseSensitive ? "" : "i").test(content);
      } catch {
        return false;
      }
  }
}

const listener = defineListener({
  event: Events.MessageCreate,
  async handle(_ctx, message) {
    if (message.author.bot || !message.inGuild()) return;
    if (!getConfig().autoreplyEnabled) return;

    const content = message.content;
    if (!content) return;

    for (const rule of getRules()) {
      if (!matches(rule, content)) continue;
      await (message.channel as TextChannel)
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: rule.responseComponents as never,
          allowedMentions: { parse: [] }, // never ping from auto-replies
        })
        .catch((err) => console.error("[autoreply] send failed:", err));
      break; // first match wins
    }
  },
});

// --- Web API (consumed by the dashboard's visual Components V2 editor) ---

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

const list: ApiRoute = {
  method: "GET",
  path: "/api/autoreplies",
  access: "admin",
  handle() {
    return Response.json(db.select().from(schema.autoreplies).all());
  },
};

const create: ApiRoute = {
  method: "POST",
  path: "/api/autoreplies",
  access: "admin",
  async handle(req) {
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body?.name || !body?.trigger) return badRequest("name and trigger required");
    if (!isValidComponentsPayload(body.responseComponents)) {
      return badRequest("responseComponents must be a non-empty Components V2 array");
    }
    const inserted = db
      .insert(schema.autoreplies)
      .values({
        name: body.name,
        trigger: body.trigger,
        matchType: body.matchType ?? "contains",
        caseSensitive: body.caseSensitive ? 1 : 0,
        responseComponents: body.responseComponents,
        enabled: body.enabled === false ? 0 : 1,
      })
      .returning()
      .get();
    invalidateRules();
    return Response.json(inserted, { status: 201 });
  },
};

const update: ApiRoute = {
  method: "PUT",
  path: "/api/autoreplies/:id",
  access: "admin",
  async handle(req, ctx) {
    const id = Number(ctx.params.id);
    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body) return badRequest("invalid body");
    if (
      body.responseComponents !== undefined &&
      !isValidComponentsPayload(body.responseComponents)
    ) {
      return badRequest("responseComponents must be a non-empty Components V2 array");
    }
    const updated = db
      .update(schema.autoreplies)
      .set({
        name: body.name,
        trigger: body.trigger,
        matchType: body.matchType,
        caseSensitive: body.caseSensitive ? 1 : 0,
        responseComponents: body.responseComponents,
        enabled: body.enabled === false ? 0 : 1,
      })
      .where(eq(schema.autoreplies.id, id))
      .returning()
      .get();
    invalidateRules();
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(updated);
  },
};

const remove: ApiRoute = {
  method: "DELETE",
  path: "/api/autoreplies/:id",
  access: "admin",
  handle(_req, ctx) {
    const id = Number(ctx.params.id);
    db.delete(schema.autoreplies).where(eq(schema.autoreplies.id, id)).run();
    invalidateRules();
    return new Response(null, { status: 204 });
  },
};

const plugin: Plugin = {
  name: "autoreply",
  listeners: [listener],
  api: [list, create, update, remove],
};

export default plugin;
