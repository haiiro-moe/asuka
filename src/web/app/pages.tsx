/**
 * The dashboard's main pages (overview, leaderboard, clubs, presidency history, president, config,
 * auto-replies, elections, moderation) and the `PAGES` list the shell navigates. Every page is written
 * in the haiiro primitives: labelled Windows, stat tiles, data tables, setting rows and narrator lines.
 * The page title and its lede are drawn by the shell (`App.tsx`), so a page starts with its content.
 *
 * @module
 */
import { useId, useState, type ReactElement, type ReactNode } from "react";
import { api, type Me } from "./api.ts";
import { ComponentsEditor } from "./ComponentsEditor.tsx";
import { useNames, UserName, UserLink } from "./names.tsx";
import { useMe, ROLE_RANK } from "./me-context.ts";
import {
  Chip,
  Empty,
  ErrorLine,
  Heading,
  InkButton,
  Loading,
  PromptField,
  Saved,
  Select,
  SettingRow,
  Tabs,
  Toggle,
  Window,
  useAsync,
  useConfirm,
} from "./ui.ts";
import { Modal } from "./Modal.tsx";
import { StorePage } from "./StorePage.tsx";
import { StoreItemsPage } from "./StoreItemsPage.tsx";
import { ProfilePage } from "./ProfilePage.tsx";
import { BotMessagesTab } from "./BotMessagesTab.tsx";
import { EventsPage, EventsEditorPage } from "./EventsPages.tsx";

/* ------------------------------------------------------------------------------------------------ */
/* helpers                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/** Lets a PromptField wrap on phones: the value drops under a long prompt instead of being squeezed. */
const FIELD_WRAP = "max-[720px]:flex-wrap max-[720px]:[&>input]:basis-full max-[720px]:[&>input]:pl-[calc(1ch+8px)]";

/** Stacks a SettingRow on phones: name, description, then the actions under them. */
const STACK_ON_PHONE = "max-[720px]:grid-cols-1 max-[720px]:[&>span:nth-child(2)]:order-3 max-[720px]:[&>span:nth-child(2)]:pt-2";

/** The palette's pine, the default accent of a new auto-reply container (never Discord blurple). */
const DEFAULT_ACCENT = 0x31748f;

