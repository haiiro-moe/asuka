import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "seed-activity.ts");

/**
 * Run the seed script in its own process, from an empty directory.
 *
 * @param env - Variables set on top of a clean environment. `DATABASE_PATH` is
 *   only set when given here.
 * @returns The exit code, what was printed to stderr, and the files left in
 *   the working directory.
 */
function runSeed(env: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "seed-activity-test-"));
  try {
    const base: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      // The script must decide from what the test passes, not from the test runner's own setup.
      if (value !== undefined && key !== "DATABASE_PATH" && key !== "NODE_ENV") base[key] = value;
    }
    const result = Bun.spawnSync([process.execPath, script], {
      cwd,
      env: { ...base, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { exitCode: result.exitCode, stderr: result.stderr.toString(), files: readdirSync(cwd) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("the seed script refuses to run without DATABASE_PATH", () => {
  const result = runSeed({});
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("refusing to run");
  expect(result.stderr).toContain("DATABASE_PATH is not set");
  expect(result.files).toEqual([]);
});

test("the seed script refuses the default database path", () => {
  const result = runSeed({ DATABASE_PATH: "./asuka.sqlite" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("refusing to run");
  expect(result.stderr).toContain("asuka.sqlite");
  expect(result.files).toEqual([]);
});

test("the seed script refuses the deployed database path", () => {
  const result = runSeed({ DATABASE_PATH: "/var/lib/asuka/asuka.sqlite" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("refusing to run");
  expect(result.files).toEqual([]);
});

test("the seed script refuses to run in production", () => {
  const result = runSeed({ DATABASE_PATH: "./scratch.sqlite", NODE_ENV: "production" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("NODE_ENV is production");
  expect(result.files).toEqual([]);
});
