import { eq } from "drizzle-orm";
import { db, schema, getConfig } from "../db/index.ts";
import type { BotContext } from "./plugin.ts";

/**
 * The bot owner's Discord user id. Variable snippets execute arbitrary JS on
 * the bot process with full client access, so creating/editing them is locked
 * to this hardcoded account — no config or role can widen it.
 */
export const OWNER_ID = "147709526357966848";

export function isOwner(userId: string | undefined | null): boolean {
  return userId === OWNER_ID;
}

export type BotVariable = typeof schema.botVariables.$inferSelect;

export function listVariables(): BotVariable[] {
  return db.select().from(schema.botVariables).all();
}

export function getVariable(name: string): BotVariable | undefined {
  return db
    .select()
    .from(schema.botVariables)
    .where(eq(schema.botVariables.name, name))
    .get();
}

/** Variable names must be safe to embed as {{name}} placeholders. */
export const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/;

const EXEC_TIMEOUT_MS = 5_000;

// Reuse of `async` semantics without eval(): the AsyncFunction constructor
// compiles the snippet body once per run.
const AsyncFunction = async function () {}.constructor as new (
  ...args: string[]
) => (...fnArgs: unknown[]) => Promise<unknown>;

/**
 * Run a variable snippet on the bot. The code body may `return` a value and
 * `await` freely; it receives the live discord.js client plus db/schema/config
 * (e.g. `return (await client.guilds.fetch(guildId)).memberCount`).
 *
 * Throws on compile error, runtime error, or timeout — callers decide whether
 * to surface (test endpoint) or swallow (message rendering).
 */
export async function runVariableCode(code: string, ctx: BotContext): Promise<unknown> {
  const fn = new AsyncFunction("client", "guildId", "config", "db", "schema", "ctx", code);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(ctx.client, ctx.guildId, getConfig(), db, schema, ctx),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`variable timed out after ${EXEC_TIMEOUT_MS}ms`)),
          EXEC_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Render a snippet result into the string spliced into message content. */
export function stringifyVariableResult(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Resolve a {{name}} placeholder. Unknown names and failing snippets degrade
 * to a visible marker instead of breaking the message send.
 */
export async function resolveVariable(name: string, ctx: BotContext): Promise<string> {
  const variable = getVariable(name);
  if (!variable) return `{{${name}}}`;
  try {
    return stringifyVariableResult(await runVariableCode(variable.code, ctx));
  } catch (err) {
    console.error(`[variables] "${name}" failed:`, err);
    return `⚠${name}`;
  }
}
