import type { Client, Guild, Role } from "discord.js";
import { and, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { env } from "../../config/env.ts";
import { ensureMember, addCredits } from "../../core/members.ts";
import { getMessageDef } from "../../core/messages.ts";
import { nowSec } from "../../core/util.ts";
import {
  getOpenElection,
  refreshCandidateCard,
  VOTE_EMOJI,
} from "../elections/service.ts";

export type StoreItem = typeof schema.storeItems.$inferSelect;
export type StorePurchase = typeof schema.storePurchases.$inferSelect;
export type Sabotage = typeof schema.electionSabotages.$inferSelect;

export function memberBalance(userId: string): number {
  return ensureMember(userId).socialCredits;
}

/** Atomically deduct `amount` SC. False when the balance is insufficient. */
export function trySpend(userId: string, amount: number): boolean {
  ensureMember(userId);
  const row = db
    .update(schema.members)
    .set({ socialCredits: sql`${schema.members.socialCredits} - ${amount}` })
    .where(
      and(eq(schema.members.userId, userId), gte(schema.members.socialCredits, amount)),
    )
    .returning()
    .get();
  return !!row;
}

export function getItem(id: number): StoreItem | undefined {
  return db.select().from(schema.storeItems).where(eq(schema.storeItems.id, id)).get();
}

/** Each sabotage item can be bought once per election. */
export function sabotageUsed(itemId: number, electionId: number): boolean {
  return !!db
    .select()
    .from(schema.electionSabotages)
    .where(
      and(
        eq(schema.electionSabotages.itemId, itemId),
        eq(schema.electionSabotages.electionId, electionId),
      ),
    )
    .get();
}

/** Is a timed sabotage of `type` currently in force against a candidate? */
export function hasActiveSabotage(
  electionId: number,
  targetUserId: string,
  type: Sabotage["type"],
): boolean {
  return !!db
    .select()
    .from(schema.electionSabotages)
    .where(
      and(
        eq(schema.electionSabotages.electionId, electionId),
        eq(schema.electionSabotages.targetUserId, targetUserId),
        eq(schema.electionSabotages.type, type),
        gt(schema.electionSabotages.expiresAt, nowSec()),
      ),
    )
    .get();
}

export function userPurchaseCount(itemId: number, userId: string): number {
  return db
    .select()
    .from(schema.storePurchases)
    .where(
      and(
        eq(schema.storePurchases.itemId, itemId),
        eq(schema.storePurchases.userId, userId),
      ),
    )
    .all().length;
}

export function totalPurchaseCount(itemId: number): number {
  return db
    .select()
    .from(schema.storePurchases)
    .where(eq(schema.storePurchases.itemId, itemId))
    .all().length;
}

/**
 * Enforce an item's optional purchase limits (global stock, then per-user
 * cap). Returns a user-facing error or null when the purchase may proceed.
 */
export function limitError(item: StoreItem, userId: string): string | null {
  if (item.stock != null && totalPurchaseCount(item.id) >= item.stock) {
    return "Sold out.";
  }
  if (item.maxPerUser != null && userPurchaseCount(item.id, userId) >= item.maxPerUser) {
    return "You've reached the purchase limit for this item.";
  }
  return null;
}

/**
 * A member's active custom role: their most recent custom-role purchase whose
 * role still exists in the guild. Only one may be active per person; it can
 * be re-bought if the role was deleted, and edited any time from the inventory.
 */
export function activeCustomRole(
  guild: Guild,
  userId: string,
): { purchase: StorePurchase; role: Role } | null {
  const rows = db
    .select()
    .from(schema.storePurchases)
    .where(
      and(
        eq(schema.storePurchases.userId, userId),
        eq(schema.storePurchases.kind, "custom_role"),
      ),
    )
    .orderBy(desc(schema.storePurchases.createdAt))
    .all();
  for (const purchase of rows) {
    if (!purchase.roleId) continue;
    const role = guild.roles.cache.get(purchase.roleId);
    if (role) return { purchase, role };
  }
  return null;
}

export function purchasesFor(userId: string): StorePurchase[] {
  return db
    .select()
    .from(schema.storePurchases)
    .where(eq(schema.storePurchases.userId, userId))
    .orderBy(desc(schema.storePurchases.createdAt))
    .limit(50)
    .all();
}

export function panelLink(token: string): string {
  return `${env.PUBLIC_URL}/panel/${token}`;
}

// --- Purchase flow ---

export interface BuyRequest {
  /** sabotage: the candidate to hit. */
  targetUserId?: string;
  /** custom_role customization. */
  roleName?: string;
  roleColor?: string;
}

export type BuyResult =
  | { error: string; status: number }
  | { ok: true; balance: number; message: string; link?: string; roleId?: string };

function fail(status: number, error: string): BuyResult {
  return { error, status };
}

/** Shared custom-role input validation for purchases and inventory edits. */
export function validateCustomRole(
  name: unknown,
  color: unknown,
): string | { roleName: string; roleColor: string } {
  const roleName = (typeof name === "string" ? name : "").trim();
  const roleColor = (typeof color === "string" ? color : "").trim();
  if (roleName.length < 2 || roleName.length > 50) {
    return "Role name must be 2–50 characters.";
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(roleColor)) {
    return "Role color must be a #RRGGBB hex value.";
  }
  return { roleName, roleColor };
}

/**
 * Move a bought custom role to sit directly below the anchor role, so its
 * color wins over ordinary roles on member names. Moving a role up to
 * `anchor.position - 1` shifts the roles it passes down by one and leaves
 * the anchor untouched. Best-effort: silently keeps the default position
 * when the anchor is gone or outranks the bot.
 */
async function positionUnderAnchor(
  guild: Guild,
  role: Role,
  anchorRoleId: string | null,
) {
  if (!anchorRoleId) return;
  const anchor = guild.roles.cache.get(anchorRoleId);
  if (!anchor) return;
  await role.setPosition(Math.max(1, anchor.position - 1)).catch(() => {});
}

/** Rename/recolor a member's active custom role (free, any time). */
export async function editCustomRole(
  client: Client,
  guildId: string,
  userId: string,
  body: { roleName?: unknown; roleColor?: unknown },
): Promise<{ error: string; status: number } | { ok: true; roleId: string; name: string; color: string }> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { error: "Guild unavailable.", status: 500 };
  const active = activeCustomRole(guild, userId);
  if (!active) return { error: "You don't have a custom role.", status: 404 };
  const invalid = validateCustomRole(body.roleName, body.roleColor);
  if (typeof invalid === "string") return { error: invalid, status: 400 };
  const edited = await active.role
    .edit({
      name: invalid.roleName,
      color: invalid.roleColor as `#${string}`,
      reason: `Custom role edit by ${userId}`,
    })
    .catch(() => null);
  if (!edited) return { error: "Couldn't update the role.", status: 500 };
  return { ok: true, roleId: edited.id, name: edited.name, color: invalid.roleColor };
}

