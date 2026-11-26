import { expect, test } from "bun:test";
import { MIN_GROUP, hideSmall, mergeSmallGroups } from "./privacy.ts";

test("MIN_GROUP is 3", () => {
  expect(MIN_GROUP).toBe(3);
});

test("hideSmall hides 1 and 2, keeps 0 and anything from 3 up", () => {
  expect(hideSmall(0)).toBe(0);
  expect(hideSmall(1)).toBeNull();
  expect(hideSmall(2)).toBeNull();
  expect(hideSmall(3)).toBe(3);
  expect(hideSmall(40)).toBe(40);
});

test("mergeSmallGroups folds groups under 3 into other", () => {
  expect(mergeSmallGroups([14, 9, 2, 1, 5])).toEqual({ shown: [14, 9, 5], other: 3 });
});

test("mergeSmallGroups hides an other that is itself under 3", () => {
  expect(mergeSmallGroups([14, 2])).toEqual({ shown: [14], other: null });
  expect(mergeSmallGroups([1])).toEqual({ shown: [], other: null });
});

test("mergeSmallGroups reports 0 when there is nothing to merge", () => {
  expect(mergeSmallGroups([14, 3])).toEqual({ shown: [14, 3], other: 0 });
  expect(mergeSmallGroups([])).toEqual({ shown: [], other: 0 });
});