/** Formats unix seconds as a day, `4 Nov 2026`. */
function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Formats unix seconds as a day and a 24-hour time, `4 Nov 2026, 18:30`. */
function fmtDateTime(sec: number): string {
  const d = new Date(sec * 1000);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmtDate(sec)}, ${time}`;
}

/** `1 candidate` / `2 candidates`. */
function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The line a page shows while its data loads or when the load failed: a loading narrator line, or a love
 * line with a retry button.
 *
 * @param error - The loader's error message, if it failed.
 * @param reload - Runs the loader again.
 */
function Pending({ error, reload }: { error: string | null; reload?: () => void }) {
  if (error) return <ErrorLine onRetry={reload}>{`That did not load: ${error}.`}</ErrorLine>;
  return <Loading />;
}

/** One stat tile (`.fx-tiles` child): a muted label, a big value, a note line. `off` dashes it when there is nothing yet. */
function Tile({ label, value, unit, note, off }: { label: string; value: ReactNode; unit?: string; note?: string; off?: boolean }) {
  return (
    <div className={off ? "off" : undefined}>
      <span className="kv_label c1">{label}</span>
      <span className="kv_value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {note && <span className="note">{note}</span>}
    </div>
  );
}

/** A table that scrolls sideways inside its window instead of the page (`.fx-scroll > table.fx-table`). */
function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="fx-scroll">
      <table className="fx-table">{children}</table>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* overview                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The club actions shared by the overview's approvals window and the clubs page: approve, and terminate
 * (the overview calls it reject) behind a confirm dialog.
 *
 * @param reload - Reloads the club list after an action.
 * @returns `approve`, `terminate(club, verb)` and the confirm `dialog` element the caller must render.
 */
function useClubActions(reload: () => void) {
  const { confirm, dialog } = useConfirm();
  const approve = async (c: any) => {
    await api.approveClub(c.id);
    reload();
  };
  const terminate = async (c: any, verb: "terminate" | "reject" = "terminate") => {
    const message =
      verb === "reject"
        ? `Reject ${c.name}? The club closes, and it does not come back.`
        : `Terminate ${c.name}? The club closes, and its members lose their place in it.`;
    if (!(await confirm({ label: `confirm: ~/clubs/${verb}`, title: `${verb} club`, message, confirmLabel: verb }))) return;
    await api.terminateClub(c.id);
    reload();
  };
  return { approve, terminate, dialog };
}

/** What the president may do, shown as the `powers` row of the council window. */
const PRESIDENT_POWERS = ["weekly theme", "club approval"];

/**
 * The overview: server numbers as tiles, the council, the top members, and (for the president and admins)
 * the clubs waiting for a verdict with approve and reject.
 */
export function Overview() {
  const { data, error, reload } = useAsync(() => api.stats());
  const me = useMe();
  const canManage = ROLE_RANK[me?.role ?? "user"] >= ROLE_RANK.president;
  const clubs = useAsync(() => (canManage ? api.clubs() : Promise.resolve([] as any[])), [canManage]);
  const clubActions = useClubActions(clubs.reload);
  const name = useNames([
    data?.president?.userId,
    ...(data?.topMembers ?? []).map((m: any) => m.userId),
    ...(clubs.data ?? []).filter((c) => c.status === "pending").map((c) => c.ownerId),
  ]);
  if (!data) return <Pending error={error} reload={reload} />;
  const top: any[] = data.topMembers ?? [];
  const election = data.election;

  const pendingClubs = (clubs.data ?? []).filter((c) => c.status === "pending");
  return (
    <>
      <div className="fx-grid fx-tiles desk:grid-cols-4">
        <Tile label="members" value={data.members.toLocaleString()} note="in the server" />
        <Tile label="messages" value={data.totalMessages.toLocaleString()} note="sent so far" />
        <Tile label="in circulation" value={data.totalCredits.toLocaleString()} unit="sc" note="social credits" />
        <Tile label="total xp" value={data.totalXp.toLocaleString()} note="earned by everyone" />
        <Tile label="active clubs" value={data.clubs} note="approved and running" />
        <Tile label="awaiting approval" value={data.pendingClubs} note="clubs, need a verdict" off={!data.pendingClubs} />
        <Tile label="starboard" value={data.starboardPosts} note="posts" />
        <Tile
          label="election"
          value={election ? (election.status === "registration" ? "signup" : "voting") : "none"}
          note={election ? plural(election.candidates, "candidate") : "no ballot open"}
          off={!election}
        />
      </div>

      <div className="fx-grid items-start">
        <Window label="fish: ~/council">
          {data.president ? (
            <div className="fx-sheet">
              <span className="kv_label">president</span>
              <span className="c6">
                <UserLink id={data.president.userId} />
              </span>
              {data.president.termStart && (
                <>
                  <span className="kv_label">term</span>
                  <span>since {fmtDate(data.president.termStart)}</span>
                </>
              )}
              <span className="kv_label">powers</span>
              <span className="c6">{PRESIDENT_POWERS.join(", ")}</span>
            </div>
          ) : (
            <Empty>Nobody holds the office. The chair stands empty.</Empty>
          )}
          <p className="nar mt-3">
            {election
              ? election.status === "registration"
                ? `Signup is open with ${plural(election.candidates, "candidate")}. Voting begins ${fmtDateTime(election.votingStartsAt)}.`
                : `Voting is underway with ${plural(election.candidates, "candidate")}. The ballot closes ${fmtDateTime(election.endsAt)}.`
              : "No election is open. The ballot box sits empty in the corner."}
          </p>
        </Window>

        <Window label="fish: ~/top" foot={<span className="r">top {top.length} of {data.members.toLocaleString()}</span>}>
          {top.length === 0 ? (
            <Empty>No members are tracked yet. The ladder is bare.</Empty>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>#</th>
                  <th>member</th>
                  <th className="r">level</th>
                  <th className="r">xp</th>
                  <th className="r">sc</th>
                </tr>
              </thead>
              <tbody>
                {top.map((m, i) => (
                  <tr key={m.userId}>
                    <td>{i + 1}</td>
                    <td>
                      <UserLink id={m.userId} />
                    </td>
                    <td className="r">{m.level}</td>
                    <td className="r">{Number(m.xp).toLocaleString()}</td>
                    <td className="r">{Number(m.socialCredits).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Window>
      </div>

      {canManage && pendingClubs.length > 0 && (
        <Window label="fish: ~/clubs" tone="gold">
          <p className="nar">{pendingClubs.length === 1 ? "One club waits" : `${pendingClubs.length} clubs wait`} for a verdict.</p>
          {pendingClubs.map((c) => (
            <SettingRow
              key={c.id}
              className={STACK_ON_PHONE}
              label={
                <>
                  {c.name} <Chip>tier {c.level}</Chip>
                </>
              }
              description={
                <>
                  asked by {name(c.ownerId)} · {fmtDate(c.createdAt)}
                </>
              }
            >
              <InkButton tone="gold" onClick={() => clubActions.approve(c)}>
                approve
              </InkButton>{" "}
              <InkButton tone="love" onClick={() => clubActions.terminate(c, "reject")}>
                reject
              </InkButton>
            </SettingRow>
          ))}
        </Window>
      )}
      {clubActions.dialog}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* config                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** Mirrors src/plugins/linkfixer/domains.ts PLATFORMS (key + label only). */
const LINK_FIXER_PLATFORMS: { key: string; label: string }[] = [
  { key: "twitter", label: "twitter/x" },
  { key: "pixiv", label: "pixiv" },
  { key: "tiktok", label: "tiktok" },
  { key: "reddit", label: "reddit" },
  { key: "instagram", label: "instagram" },
  { key: "twitch_clips", label: "twitch clips" },
  { key: "iwara", label: "iwara" },
  { key: "bluesky", label: "bluesky" },
  { key: "facebook", label: "facebook" },
  { key: "bilibili", label: "bilibili" },
  { key: "bilibili_opus", label: "bilibili opus" },
  { key: "tumblr", label: "tumblr" },
  { key: "threads", label: "threads" },
  { key: "ptt", label: "ptt" },
  { key: "deviantart", label: "deviantart" },
  { key: "pinterest", label: "pinterest" },
  { key: "youtube", label: "youtube" },
];

/** One editable `guild_config` column: its key, the prompt, an optional hint, the input type and its group. */
interface ConfigField {
  key: string;
  label: string;
  hint?: string;
  type?: string;
  group: "channels" | "roles" | "rules";
}

const CONFIG_FIELDS: ConfigField[] = [
  { key: "starboardChannelId", label: "starboard channel id", group: "channels" },
  { key: "clubListingChannelId", label: "club listing channel id", group: "channels" },
  { key: "clubCategoryId", label: "club category id", group: "channels" },
  { key: "electionChannelId", label: "election channel id", group: "channels" },
  { key: "modLogChannelId", label: "mod-log channel id", group: "channels" },
  { key: "levelUpChannelId", label: "level-up channel id", group: "channels" },
  { key: "announcementChannelId", label: "announcement channel id", group: "channels" },
  { key: "approvalChannelId", label: "admin approval channel id", group: "channels" },
  { key: "eventsChannelId", label: "events channel id", hint: "Announcements and reminders go here.", group: "channels" },
  { key: "presidentRoleId", label: "president role id", group: "roles" },
  { key: "clubCreateMinRoleId", label: "club-create min role id", group: "roles" },
  { key: "clubAdminRoleId", label: "club admin role id", group: "roles" },
  { key: "presidentApplyMinRoleId", label: "president-apply min role id", group: "roles" },
  { key: "starboardEmoji", label: "starboard emoji", group: "rules" },
  { key: "starboardThreshold", label: "starboard threshold", type: "number", group: "rules" },
  { key: "serverNameTemplate", label: "server name template", hint: "%s is where the president's theme name goes.", group: "rules" },
  { key: "xpMessageCooldownSec", label: "xp message cooldown (s)", type: "number", group: "rules" },
];

const CONFIG_GROUPS: { id: ConfigField["group"]; title: string }[] = [
  { id: "channels", title: "channels" },
  { id: "roles", title: "roles" },
  { id: "rules", title: "rules" },
];

/** The settings tab of the config page: guild config fields and the link fixer, both saved together. */
function ConfigSettingsTab() {
  const { data, error, reload, setData } = useAsync(() => api.getConfig());
  const [saved, setSaved] = useState(false);
  if (!data) return <Pending error={error} reload={reload} />;

  const save = async () => {
    const patch: Record<string, any> = {};
    for (const f of CONFIG_FIELDS) patch[f.key] = data[f.key];
    patch.linkFixerEnabled = data.linkFixerEnabled;
    patch.linkFixerDisabledPlatforms = data.linkFixerDisabledPlatforms;
    const fresh = await api.updateConfig(patch);
    setData(fresh);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const disabledPlatforms: string[] = data.linkFixerDisabledPlatforms ?? [];
  const togglePlatform = (key: string) => {
    const next = disabledPlatforms.includes(key)
      ? disabledPlatforms.filter((k) => k !== key)
      : [...disabledPlatforms, key];
    setData({ ...data, linkFixerDisabledPlatforms: next });
  };

  const saveRow = (
    <div className="btns">
      <InkButton tone="gold" onClick={save}>
        save
      </InkButton>
      {saved && <Saved />}
    </div>
  );

  return (
    <>
      <Window label="fish: ~/config" foot={<span className="r">writes guild_config</span>}>
        {CONFIG_GROUPS.map((g, gi) => (
          <div key={g.id}>
            <Heading first={gi === 0}>{g.title}</Heading>
            {CONFIG_FIELDS.filter((f) => f.group === g.id).map((f) => (
              <PromptField
                key={f.key}
                className={FIELD_WRAP}
                label={f.label}
                promptWidth={42}
                type={f.type ?? "text"}
                hint={f.hint}
                value={String(data[f.key] ?? "")}
                onChange={(v) =>
                  setData({
                    ...data,
                    [f.key]: f.type === "number" ? Number(v) : v,
                  })
                }
              />
            ))}
          </div>
        ))}
        {saveRow}
      </Window>

      <Window label="fish: ~/link-fixer" foot={<span className="r">writes guild_config</span>}>
        <Toggle
          label="link fixer"
          description="Replaces links to the platforms below with embed-friendly ones."
          checked={!!data.linkFixerEnabled}
          onChange={(on) => setData({ ...data, linkFixerEnabled: on ? 1 : 0 })}
        />
        <Heading>platforms</Heading>
        <p className="note-s px-2 pb-2">A solid chip means the platform's links are fixed.</p>
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          {LINK_FIXER_PLATFORMS.map((p) => (
            <Chip key={p.key} on={!disabledPlatforms.includes(p.key)} onToggle={() => togglePlatform(p.key)}>
              {p.label}
            </Chip>
          ))}
        </div>
        {saveRow}
      </Window>
    </>
  );
}

const CONFIG_TABS = [
  { value: "settings", label: "settings" },
  { value: "messages", label: "bot messages" },
] as const;

/** The config page: a tab bar between the guild settings and the bot's message templates. */
export function ConfigPage() {
  const [tab, setTab] = useState<(typeof CONFIG_TABS)[number]["value"]>("settings");
  return (
    <div className="flex flex-col gap-6">
      {/* The tab words hang 1ch left of the row (`margin: 0 -1ch`), so the row pads 1ch to line up with the windows. */}
      <Tabs items={[...CONFIG_TABS]} value={tab} onChange={setTab} ariaLabel="config sections" idPrefix="config" className="pl-[1ch]" />
      <div
        role="tabpanel"
        id={`config-panel-${tab}`}
        aria-labelledby={`config-tab-${tab}`}
        className="flex flex-col gap-9 desk:gap-12"
      >
        {tab === "settings" ? <ConfigSettingsTab /> : <BotMessagesTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* auto-replies                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

const MATCH_TYPES = [
  { value: "contains", label: "contains" },
  { value: "exact", label: "exact" },
  { value: "regex", label: "regex" },
];

/**
 * The auto-replies page: the list of replies, or the editor for one (a window of fields plus the
 * Components V2 editor) while a reply is being created or changed.
 */
export function AutoRepliesPage() {
  const { data, error, reload } = useAsync(() => api.autoreplies());
  const [editing, setEditing] = useState<any | null>(null);
  const { confirm, dialog } = useConfirm();
  const matchId = useId();

  const blank = () => ({
    name: "",
    trigger: "",
    matchType: "contains",
    caseSensitive: 0,
    enabled: 1,
    responseComponents: [{ type: 17, accent_color: DEFAULT_ACCENT, components: [{ type: 10, content: "Hello." }] }],
  });

  const save = async () => {
    if (editing.id) await api.updateAutoreply(editing.id, editing);
    else await api.createAutoreply(editing);
    setEditing(null);
    reload();
  };

  if (editing) {
    return (
      <>
        <Window label={`vim: ~/autoreplies/${editing.id ? editing.name || editing.id : "new"}`}>
          <PromptField label="name" className={FIELD_WRAP} promptWidth={28} value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
          <PromptField
            label="trigger"
            className={FIELD_WRAP}
            promptWidth={28}
            value={editing.trigger}
            onChange={(v) => setEditing({ ...editing, trigger: v })}
          />
          <SettingRow label="match type" labelId={matchId}>
            <Select
              options={MATCH_TYPES}
              value={editing.matchType}
              onChange={(v) => setEditing({ ...editing, matchType: v })}
              ariaLabelledBy={matchId}
            />
          </SettingRow>
          <Toggle
            label="case sensitive"
            checked={!!editing.caseSensitive}
            onChange={(on) => setEditing({ ...editing, caseSensitive: on ? 1 : 0 })}
          />
          <Heading>reply</Heading>
          <div className="px-2">
            <ComponentsEditor
              value={editing.responseComponents}
              onChange={(payload) => setEditing((cur: any) => ({ ...cur, responseComponents: payload }))}
            />
          </div>
          <div className="btns">
            <InkButton tone="gold" onClick={save}>
              save
            </InkButton>
            <InkButton tone="muted" onClick={() => setEditing(null)}>
              cancel
            </InkButton>
          </div>
        </Window>
      </>
    );
  }

  const remove = async (r: any) => {
    if (!(await confirm({ label: "confirm: ~/autoreplies/delete", title: "delete auto-reply", message: `Delete ${r.name}? The bot stops answering "${r.trigger}", and it does not come back.`, confirmLabel: "delete" })))
      return;
    await api.deleteAutoreply(r.id);
    reload();
  };

  return (
    <>
      <Window label="fish: ~/autoreplies" tone={data && data.length === 0 ? "gold" : "pine"}>
        {!data ? (
          <Pending error={error} reload={reload} />
        ) : (
          <>
            {data.length === 0 && <Empty>The bot has nothing to say on its own yet. Teach it a phrase.</Empty>}
            {data.map((r) => (
              <SettingRow
                key={r.id}
                className={STACK_ON_PHONE}
                label={
                  <>
                    {r.name} {!r.enabled && <Chip>disabled</Chip>}
                  </>
                }
                description={
                  <>
                    {r.matchType}: <code>{r.trigger}</code>
                  </>
                }
              >
                <InkButton tone="muted" onClick={() => setEditing(r)}>
                  edit
                </InkButton>{" "}
                <InkButton tone="love" onClick={() => remove(r)}>
                  delete
                </InkButton>
              </SettingRow>
            ))}
            <div className="btns">
              <InkButton tone="gold" onClick={() => setEditing(blank())}>
                new auto-reply
              </InkButton>
            </div>
          </>
        )}
      </Window>
      {dialog}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* clubs                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

/** A club's status as a chip: approved is solid with a check, every other status a dashed word. */
function StatusChip({ status }: { status: string }) {
  return <Chip on={status === "approved"}>{status}</Chip>;
}

/**
 * The modal behind a club's `details` button: status, tier, activity bar, owner, members and dates.
 *
 * @param id - The club's id.
 * @param onClose - Called when the dialog closes.
 */
function ClubDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error } = useAsync<any>(() => api.clubDetail(id), [id]);
  const name = useNames([data?.ownerId, ...(data?.memberIds ?? [])]);
  return (
    <Modal title={data?.name ?? "club"} label={`fish: ~/clubs/${id}`} onClose={onClose}>
      {!data ? (
        <Pending error={error} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-2">
            <StatusChip status={data.status} />
            <Chip>
              {data.tierLabel} (tier {data.level})
            </Chip>
            <Chip>{plural(data.memberIds.length, "member")}</Chip>
          </div>

          {data.description && <p className="nar px-2 pt-3">{data.description}</p>}

          <div className="progress px-2 pt-3">
            <div className="progress_head">
              <span>activity</span>
              <span className="progress_num">{data.activityScore}/100</span>
            </div>
            <div className="progress_track" role="img" aria-label={`activity ${data.activityScore} of 100`}>
              <div className="progress_fill" style={{ width: `${Math.max(0, Math.min(100, data.activityScore))}%` }} />
            </div>
          </div>

          <div className="fx-sheet px-2 pt-3">
            <span className="kv_label">owner</span>
            <span className="c6">
              <UserLink id={data.ownerId} />
            </span>
            <span className="kv_label">founded</span>
            <span>{fmtDate(data.createdAt)}</span>
            <span className="kv_label">last active</span>
            <span>{fmtDate(data.lastActiveAt)}</span>
          </div>

          <Heading>members</Heading>
          {data.memberIds.length === 0 ? (
            <Empty>Nobody has joined yet.</Empty>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 c6">
              {data.memberIds.map((mid: string) => (
                <a key={mid} href={`#/member/${mid}`} className="underline">
                  {name(mid)}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/**
 * The clubs page: every club with its status and numbers, a details dialog for each, and for the president
 * and admins the approve and terminate actions.
 */
