import type { Plugin } from "../core/plugin.ts";
import system from "./system/index.ts";
import moderation from "./moderation/index.ts";
import autoreply from "./autoreply/index.ts";
import xp from "./xp/index.ts";
import economy from "./economy/index.ts";
import starboard from "./starboard/index.ts";
import profile from "./profile/index.ts";
import clubs from "./clubs/index.ts";
import elections from "./elections/index.ts";
import store from "./store/index.ts";
import events from "./events/index.ts";
import tatsuMigrate from "./tatsu-migrate/index.ts";
import anilist from "./anilist/index.ts";
import linkfixer from "./linkfixer/index.ts";

/**
 * The ordered list of active plugins. Add new feature plugins here as they are
 * built (moderation, autoreply, starboard, xp, economy, clubs, elections,
 * profile). The loader registers commands, listeners, schedules and API routes.
 */
export const plugins: Plugin[] = [
  system,
  moderation,
  autoreply,
  xp,
  economy,
  starboard,
  profile,
  clubs,
  elections,
  store,
  events,
  tatsuMigrate,
  anilist,
  linkfixer,
];
