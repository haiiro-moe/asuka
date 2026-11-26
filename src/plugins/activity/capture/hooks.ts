/**
 * Capture hooks called from core code rather than from gateway events: the
 * slash command router (`src/core/command-registry.ts`) and the Social Credits
 * service (`addCredits` in `src/core/members.ts`).
 *
 * Both are safe to call unconditionally. They do nothing while
 * `guild_config.activityEnabled` is 0, and they catch and log every error with
 * an `[activity]` prefix, so recording can never break the command or the
 * credit change it follows. See docs/activity/capture.md.
 */
import { getConfig } from "../../../db/index.ts";
import * as record from "../record.ts";

/**
 * Run a hook's work if activity is enabled, logging instead of throwing.
 *
 * @param what - Names the hook in the log line.
 * @param work - The write.
 */
function safely(what: string, work: () => void): void {
  try {
    if (!getConfig().activityEnabled) return;
    work();
  } catch (err) {
    console.error(`[activity] ${what} capture failed:`, err);
  }
}

/**
 * Record one slash command run. Never throws.
 *
 * @param userId - The member who ran it.
 * @param name - The command name, without the leading slash.
 * @param ok - True when `execute` resolved, false when it threw.
 */
export function captureCommand(userId: string, name: string, ok: boolean): void {
  safely("command", () => record.recordCommand(userId, name, ok));
}

/**
 * Record one Social Credits change. Never throws.
 *
 * @param userId - The member.
 * @param delta - The amount passed to `addCredits` (signed).
 * @param balanceAfter - The member's balance after the change.
 */
export function captureCredit(userId: string, delta: number, balanceAfter: number): void {
  safely("credit", () => record.recordCredit(userId, delta, balanceAfter));
}
