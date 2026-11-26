import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { SlashCommandBuilder } from "discord.js";
import type { Interaction } from "discord.js";
import { eq } from "drizzle-orm";
import { handleInteraction, registerCommands } from "../../../core/command-registry.ts";
import { addCredits } from "../../../core/members.ts";
import type { BotContext } from "../../../core/plugin.ts";
import { db, getConfig, initDb, schema } from "../../../db/index.ts";
import * as record from "../record.ts";
import { trySpend } from "../../store/service.ts";

/** Turn activity recording on or off on the singleton config row. */
function setEnabled(enabled: boolean) {
  db.update(schema.guildConfig)
    .set({ activityEnabled: enabled ? 1 : 0 })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

/** What the test command does when run. */
let behaviour: "ok" | "throw" = "ok";

beforeAll(() => {
  initDb();
  registerCommands([
    {
      data: new SlashCommandBuilder().setName("activity-capture-test").setDescription("test"),
      async execute() {
        if (behaviour === "throw") throw new Error("boom");
      },
    },
  ]);
});

beforeEach(() => {
  db.delete(schema.activityCommands).run();
  db.delete(schema.activityCredits).run();
  db.delete(schema.members).where(eq(schema.members.userId, "hook-u1")).run();
  setEnabled(true);
  behaviour = "ok";
});

afterAll(() => {
  setEnabled(true);
  db.delete(schema.members).where(eq(schema.members.userId, "hook-u1")).run();
});

const ctx = { guildId: "g1", config: getConfig } as unknown as BotContext;

/** A fake slash command interaction for the test command, with the replies it got. */
function interaction() {
  const replies: unknown[] = [];
  const i = {
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    commandName: "activity-capture-test",
    user: { id: "hook-u1" },
    member: { permissions: { has: () => true } },
    replied: false,
    deferred: false,
    reply: async (p: unknown) => void replies.push(p),
    followUp: async (p: unknown) => void replies.push(p),
  };
  return { i: i as unknown as Interaction, replies };
}

const commands = () => db.select().from(schema.activityCommands).all();
const credits = () => db.select().from(schema.activityCredits).all();

describe("command hook", () => {
  test("a command that completes is recorded ok", async () => {
    const { i, replies } = interaction();
    await handleInteraction(i, ctx);
    expect(commands().map((r) => [r.userId, r.name, r.ok])).toEqual([["hook-u1", "activity-capture-test", 1]]);
    expect(replies).toHaveLength(0);
  });

  test("a command that throws is recorded failed and still gets the error reply", async () => {
    behaviour = "throw";
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { i, replies } = interaction();
      await handleInteraction(i, ctx);
      expect(commands().map((r) => r.ok)).toEqual([0]);
      expect(replies).toHaveLength(1);
    } finally {
      error.mockRestore();
    }
  });

  test("nothing is recorded while activity is disabled", async () => {
    setEnabled(false);
    await handleInteraction(interaction().i, ctx);
    expect(commands()).toHaveLength(0);
  });

  test("a recording failure never breaks the command", async () => {
    const failing = spyOn(record, "recordCommand").mockImplementation(() => {
      throw new Error("disk full");
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { i, replies } = interaction();
      await expect(handleInteraction(i, ctx)).resolves.toBeUndefined();
      expect(replies).toHaveLength(0);
      expect(String(error.mock.calls[0]?.[0])).toStartWith("[activity]");
    } finally {
      failing.mockRestore();
      error.mockRestore();
    }
  });
});

describe("credit hook", () => {
  test("a credit change is recorded with the balance after it", () => {
    expect(addCredits("hook-u1", 10)).toBe(10);
    expect(addCredits("hook-u1", -3)).toBe(7);
    expect(credits().map((r) => [r.userId, r.delta, r.balanceAfter])).toEqual([
      ["hook-u1", 10, 10],
      ["hook-u1", -3, 7],
    ]);
  });

  test("nothing is recorded while activity is disabled", () => {
    setEnabled(false);
    expect(addCredits("hook-u1", 5)).toBe(5);
    expect(credits()).toHaveLength(0);
  });

  test("a recording failure never breaks the credit", () => {
    const failing = spyOn(record, "recordCredit").mockImplementation(() => {
      throw new Error("disk full");
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(addCredits("hook-u1", 4)).toBe(4);
      expect(String(error.mock.calls[0]?.[0])).toStartWith("[activity]");
    } finally {
      failing.mockRestore();
      error.mockRestore();
    }
  });
});

describe("actual credit deltas", () => {
  test("a deduction clamped at zero records what was taken", () => {
    addCredits("hook-u1", 5);
    expect(addCredits("hook-u1", -10)).toBe(0);
    expect(credits().map((r) => [r.delta, r.balanceAfter])).toEqual([
      [5, 5],
      [-5, 0],
    ]);
  });

  test("a change of zero writes no ledger row", () => {
    expect(addCredits("hook-u1", -3)).toBe(0);
    expect(addCredits("hook-u1", 0)).toBe(0);
    expect(credits()).toHaveLength(0);
  });
});

describe("store spend hook", () => {
  test("a successful spend writes a negative ledger row", () => {
    addCredits("hook-u1", 20);
    expect(trySpend("hook-u1", 8)).toBe(true);
    expect(credits().map((r) => [r.userId, r.delta, r.balanceAfter])).toEqual([
      ["hook-u1", 20, 20],
      ["hook-u1", -8, 12],
    ]);
  });

  test("a failed spend writes no ledger row", () => {
    addCredits("hook-u1", 5);
    expect(trySpend("hook-u1", 8)).toBe(false);
    expect(credits().map((r) => r.delta)).toEqual([5]);
  });

  test("a recording failure never breaks a purchase", () => {
    addCredits("hook-u1", 10);
    const failing = spyOn(record, "recordCredit").mockImplementation(() => {
      throw new Error("disk full");
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(trySpend("hook-u1", 4)).toBe(true);
      expect(String(error.mock.calls[0]?.[0])).toStartWith("[activity]");
    } finally {
      failing.mockRestore();
      error.mockRestore();
    }
    expect(addCredits("hook-u1", 0)).toBe(6);
  });
});
