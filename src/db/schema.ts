import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = sql`(unixepoch())`;

/**
 * Singleton configuration row (id = 1) holding every runtime-tunable setting.
 * Channel/role ids are nullable until configured through the web UI.
 */
export const guildConfig = sqliteTable("guild_config", {
  id: integer("id").primaryKey().default(1),

  // Channels
  starboardChannelId: text("starboard_channel_id"),
  clubListingChannelId: text("club_listing_channel_id"),
  clubCategoryId: text("club_category_id"),
  clubDirectoryMessageId: text("club_directory_message_id"),
  electionChannelId: text("election_channel_id"),
  modLogChannelId: text("mod_log_channel_id"),
  levelUpChannelId: text("level_up_channel_id"),
  announcementChannelId: text("announcement_channel_id"),
  approvalChannelId: text("approval_channel_id"),

  // Roles
  presidentRoleId: text("president_role_id"),
  clubCreateMinRoleId: text("club_create_min_role_id"),
  presidentApplyMinRoleId: text("president_apply_min_role_id"),
  // Role added to every club channel/thread (even archived ones) for oversight.
  clubAdminRoleId: text("club_admin_role_id"),

  // Starboard
  starboardEmoji: text("starboard_emoji").notNull().default("⭐"),
  starboardThreshold: integer("starboard_threshold").notNull().default(3),
  starboardCreditMin: integer("starboard_credit_min").notNull().default(5),
  starboardCreditMax: integer("starboard_credit_max").notNull().default(20),

  // XP
  xpMessageMin: integer("xp_message_min").notNull().default(15),
  xpMessageMax: integer("xp_message_max").notNull().default(25),
  xpMessageCooldownSec: integer("xp_message_cooldown_sec").notNull().default(60),
  xpVoicePerMinute: integer("xp_voice_per_minute").notNull().default(10),

  // Social Credits (random reward between N messages, per user)
  creditRewardMin: integer("credit_reward_min").notNull().default(1),
  creditRewardMax: integer("credit_reward_max").notNull().default(15),
  creditWindowMin: integer("credit_window_min").notNull().default(200),
  creditWindowMax: integer("credit_window_max").notNull().default(1000),

  // Events (announcements on create + reminders both post here)
  eventsChannelId: text("events_channel_id"),

  // Elections & president theming
  electionIntervalCron: text("election_interval_cron").notNull().default("0 12 1 */3 *"),
  serverNameTemplate: text("server_name_template").notNull().default("Asuka Academy — %s"),

  // Feature toggles (1/0)
  moderationEnabled: integer("moderation_enabled").notNull().default(1),
  autoreplyEnabled: integer("autoreply_enabled").notNull().default(1),
  starboardEnabled: integer("starboard_enabled").notNull().default(1),
  xpEnabled: integer("xp_enabled").notNull().default(1),
  economyEnabled: integer("economy_enabled").notNull().default(1),
  clubsEnabled: integer("clubs_enabled").notNull().default(1),
  electionsEnabled: integer("elections_enabled").notNull().default(1),
  eventsEnabled: integer("events_enabled").notNull().default(1),

  // Link fixer (suppress + reply with fx-domain link for known platforms)
  linkFixerEnabled: integer("link_fixer_enabled").notNull().default(1),
  /** Platform keys (see src/plugins/linkfixer/domains.ts) excluded from fixing. */
  linkFixerDisabledPlatforms: text("link_fixer_disabled_platforms", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'["youtube"]'`),

  updatedAt: integer("updated_at").notNull().default(now),
});

/** Per-member XP / currency / activity state. */
export const members = sqliteTable("members", {
  userId: text("user_id").primaryKey(),
  xp: integer("xp").notNull().default(0),
  level: integer("level").notNull().default(0),
  socialCredits: integer("social_credits").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),
  lastMessageXpAt: integer("last_message_xp_at").notNull().default(0),
  nextCreditRewardAt: integer("next_credit_reward_at").notNull().default(0),
  joinedAt: integer("joined_at").notNull().default(now),
});

/** Moderation warnings issued to members. */
export const warnings = sqliteTable(
  "warnings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    moderatorId: text("moderator_id").notNull(),
    reason: text("reason").notNull().default("No reason provided"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("warnings_user_idx").on(t.userId)],
);

/** Audit log of all moderation actions. */
export const modLog = sqliteTable("mod_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action", {
    enum: [
      "timeout",
      "untimeout",
      "kick",
      "ban",
      "unban",
      "warn",
      "censor",
      "simulate_activity",
      "simulate_club_activity",
      "credits_grant",
      "credits_revoke",
      "event_create",
      "event_update",
      "event_delete",
      "event_group_create",
      "event_group_update",
      "event_group_delete",
    ],
  }).notNull(),
  userId: text("user_id").notNull(),
  moderatorId: text("moderator_id").notNull(),
  reason: text("reason"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at").notNull().default(now),
});

/** Auto-reply rules. The response is a serialized Components V2 payload. */
export const autoreplies = sqliteTable("autoreplies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  matchType: text("match_type", { enum: ["exact", "contains", "regex"] })
    .notNull()
    .default("contains"),
  caseSensitive: integer("case_sensitive").notNull().default(0),
  responseComponents: text("response_components", { mode: "json" })
    .$type<unknown[]>()
    .notNull(),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at").notNull().default(now),
});

/** Tracks which source messages have been mirrored to the starboard. */
export const starboardPosts = sqliteTable("starboard_posts", {
  sourceMessageId: text("source_message_id").primaryKey(),
  sourceChannelId: text("source_channel_id").notNull(),
  authorId: text("author_id").notNull(),
  starboardMessageId: text("starboard_message_id"),
  count: integer("count").notNull().default(0),
  rewarded: integer("rewarded").notNull().default(0),
  createdAt: integer("created_at").notNull().default(now),
});

/** Clubs (special-interest groups) and their provisioned Discord resources. */
export const clubs = sqliteTable("clubs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  ownerId: text("owner_id").notNull(),
  // draft = awaiting founder consent · pending = awaiting admin approval
  status: text("status", {
    enum: ["draft", "pending", "approved", "rejected", "terminated"],
  })
    .notNull()
    .default("draft"),
  level: integer("level").notNull().default(1),
  threadId: text("thread_id"),
  channelId: text("channel_id"),
  voiceChannelId: text("voice_channel_id"),
  // Resources archived on downgrade, reused/un-archived if the club upgrades again.
  archivedThreadId: text("archived_thread_id"),
  archivedChannelId: text("archived_channel_id"),
  archivedVoiceChannelId: text("archived_voice_channel_id"),
  // Exponentially-decaying message activity, used for the 0–100 activity score.
  activityPoints: real("activity_points").notNull().default(0),
  activityUpdatedAt: integer("activity_updated_at").notNull().default(now),
  createdAt: integer("created_at").notNull().default(now),
  lastActiveAt: integer("last_active_at").notNull().default(now),
});

/** Club membership join table (a user may belong to at most 3 clubs). */
export const clubMembers = sqliteTable(
  "club_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    // Founding members must consent before the club is sent for approval.
    accepted: integer("accepted").notNull().default(0),
    joinedAt: integer("joined_at").notNull().default(now),
  },
  (t) => [
    index("club_members_club_idx").on(t.clubId),
    index("club_members_user_idx").on(t.userId),
  ],
);

/** One-time, short-lived tokens for the web-based club-announcement composer. */
export const clubAnnounceTokens = sqliteTable(
  "club_announce_tokens",
  {
    token: text("token").primaryKey(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("club_announce_tokens_club_idx").on(t.clubId)],
);

/** Election cycles. */
export const elections = sqliteTable("elections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // "registration": candidacy window before voting; "open": voting underway.
  status: text("status", { enum: ["registration", "open", "closed", "cancelled"] })
    .notNull()
    .default("open"),
  channelId: text("channel_id"),
  startsAt: integer("starts_at").notNull().default(now),
  /** When the registration window ends and reaction voting begins. */
  votingStartsAt: integer("voting_starts_at"),
  endsAt: integer("ends_at"),
  winnerId: text("winner_id"),
});

/** Candidates standing in an election. */
export const candidates = sqliteTable(
  "candidates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    electionId: integer("election_id")
      .notNull()
      .references(() => elections.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    motto: text("motto").notNull().default(""),
    roleDescription: text("role_description").notNull().default(""),
    messageId: text("message_id"),
    voteCount: integer("vote_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("candidates_election_idx").on(t.electionId)],
);

/** Singleton (id = 1) tracking the current student council president. */
export const president = sqliteTable("president", {
  id: integer("id").primaryKey().default(1),
  userId: text("user_id"),
  termStart: integer("term_start"),
  lastThemeChangeAt: integer("last_theme_change_at").notNull().default(0),
});

/** Storefront items purchasable with Social Credits (SC). */
export const storeItems = sqliteTable("store_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  iconType: text("icon_type", { enum: ["emoji", "image"] })
    .notNull()
    .default("emoji"),
  /** Emoji character or image URL, depending on iconType. */
  icon: text("icon").notNull().default("🎁"),
  price: integer("price").notNull().default(100),
  kind: text("kind", {
    enum: ["panel_access", "role", "custom_role", "sabotage"],
  }).notNull(),
  /** panel_access: which editor the one-time magic link opens. */
  panel: text("panel", { enum: ["theme", "autoreply", "botmessage"] }),
  /** panel_access + botmessage: the registered bot message the link edits. */
  messageKey: text("message_key"),
  /** role: the existing role granted on purchase. */
  roleId: text("role_id"),
  /** custom_role: the created role is positioned directly below this role. */
  anchorRoleId: text("anchor_role_id"),
  /** Optional limits: per-user purchase cap and global stock. Null = unlimited. */
  maxPerUser: integer("max_per_user"),
  stock: integer("stock"),
  /** sabotage: effect type + tuning (days for timed effects, percent for vote cuts). */
  sabotageType: text("sabotage_type", {
    enum: ["disable_voting", "cut_votes", "silence"],
  }),
  sabotageDays: integer("sabotage_days"),
  sabotagePercent: integer("sabotage_percent"),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * Store purchase history. Item name/kind are copied so the record survives
 * item deletion. Panel-access purchases carry the one-time token: opening is
 * free and repeatable (first open stamped in openedAt); the token only
 * expires when the editor's single submission consumes it (usedAt).
 */
export const storePurchases = sqliteTable(
  "store_purchases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id").notNull(),
    itemName: text("item_name").notNull(),
    kind: text("kind").notNull(),
    userId: text("user_id").notNull(),
    price: integer("price").notNull(),
    // panel_access
    token: text("token").unique(),
    panel: text("panel"),
    /** botmessage panels: the catalog key the link edits (copied from the item). */
    messageKey: text("message_key"),
    tokenOpenedAt: integer("token_opened_at"),
    tokenUsedAt: integer("token_used_at"),
    // role / custom_role (the granted or created role)
    roleId: text("role_id"),
    // sabotage
    electionId: integer("election_id"),
    targetUserId: text("target_user_id"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("store_purchases_user_idx").on(t.userId)],
);

/** Active/lapsed sabotage effects bought against election candidates. */
export const electionSabotages = sqliteTable(
  "election_sabotages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    electionId: integer("election_id").notNull(),
    itemId: integer("item_id").notNull(),
    purchaseId: integer("purchase_id").notNull(),
    buyerId: text("buyer_id").notNull(),
    targetUserId: text("target_user_id").notNull(),
    type: text("type", { enum: ["disable_voting", "cut_votes", "silence"] }).notNull(),
    percent: integer("percent"),
    /** For timed effects (disable_voting, silence); null for one-shot cuts. */
    expiresAt: integer("expires_at"),
    /** Set once an expired silence's candidate card has been restored. */
    restoredAt: integer("restored_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("election_sabotages_election_idx").on(t.electionId)],
);

/** Active voice sessions used to award voice XP. */
export const voiceSessions = sqliteTable("voice_sessions", {
  userId: text("user_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  joinedAt: integer("joined_at").notNull().default(now),
  lastTickAt: integer("last_tick_at").notNull().default(now),
});

/** Persisted scheduler state so jobs don't double-fire across restarts. */
export const scheduleState = sqliteTable("schedule_state", {
  jobName: text("job_name").primaryKey(),
  lastRunAt: integer("last_run_at").notNull().default(0),
});

/**
 * Components V2 overrides for messages registered in the bot-message catalog
 * (src/core/messages.ts). No row = the plugin's default payload is used.
 */
export const botMessages = sqliteTable("bot_messages", {
  key: text("key").primaryKey(),
  components: text("components", { mode: "json" }).$type<unknown[]>().notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});

/**
 * Owner-only JS snippets. A message containing {{name}} runs the snippet on
 * the bot (with client access) and substitutes its return value.
 */
export const botVariables = sqliteTable("bot_variables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  code: text("code").notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
});

/**
 * Event groups: optional buckets for events. When a new event is created for a
 * group, the configured roles are mentioned in the announcement.
 */
export const eventGroups = sqliteTable("event_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  /** Role ids pinged whenever a new event is created in this group. */
  mentionRoleIds: text("mention_role_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: integer("created_at").notNull().default(now),
});

/**
 * Community events (replacement for Discord's built-in scheduled events).
 * Managed exclusively from the web dashboard by admins; members browse them
 * via /events and the dashboard calendar.
 */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    /** Discord-flavored markdown; rendered inside a Components V2 container. */
    description: text("description").notNull().default(""),
    imageUrls: text("image_urls", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    /** Container accent color as 0xRRGGBB int; null = default palette. */
    accentColor: integer("accent_color"),
    groupId: integer("group_id").references(() => eventGroups.id, {
      onDelete: "set null",
    }),
    /** Location: a text/voice/stage/forum channel id, or null (no location). */
    channelId: text("channel_id"),
    allDay: integer("all_day").notNull().default(0),
    /** First occurrence start (unix sec). All-day events start at local midnight. */
    startAt: integer("start_at").notNull(),
    /** First occurrence end; null = point-in-time event. */
    endAt: integer("end_at"),
    recurrence: text("recurrence", {
      enum: [
        "none",
        "daily",
        "weekdays",
        "weekly",
        "biweekly",
        "monthly_day",
        "monthly_weekday",
        "yearly",
        "custom_days",
      ],
    })
      .notNull()
      .default("none"),
    /** custom_days: repeat every N days. */
    recurrenceInterval: integer("recurrence_interval").notNull().default(1),
    /** Last occurrence may not start after this (unix sec); null = forever. */
    recurrenceUntil: integer("recurrence_until"),
    /** Occurrence start whose end-of-event rewards were last granted. */
    lastRewardedFor: integer("last_rewarded_for").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("events_start_idx").on(t.startAt)],
);

/** Reminders before each occurrence. A new event gets one at 1440 min (1 day). */
export const eventReminders = sqliteTable(
  "event_reminders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Minutes before the occurrence start. */
    offsetMinutes: integer("offset_minutes").notNull().default(1440),
    /** Occurrence start this reminder last fired for (dedupes across ticks). */
    lastFiredFor: integer("last_fired_for").notNull().default(0),
  },
  (t) => [index("event_reminders_event_idx").on(t.eventId)],
);

/** Rewards granted to participants when an occurrence ends. */
export const eventRewards = sqliteTable(
  "event_rewards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["role", "credits", "xp", "store_item"] }).notNull(),
    /** role: the granted role. */
    roleId: text("role_id"),
    /** credits/xp: the amount. */
    amount: integer("amount"),
    /** store_item: the granted item (fulfilled for free). */
    storeItemId: integer("store_item_id"),
  },
  (t) => [index("event_rewards_event_idx").on(t.eventId)],
);

/** Members who toggled participation on an event (via /events or the site). */
export const eventParticipants = sqliteTable(
  "event_participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("event_participants_event_idx").on(t.eventId),
    index("event_participants_user_idx").on(t.userId),
  ],
);

/**
 * Linked AniList accounts, established via AniList's OAuth2 login (not a
 * typed-in username) so the identity is verified and the access token is
 * available for future authenticated AniList features. AniList tokens don't
 * support refresh — tokenExpiresAt just flags when the user needs to re-link.
 */
export const anilistLinks = sqliteTable("anilist_links", {
  userId: text("user_id").primaryKey(),
  anilistId: integer("anilist_id").notNull(),
  username: text("username").notNull(),
  accessToken: text("access_token").notNull(),
  tokenExpiresAt: integer("token_expires_at").notNull(),
  linkedAt: integer("linked_at").notNull().default(now),
});

/**
 * Short-lived state for an in-flight `/al link` OAuth2 handshake: correlates
 * AniList's redirect back to `/auth/anilist/callback` (which only carries
 * `code` + `state`) to the Discord user who ran the command.
 */
export const anilistOauthStates = sqliteTable("anilist_oauth_states", {
  state: text("state").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});