/**
 * Remove random voters from a candidate's vote reaction until `percent`% of
 * the current total is gone. Returns the number removed, or null when the
 * candidate's message can't be reached (treated as a failed purchase).
 */
async function cutVotes(
  client: Client,
  channelId: string | null,
  messageId: string | null,
  percent: number,
): Promise<number | null> {
  if (!channelId || !messageId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return null;
  const reaction = msg.reactions.cache.find((r) => r.emoji.name === VOTE_EMOJI);
  if (!reaction) return 0;
  const users = await reaction.users.fetch().catch(() => null);
  if (!users) return 0;
  const voters = [...users.values()].filter((u) => !u.bot).map((u) => u.id);
  const toRemove = Math.round((voters.length * percent) / 100);
  for (let i = voters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [voters[i], voters[j]] = [voters[j]!, voters[i]!];
  }
  for (const id of voters.slice(0, toRemove)) {
    await reaction.users.remove(id).catch(() => {});
  }
  return toRemove;
}

/**
 * Validate, charge and fulfil a store purchase. Credits are deducted with a
 * conditional update (no overdraft); if the Discord side-effect then fails,
 * the purchase is rolled back and the credits refunded.
 */
export async function buyItem(
  client: Client,
  guildId: string,
  userId: string,
  item: StoreItem,
  body: BuyRequest,
): Promise<BuyResult> {
  if (!item.enabled) return fail(404, "This item is not available.");

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return fail(500, "Guild unavailable.");
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return fail(403, "You must be a member of the server.");

  // --- Cheap validation before any money moves. ---
  const limited = limitError(item, userId);
  if (limited) return fail(409, limited);

  let roleName = "";
  let roleColor = "";
  const open = getOpenElection();

  if (item.kind === "role") {
    if (!item.roleId) return fail(500, "Item is misconfigured (no role).");
    if (member.roles.cache.has(item.roleId)) return fail(409, "You already own this role.");
    if (!guild.roles.cache.get(item.roleId)) return fail(500, "The role no longer exists.");
  }

  if (item.kind === "custom_role") {
    // Hard rule across all custom-role items: one active custom role each.
    if (activeCustomRole(guild, userId)) {
      return fail(409, "You already have a custom role — edit it from your Profile page.");
    }
    const invalid = validateCustomRole(body.roleName, body.roleColor);
    if (typeof invalid === "string") return fail(400, invalid);
    ({ roleName, roleColor } = invalid);
  }

  if (item.kind === "panel_access" && !item.panel) {
    return fail(500, "Item is misconfigured (no panel).");
  }
  if (
    item.kind === "panel_access" &&
    item.panel === "botmessage" &&
    (!item.messageKey || !getMessageDef(item.messageKey))
  ) {
    return fail(500, "Item is misconfigured (unknown bot message).");
  }

  let targetUserId = "";
  if (item.kind === "sabotage") {
    if (!item.sabotageType) return fail(500, "Item is misconfigured (no sabotage type).");
    if (!open) return fail(409, "No election is open.");
    if (sabotageUsed(item.id, open.id)) {
      return fail(409, "This sabotage has already been used this election.");
    }
    if (item.sabotageType === "cut_votes" && open.status !== "open") {
      return fail(409, "Voting hasn't started yet — there are no votes to cut.");
    }
    targetUserId = body.targetUserId ?? "";
    if (!targetUserId) return fail(400, "Pick a candidate to sabotage.");
    if (targetUserId === userId) return fail(400, "You can't sabotage yourself.");
    const candidate = db
      .select()
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.electionId, open.id),
          eq(schema.candidates.userId, targetUserId),
        ),
      )
      .get();
    if (!candidate) return fail(400, "That user is not a candidate in this election.");
  }

  // --- Charge. ---
  if (!trySpend(userId, item.price)) {
    return fail(402, `Not enough SC — this costs ${item.price} SC.`);
  }

  const token = item.kind === "panel_access" ? crypto.randomUUID() : null;
  const purchase = db
    .insert(schema.storePurchases)
    .values({
      itemId: item.id,
      itemName: item.name,
      kind: item.kind,
      userId,
      price: item.price,
      token,
      panel: item.panel,
      messageKey: item.messageKey,
      electionId: item.kind === "sabotage" ? open!.id : null,
      targetUserId: item.kind === "sabotage" ? targetUserId : null,
    })
    .returning()
    .get();

  const rollback = (extra?: () => void) => {
    extra?.();
    db.delete(schema.storePurchases).where(eq(schema.storePurchases.id, purchase.id)).run();
    addCredits(userId, item.price);
  };

  // --- Fulfil. ---
  if (item.kind === "panel_access") {
    return {
      ok: true,
      balance: memberBalance(userId),
      link: panelLink(token!),
      message:
        "Here is your magic link. Open it any time — it expires after one submission.",
    };
  }

  if (item.kind === "role") {
    const added = await member.roles.add(item.roleId!).catch(() => null);
    if (!added) {
      rollback();
      return fail(500, "Couldn't assign the role — you were not charged.");
    }
    db.update(schema.storePurchases)
      .set({ roleId: item.roleId })
      .where(eq(schema.storePurchases.id, purchase.id))
      .run();
    return { ok: true, balance: memberBalance(userId), roleId: item.roleId!, message: "Role granted!" };
  }

  if (item.kind === "custom_role") {
    const role = await guild.roles
      .create({
        name: roleName,
        color: roleColor as `#${string}`,
        permissions: [],
        reason: `Store purchase by ${userId}`,
      })
      .catch(() => null);
    if (!role) {
      rollback();
      return fail(500, "Couldn't create the role — you were not charged.");
    }
    const added = await member.roles.add(role).catch(() => null);
    if (!added) {
      rollback(() => void role.delete().catch(() => {}));
      return fail(500, "Couldn't assign the role — you were not charged.");
    }
    // Slot the role directly below the configured anchor so its color still
    // shows on names (best-effort: the bot can't move roles above its own).
    await positionUnderAnchor(guild, role, item.anchorRoleId);
    db.update(schema.storePurchases)
      .set({ roleId: role.id })
      .where(eq(schema.storePurchases.id, purchase.id))
      .run();
    return {
      ok: true,
      balance: memberBalance(userId),
      roleId: role.id,
      message: `Custom role “${roleName}” created and assigned!`,
    };
  }

  // sabotage
  const days = item.sabotageDays ?? 1;
  const sabotage = db
    .insert(schema.electionSabotages)
    .values({
      electionId: open!.id,
      itemId: item.id,
      purchaseId: purchase.id,
      buyerId: userId,
      targetUserId,
      type: item.sabotageType!,
      percent: item.sabotagePercent,
      expiresAt:
        item.sabotageType === "cut_votes" ? null : nowSec() + days * 86400,
    })
    .returning()
    .get();

  if (item.sabotageType === "cut_votes") {
    const candidate = db
      .select()
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.electionId, open!.id),
          eq(schema.candidates.userId, targetUserId),
        ),
      )
      .get();
    const removed = await cutVotes(
      client,
      open!.channelId,
      candidate?.messageId ?? null,
      item.sabotagePercent ?? 0,
    );
    if (removed === null) {
      rollback(() =>
        db.delete(schema.electionSabotages).where(eq(schema.electionSabotages.id, sabotage.id)).run(),
      );
      return fail(500, "Couldn't reach the candidate's voting card — you were not charged.");
    }
    return {
      ok: true,
      balance: memberBalance(userId),
      message: `Sabotage deployed: ${removed} vote${removed === 1 ? "" : "s"} removed.`,
    };
  }

  if (item.sabotageType === "silence") {
    await refreshCandidateCard(client, open!.id, targetUserId, true);
    return {
      ok: true,
      balance: memberBalance(userId),
      message: `Sabotage deployed: they are silenced for ${days} day${days === 1 ? "" : "s"}.`,
    };
  }

  // disable_voting — enforced by the reaction listener while active.
  return {
    ok: true,
    balance: memberBalance(userId),
    message: `Sabotage deployed: voting for them is disabled for ${days} day${days === 1 ? "" : "s"}.`,
  };
}