export function ClubsPage() {
  const { data, error, reload } = useAsync(() => api.clubs());
  const me = useMe();
  const [detailId, setDetailId] = useState<number | null>(null);
  const { approve, terminate, dialog } = useClubActions(reload);
  // Regular members get a read-only club directory; oversight actions are
  // reserved for the president and admins (the API enforces this too).
  const canManage = ROLE_RANK[me?.role ?? "user"] >= ROLE_RANK.president;
  const pending = (data ?? []).filter((c) => c.status === "pending").length;

  return (
    <>
      <Window label="fish: ~/clubs" tone={canManage && pending ? "gold" : "pine"} foot={data ? <span className="r">{plural(data.length, "club")}</span> : undefined}>
        {!data ? (
          <Pending error={error} reload={reload} />
        ) : data.length === 0 ? (
          <Empty>No club has been founded yet. The hall is quiet.</Empty>
        ) : (
          <>
            {canManage && pending > 0 && <p className="nar">{pending === 1 ? "One club waits" : `${pending} clubs wait`} for a verdict.</p>}
            {data.map((c) => (
              <SettingRow
                key={c.id}
                className={STACK_ON_PHONE}
                label={
                  <>
                    {c.name} <StatusChip status={c.status} />
                  </>
                }
                description={
                  <>
                    L{c.level} · {plural(c.memberCount, "member")} · activity {c.activityScore}/100
                    {c.description ? ` · ${c.description}` : ""}
                  </>
                }
              >
                <InkButton tone="muted" onClick={() => setDetailId(c.id)}>
                  details
                </InkButton>
                {canManage && c.status === "pending" && (
                  <>
                    {" "}
                    <InkButton tone="gold" onClick={() => approve(c)}>
                      approve
                    </InkButton>
                  </>
                )}
                {canManage && c.status !== "terminated" && (
                  <>
                    {" "}
                    <InkButton tone="love" onClick={() => terminate(c)}>
                      terminate
                    </InkButton>
                  </>
                )}
              </SettingRow>
            ))}
          </>
        )}
      </Window>
      {detailId !== null && <ClubDetailModal id={detailId} onClose={() => setDetailId(null)} />}
      {dialog}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* elections                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/** The elections page: the open election with start and close actions, and its candidates. */
export function ElectionsPage() {
  const { data, error, reload } = useAsync(() => api.elections());
  const name = useNames((data?.candidates ?? []).map((c: any) => c.userId));
  const { confirm, dialog } = useConfirm();
  if (!data) return <Pending error={error} reload={reload} />;

  const close = async () => {
    if (!(await confirm({ label: "confirm: ~/elections/close", title: "close and tally", message: "Close the election and count the ballots? The result stands, and the vote ends now.", confirmLabel: "close and tally" })))
      return;
    await api.closeElection(data.open.id);
    reload();
  };

  return (
    <>
      <Window label="fish: ~/election" tone={data.open ? "pine" : "gold"}>
        {data.open ? (
          <>
            <p className="nar">
              {data.open.status === "registration"
                ? `Signup is open. Voting begins ${fmtDateTime(data.open.votingStartsAt)}.`
                : `The ballot is open. It closes ${fmtDateTime(data.open.endsAt)}.`}
            </p>
            <div className="btns">
              <InkButton tone="love" onClick={close}>
                close and tally
              </InkButton>
            </div>
          </>
        ) : (
          <>
            <Empty>No election is open. The ballot box sits empty in the corner.</Empty>
            <div className="btns">
              <InkButton
                tone="gold"
                onClick={async () => {
                  await api.startElection();
                  reload();
                }}
              >
                start election
              </InkButton>
            </div>
          </>
        )}
      </Window>
      {data.candidates?.length > 0 && (
        <Window label="fish: ~/candidates" foot={<span className="r">{plural(data.candidates.length, "candidate")}</span>}>
          <DataTable>
            <thead>
              <tr>
                <th>candidate</th>
                <th>motto</th>
                <th className="r">votes</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((c: any) => (
                <tr key={c.id}>
                  <td>{name(c.userId)}</td>
                  <td className="whitespace-normal">{c.motto}</td>
                  <td className="r">{c.voteCount}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Window>
      )}
      {dialog}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* president                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/** `2d 3h 10m`, or `ready now` when the cooldown is over. */
function humanDuration(sec: number): string {
  if (sec <= 0) return "ready now";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ") || "<1m";
}

/** The president's desk: who holds the office, the weekly server theme form, and a pointer to club oversight. */
export function PresidentPage() {
  const { data, error, reload } = useAsync(() => api.president());
  const [name, setName] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  if (!data) return <Pending error={error} reload={reload} />;

  const onCooldown = data.cooldownRemaining > 0;
  const preview = (data.template as string).replace("%s", name || "…");

  const submit = async () => {
    setMsg(null);
    try {
      const res = await api.changeTheme({ name: name || undefined, iconUrl: iconUrl || undefined });
      setMsg({ text: "applied: " + res.applied.join(", "), bad: false });
      setName("");
      setIconUrl("");
      reload();
    } catch (e: any) {
      setMsg({ text: e.message, bad: true });
    }
  };

  return (
    <>
      <Window label="fish: ~/council">
        <div className="fx-sheet">
          <span className="kv_label">president</span>
          <span className="c6">{data.userId ? <UserName id={data.userId} /> : "none elected"}</span>
          {data.termStart && (
            <>
              <span className="kv_label">term</span>
              <span>since {fmtDate(data.termStart)}</span>
            </>
          )}
          <span className="kv_label">theme change</span>
          <span className={onCooldown ? "c3" : "c6"}>{humanDuration(data.cooldownRemaining)}</span>
        </div>
        <p className="note-s pt-3">
          Club oversight (approve and terminate) is on the{" "}
          <span className="c6">
            <a href="#/clubs" className="underline">
              clubs
            </a>
          </span>{" "}
          page.
        </p>
      </Window>

      <Window label="fish: ~/theme">
        <PromptField
          label="custom name"
          className={FIELD_WRAP}
          promptWidth={28}
          value={name}
          onChange={setName}
          placeholder="Spring Festival"
          hint={
            <>
              Fills the <code>%s</code> slot. Preview: <span className="c6">{preview}</span>
            </>
          }
        />
        <PromptField label="server icon url" className={FIELD_WRAP} promptWidth={28} value={iconUrl} onChange={setIconUrl} placeholder="https://…/icon.png" />
        <div className="btns items-center">
          <InkButton tone="gold" disabled={onCooldown} onClick={submit}>
            {onCooldown ? "on cooldown" : "apply theme"}
          </InkButton>
          {msg && (msg.bad ? <span className="c2" role="alert">{msg.text}</span> : <Saved>{msg.text}</Saved>)}
        </div>
      </Window>
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* presidency history, moderation, leaderboard                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** The presidency history: every concluded term, its dates and votes. */
export function PresidencyHistoryPage() {
  const { data, error, reload } = useAsync(() => api.presidencyHistory());
  if (!data) return <Pending error={error} reload={reload} />;
  return (
    <Window label="fish: ~/presidents" foot={<span className="r">{plural(data.length, "term")}</span>}>
      {data.length === 0 ? (
        <Empty>No election has concluded yet. The corridor has no portraits.</Empty>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>president</th>
              <th>term start</th>
              <th>term end</th>
              <th className="r">votes</th>
            </tr>
          </thead>
          <tbody>
            {data.map((t: any) => (
              <tr key={t.electionId}>
                <td>
                  <UserLink id={t.userId} />
                </td>
                <td>{fmtDate(t.termStart)}</td>
                <td>{t.termEnd ? fmtDate(t.termEnd) : "present"}</td>
                <td className="r">{t.votes}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Window>
  );
}

/** The moderation page: the latest warnings and the mod log, side by side. */
export function ModerationPage() {
  const warnings = useAsync(() => api.warnings());
  const modlog = useAsync(() => api.modlog());
  const name = useNames([
    ...(warnings.data ?? []).map((w) => w.userId),
    ...(modlog.data ?? []).map((m) => m.userId),
  ]);
  return (
    <div className="fx-grid items-start">
      <Window label="fish: ~/warnings" foot={warnings.data ? <span className="r">latest {warnings.data.length}</span> : undefined}>
        {!warnings.data ? (
          <Pending error={warnings.error} reload={warnings.reload} />
        ) : warnings.data.length === 0 ? (
          <Empty>No warnings. The server has behaved.</Empty>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>member</th>
                <th>reason</th>
                <th>when</th>
              </tr>
            </thead>
            <tbody>
              {warnings.data.map((w) => (
                <tr key={w.id}>
                  <td>{name(w.userId)}</td>
                  <td className="whitespace-normal">{w.reason}</td>
                  <td>{w.createdAt ? fmtDate(w.createdAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Window>
      <Window label="fish: ~/modlog" foot={modlog.data ? <span className="r">latest {modlog.data.length}</span> : undefined}>
        {!modlog.data ? (
          <Pending error={modlog.error} reload={modlog.reload} />
        ) : modlog.data.length === 0 ? (
          <Empty>The log is empty. Nothing needed a moderator.</Empty>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>action</th>
                <th>member</th>
                <th>reason</th>
                <th>when</th>
              </tr>
            </thead>
            <tbody>
              {modlog.data.map((m) => (
                <tr key={m.id}>
                  <td className="c3">{m.action}</td>
                  <td>{name(m.userId)}</td>
                  <td className="whitespace-normal">{m.reason ?? ""}</td>
                  <td>{m.createdAt ? fmtDate(m.createdAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Window>
    </div>
  );
}

/** The leaderboard: every tracked member ranked, with social credits, level and xp. */
export function LeaderboardPage() {
  const { data, error, reload } = useAsync(() => api.leaderboard());
  const me = useMe();
  if (!data) return <Pending error={error} reload={reload} />;
  return (
    <Window label="fish: ~/leaderboard" foot={<span className="r">{plural(data.length, "member")}</span>}>
      {data.length === 0 ? (
        <Empty>Nobody has spoken yet. The board is blank.</Empty>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>#</th>
              <th>user</th>
              <th className="r">credits</th>
              <th className="r">level</th>
              <th className="r">xp</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m, i) => (
              <tr key={m.userId} className={me?.userId === m.userId ? "sel" : undefined}>
                <td>{i + 1}</td>
                <td>
                  <UserLink id={m.userId} />
                </td>
                <td className="r">{Number(m.socialCredits).toLocaleString()}</td>
                <td className="r">{m.level}</td>
                <td className="r">{Number(m.xp).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Window>
  );
}

/**
 * The pages of the dashboard, in nav order. `id` is the hash route (`#/<id>`), `label` the lowercase name
 * the shell shows, `minRole` the lowest web role that sees the page.
 */
export const PAGES: {
  id: string;
  label: string;
  el: ReactElement;
  /** Minimum dashboard role that sees this page (default: every member). */
  minRole?: "president" | "admin";
}[] = [
  { id: "overview", label: "overview", el: <Overview /> },
  { id: "profile", label: "my profile", el: <ProfilePage /> },
  { id: "store", label: "store", el: <StorePage /> },
  { id: "leaderboard", label: "leaderboard", el: <LeaderboardPage /> },
  { id: "clubs", label: "clubs", el: <ClubsPage /> },
  { id: "events", label: "events", el: <EventsPage /> },
  { id: "presidency-history", label: "presidency", el: <PresidencyHistoryPage /> },
  { id: "president", label: "president", el: <PresidentPage />, minRole: "president" },
  { id: "config", label: "config", el: <ConfigPage />, minRole: "admin" },
  { id: "autoreplies", label: "auto-replies", el: <AutoRepliesPage />, minRole: "admin" },
  { id: "elections", label: "elections", el: <ElectionsPage />, minRole: "admin" },
  { id: "moderation", label: "moderation", el: <ModerationPage />, minRole: "admin" },
  { id: "store-items", label: "store items", el: <StoreItemsPage />, minRole: "admin" },
  { id: "events-editor", label: "events editor", el: <EventsEditorPage />, minRole: "president" },
];

export type { Me };
