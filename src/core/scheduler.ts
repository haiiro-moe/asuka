import { Cron } from "croner";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import type { BotContext, Schedule } from "./plugin.ts";

const jobs: Cron[] = [];

/** Read the last successful run time (unix seconds) for a named job. */
export function lastRun(jobName: string): number {
  const row = db
    .select()
    .from(schema.scheduleState)
    .where(eq(schema.scheduleState.jobName, jobName))
    .get();
  return row?.lastRunAt ?? 0;
}

function markRun(jobName: string) {
  const at = Math.floor(Date.now() / 1000);
  db.insert(schema.scheduleState)
    .values({ jobName, lastRunAt: at })
    .onConflictDoUpdate({
      target: schema.scheduleState.jobName,
      set: { lastRunAt: at },
    })
    .run();
}

/** Register a list of schedules with croner. */
export function registerSchedules(schedules: Schedule[], ctx: BotContext) {
  for (const schedule of schedules) {
    const job = new Cron(schedule.cron, { name: schedule.name }, async () => {
      try {
        await schedule.run(ctx);
        markRun(schedule.name);
      } catch (err) {
        console.error(`[scheduler] job "${schedule.name}" failed:`, err);
      }
    });
    jobs.push(job);
    console.log(`[scheduler] registered "${schedule.name}" (${schedule.cron})`);
  }
}

/** Stop all scheduled jobs (used on shutdown). */
export function stopSchedules() {
  for (const job of jobs) job.stop();
  jobs.length = 0;
}