// --- Panel-access magic links ---

/**
 * Look up a live magic-link purchase. Opening never burns the link — only a
 * submission does. The first open is stamped for bookkeeping.
 */
export function openPanelToken(token: string): StorePurchase | null {
  const row = getPanelPurchase(token);
  if (!row || row.tokenUsedAt) return null;
  if (!row.tokenOpenedAt) {
    return (
      db
        .update(schema.storePurchases)
        .set({ tokenOpenedAt: nowSec() })
        .where(eq(schema.storePurchases.token, token))
        .returning()
        .get() ?? null
    );
  }
  return row;
}

export function getPanelPurchase(token: string): StorePurchase | undefined {
  return db
    .select()
    .from(schema.storePurchases)
    .where(eq(schema.storePurchases.token, token))
    .get();
}

/** Atomically consume a token for its single editor submission. */
export function consumePanelToken(token: string): StorePurchase | null {
  return (
    db
      .update(schema.storePurchases)
      .set({ tokenUsedAt: nowSec() })
      .where(
        and(
          eq(schema.storePurchases.token, token),
          isNull(schema.storePurchases.tokenUsedAt),
        ),
      )
      .returning()
      .get() ?? null
  );
}

/** Un-burn a consumed token when fulfilment failed, so the buyer can retry. */
export function releasePanelToken(token: string) {
  db.update(schema.storePurchases)
    .set({ tokenUsedAt: null })
    .where(eq(schema.storePurchases.token, token))
    .run();
}

// --- Sabotage expiry (schedule) ---

/** Restore candidate cards whose silence sabotage has lapsed. */
export async function refreshExpiredSilences(client: Client) {
  const now = nowSec();
  const rows = db
    .select()
    .from(schema.electionSabotages)
    .where(
      and(
        eq(schema.electionSabotages.type, "silence"),
        isNull(schema.electionSabotages.restoredAt),
        lte(schema.electionSabotages.expiresAt, now),
      ),
    )
    .all();
  for (const row of rows) {
    // Another still-active silence on the same target keeps the stamp on.
    if (!hasActiveSabotage(row.electionId, row.targetUserId, "silence")) {
      await refreshCandidateCard(client, row.electionId, row.targetUserId, false);
    }
    db.update(schema.electionSabotages)
      .set({ restoredAt: now })
      .where(eq(schema.electionSabotages.id, row.id))
      .run();
  }
}
