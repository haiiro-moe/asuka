import { describe, expect, test } from "bun:test";
import { failureText, viewOf } from "./useActivity.ts";

describe("failureText", () => {
  test("401 is unauthorized", () => {
    expect(failureText(401, "Unauthorized", { error: "x" })).toBe("unauthorized");
  });
  test("prefers the server's error field", () => {
    expect(failureText(400, "Bad Request", { error: "bad period" })).toBe("bad period");
  });
  test("falls back to the status text", () => {
    expect(failureText(500, "Internal Server Error", null)).toBe("Internal Server Error");
  });
  test("an empty status text becomes http <status>", () => {
    expect(failureText(502, "", null)).toBe("http 502");
    expect(failureText(500, "  ", { error: "" })).toBe("http 500");
  });
});

describe("viewOf", () => {
  const slot = { path: "/a?period=30d", data: { n: 1 }, error: null };
  test("before the first answer it is loading", () => {
    expect(viewOf(null, "/a", true)).toEqual({ data: null, error: null, loading: true });
  });
  test("data belongs to its path only", () => {
    expect(viewOf(slot, "/a?period=year", false)).toEqual({ data: null, error: null, loading: true });
    expect(viewOf(slot, "/a?period=year", true)).toEqual({ data: null, error: null, loading: true });
  });
  test("the current path's answer shows, also during a reload", () => {
    expect(viewOf(slot, "/a?period=30d", false)).toEqual({ data: { n: 1 }, error: null, loading: false });
    expect(viewOf(slot, "/a?period=30d", true)).toEqual({ data: { n: 1 }, error: null, loading: true });
  });
  test("an error shows once settled and clears while retrying", () => {
    const bad = { path: "/a", data: null, error: "http 500" };
    expect(viewOf(bad, "/a", false).error).toBe("http 500");
    expect(viewOf(bad, "/a", true).error).toBeNull();
  });
});
