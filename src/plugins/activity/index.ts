import type { Plugin } from "../../core/plugin.ts";
import { activityRoutes } from "./api.ts";
import { captureListeners, captureSchedules } from "./capture/index.ts";
import { wrappedCommands } from "./wrapped/commands.ts";
import { wrappedListeners } from "./wrapped/listeners.ts";

/**
 * Activity analytics: records timestamped activity facts, backfills history,
 * serves the tiered analytics views and runs the yearly Wrapped.
 *
 * This file only wires the parts together. Capture, the per-tier routes and
 * Wrapped each live in their own file. See docs/activity/foundation.md.
 */
const plugin: Plugin = {
  name: "activity",
  commands: wrappedCommands,
  listeners: [...captureListeners, ...wrappedListeners],
  schedules: captureSchedules,
  api: activityRoutes,
};

export default plugin;
