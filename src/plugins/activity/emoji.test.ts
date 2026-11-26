import { expect, test } from "bun:test";
import { parseEmoji } from "./emoji.ts";

test("counts unicode and custom emoji in order of first appearance, skipping inline code", () => {
  expect(parseEmoji("hi 😀😀 <:pog:123> <a:dance:456> `🙂`")).toEqual([
    { emoji: "😀", name: null, count: 2 },
    { emoji: "custom:123", name: "pog", count: 1 },
    { emoji: "custom:456", name: "dance", count: 1 },
  ]);
});

test("ignores emoji inside a fenced code block", () => {
  expect(parseEmoji("```\n😀 <:pog:123>\n```")).toEqual([]);
  expect(parseEmoji("before 🎉\n```ts\nconst a = '😀';\n```\nafter <:pog:123>")).toEqual([
    { emoji: "🎉", name: null, count: 1 },
    { emoji: "custom:123", name: "pog", count: 1 },
  ]);
});

test("ignores emoji inside double-backtick inline code", () => {
  expect(parseEmoji("``a ` 😀`` 🎉")).toEqual([{ emoji: "🎉", name: null, count: 1 }]);
});

test("an unclosed backtick is not code", () => {
  expect(parseEmoji("it`s 😀")).toEqual([{ emoji: "😀", name: null, count: 1 }]);
});

test("a ZWJ sequence is one emoji", () => {
  const family = parseEmoji("👨‍👩‍👧");
  expect(family).toHaveLength(1);
  expect(family[0]).toEqual({ emoji: "👨‍👩‍👧", name: null, count: 1 });
});

test("the variation selector does not change the key", () => {
  const withSelector = parseEmoji("❤️");
  const without = parseEmoji("❤");
  expect(withSelector).toHaveLength(1);
  expect(without).toHaveLength(1);
  expect(withSelector[0]!.emoji).toBe(without[0]!.emoji);
  expect(withSelector[0]!.emoji).toBe("❤");
  expect(parseEmoji("❤️ ❤")).toEqual([{ emoji: "❤", name: null, count: 2 }]);
});

test("a skin tone stays part of its emoji", () => {
  expect(parseEmoji("👍🏽 👍")).toEqual([
    { emoji: "👍🏽", name: null, count: 1 },
    { emoji: "👍", name: null, count: 1 },
  ]);
});

test("flags and keycaps are one emoji each", () => {
  expect(parseEmoji("🇭🇺🇯🇵 1️⃣")).toEqual([
    { emoji: "🇭🇺", name: null, count: 1 },
    { emoji: "🇯🇵", name: null, count: 1 },
    { emoji: "1⃣", name: null, count: 1 },
  ]);
});

test("repeats of a custom emoji are summed and keep the first position", () => {
  expect(parseEmoji("<:pog:123> 😀 <:pog:123>")).toEqual([
    { emoji: "custom:123", name: "pog", count: 2 },
    { emoji: "😀", name: null, count: 1 },
  ]);
});

test("plain text has no emoji", () => {
  expect(parseEmoji("")).toEqual([]);
  expect(parseEmoji("hello <@123> at 10:30, see #general")).toEqual([]);
});
