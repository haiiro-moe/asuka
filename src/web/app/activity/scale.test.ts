import { expect, test } from "bun:test";
import { heatLevel, scaleToPercent } from "./scale.ts";

test("scaleToPercent maps the largest value to 100", () => {
  expect(scaleToPercent([0, 5, 10])).toEqual([0, 50, 100]);
});

test("scaleToPercent returns zeros for an all-zero input", () => {
  expect(scaleToPercent([0, 0])).toEqual([0, 0]);
});

test("heatLevel steps from 0 to 4", () => {
  expect(heatLevel(0, 10)).toBe(0);
  expect(heatLevel(10, 10)).toBe(4);
  expect(heatLevel(1, 10)).toBe(1);
});

test("heatLevel is 0 when the max is 0", () => {
  expect(heatLevel(5, 0)).toBe(0);
});
