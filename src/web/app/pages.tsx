import { useState, type ReactElement } from "react";
import { api, type Me } from "./api.ts";
import { ComponentsEditor } from "./ComponentsEditor.tsx";
import { useNames, UserName, UserLink } from "./names.tsx";
import { useMe, ROLE_RANK } from "./me-context.ts";
import { card, btn, btnGhost, input, useAsync } from "./ui.ts";
import { Modal } from "./Modal.tsx";
import { StorePage } from "./StorePage.tsx";
import { StoreItemsPage } from "./StoreItemsPage.tsx";
import { ProfilePage } from "./ProfilePage.tsx";
import { BotMessagesTab } from "./BotMessagesTab.tsx";
import { EventsPage, EventsEditorPage } from "./EventsPages.tsx";

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className={card}>
      <div className="comic-title text-3xl">{value}</div>
      <div className="text-ink-soft text-sm font-bold">{label}</div>
    </div>
  );
}

export function Overview() {
  const { data } = useAsync(() => api.stats());
  const name = useNames([
    data?.president?.userId,
    ...(data?.topMembers ?? []).map((m: any) => m.userId),
  ]);
  if (!data) return <p className="on-bg-soft">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Stat value={data.members} label="Members" />
        <Stat value={data.totalMessages.toLocaleString()} label="Messages sent" />
        <Stat value={data.totalCredits.toLocaleString()} label="SC in circulation" />
        <Stat value={data.totalXp.toLocaleString()} label="Total XP earned" />
        <Stat value={data.clubs} label="Active clubs" />
        <Stat value={data.pendingClubs} label="Clubs awaiting approval" />
        <Stat value={data.starboardPosts} label="Starboard posts" />
        <Stat
          value={data.election ? (data.election.status === "registration" ? "Registration" : "Voting") : "—"}
          label="Election"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={card + " space-y-1 text-sm"}>
          <div className="font-medium mb-1">🏛️ Student Council</div>
          {data.president ? (
            <>
              <div>
                President: <strong><UserLink id={data.president.userId} /></strong>
              </div>
              {data.president.termStart && (
                <div className="text-ink-soft">
                  Term started {new Date(data.president.termStart * 1000).toLocaleDateString()}
                </div>
              )}
            </>
          ) : (
            <div className="text-ink-soft">No president currently in office.</div>
          )}
          {data.election && (
            <div className="text-ink-soft">
              {data.election.status === "registration" ? (
                <>
                  Election open — {data.election.candidates} candidate(s), voting begins{" "}
                  {new Date(data.election.votingStartsAt * 1000).toLocaleString()}
                </>
              ) : (
                <>
                  Voting underway — {data.election.candidates} candidate(s), closes{" "}
                  {new Date(data.election.endsAt * 1000).toLocaleString()}
                </>
              )}
            </div>
          )}
        </div>

        <div className={card + " text-sm"}>
          <div className="font-medium mb-2">💰 Top Social Credits</div>
          {(data.topMembers ?? []).map((m: any, i: number) => (
            <div key={m.userId} className="flex justify-between py-0.5 border-b border-black/15 last:border-0">
              <span>
                {i + 1}. <UserLink id={m.userId} />
              </span>
              <span className="text-ink-soft">
                {m.socialCredits} SC · L{m.level}
              </span>
            </div>
          ))}
          {(data.topMembers ?? []).length === 0 && (
            <div className="text-ink-soft">No members tracked yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Mirrors src/plugins/linkfixer/domains.ts PLATFORMS (key + label only). */
const LINK_FIXER_PLATFORMS: { key: string; label: string }[] = [
  { key: "twitter", label: "Twitter/X" },
  { key: "pixiv", label: "Pixiv" },
  { key: "tiktok", label: "TikTok" },
  { key: "reddit", label: "Reddit" },
  { key: "instagram", label: "Instagram" },
  { key: "twitch_clips", label: "Twitch Clips" },
  { key: "iwara", label: "Iwara" },
  { key: "bluesky", label: "Bluesky" },
  { key: "facebook", label: "Facebook" },
  { key: "bilibili", label: "Bilibili" },
  { key: "bilibili_opus", label: "Bilibili Opus" },
  { key: "tumblr", label: "Tumblr" },
  { key: "threads", label: "Threads" },
  { key: "ptt", label: "PTT" },
  { key: "deviantart", label: "DeviantArt" },
  { key: "pinterest", label: "Pinterest" },
  { key: "youtube", label: "YouTube" },
];

const CONFIG_FIELDS: { key: string; label: string; type?: string }[] = [
  { key: "starboardChannelId", label: "Starboard channel ID" },
  { key: "clubListingChannelId", label: "Club listing channel ID" },
  { key: "clubCategoryId", label: "Club category ID" },
  { key: "electionChannelId", label: "Election channel ID" },
  { key: "modLogChannelId", label: "Mod-log channel ID" },
  { key: "levelUpChannelId", label: "Level-up channel ID" },
  { key: "announcementChannelId", label: "Announcement channel ID" },
  { key: "approvalChannelId", label: "Admin approval channel ID" },
  { key: "eventsChannelId", label: "Events channel ID (announcements + reminders)" },
  { key: "presidentRoleId", label: "President role ID" },
  { key: "clubCreateMinRoleId", label: "Club-create min role ID" },
  { key: "clubAdminRoleId", label: "Club admin role ID" },
  { key: "presidentApplyMinRoleId", label: "President-apply min role ID" },
  { key: "starboardEmoji", label: "Starboard emoji" },
  { key: "starboardThreshold", label: "Starboard threshold", type: "number" },
  { key: "serverNameTemplate", label: "Server name template (%s)" },
  { key: "xpMessageCooldownSec", label: "XP message cooldown (s)", type: "number" },
];

function ConfigSettingsTab() {
  const { data, setData } = useAsync(() => api.getConfig());
  const [saved, setSaved] = useState(false);
  if (!data) return <p className="on-bg-soft">Loading…</p>;

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

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CONFIG_FIELDS.map((f) => (
            <label key={f.key} className="text-sm space-y-1">
              <span className="text-ink-soft">{f.label}</span>
              <input
                className={input}
                type={f.type ?? "text"}
                value={data[f.key] ?? ""}
                onChange={(e) =>
                  setData({
                    ...data,
                    [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value,
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className={btn} onClick={save}>Save</button>
          {saved && <span className="text-green-700 text-sm">Saved ✓</span>}
        </div>
      </div>

      <div className={card}>
        <div className="font-medium mb-2">🔗 Link Fixer</div>
        <label className="text-sm flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            checked={!!data.linkFixerEnabled}
            onChange={(e) => setData({ ...data, linkFixerEnabled: e.target.checked ? 1 : 0 })}
          />
          <span>Enabled</span>
        </label>
        <div className="text-ink-soft text-xs mb-1">Disabled platforms (unchecked = fixed):</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
          {LINK_FIXER_PLATFORMS.map((p) => (
            <label key={p.key} className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={!disabledPlatforms.includes(p.key)}
                onChange={() => togglePlatform(p.key)}
              />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className={btn} onClick={save}>Save</button>
          {saved && <span className="text-green-700 text-sm">Saved ✓</span>}
        </div>
      </div>
    </div>
  );
}

const CONFIG_TABS = [
  { id: "settings", label: "Settings" },
  { id: "messages", label: "Bot Messages" },
] as const;

export function ConfigPage() {
  const [tab, setTab] = useState<(typeof CONFIG_TABS)[number]["id"]>("settings");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {CONFIG_TABS.map((t) => (
          <button
            key={t.id}
            className={
              "comic-btn px-4 py-1.5 text-sm" +
              (tab === t.id ? "" : " comic-btn--ghost")
            }
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "settings" ? <ConfigSettingsTab /> : <BotMessagesTab />}
    </div>
  );
}

export function AutoRepliesPage() {
  const { data, reload } = useAsync(() => api.autoreplies());
  const [editing, setEditing] = useState<any | null>(null);

  const blank = () => ({
    name: "",
    trigger: "",
    matchType: "contains",
    caseSensitive: 0,
    enabled: 1,
    responseComponents: [{ type: 17, accent_color: 0x5865f2, components: [{ type: 10, content: "Hello!" }] }],
  });

  const save = async () => {
    if (editing.id) await api.updateAutoreply(editing.id, editing);
    else await api.createAutoreply(editing);
    setEditing(null);
    reload();
  };

  if (editing) {
    return (
      <div className={card + " space-y-4"}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Name</span>
            <input className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Trigger</span>
            <input className={input} value={editing.trigger} onChange={(e) => setEditing({ ...editing, trigger: e.target.value })} />
          </label>
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Match type</span>
            <select className={input} value={editing.matchType} onChange={(e) => setEditing({ ...editing, matchType: e.target.value })}>
              <option value="contains">contains</option>
              <option value="exact">exact</option>
              <option value="regex">regex</option>
            </select>
          </label>
          <label className="text-sm flex items-center gap-2 mt-5">
            <input type="checkbox" checked={!!editing.caseSensitive} onChange={(e) => setEditing({ ...editing, caseSensitive: e.target.checked ? 1 : 0 })} />
            <span className="text-ink-soft">Case sensitive</span>
          </label>
        </div>

        <div>
          <div className="text-ink font-medium mb-2">Reply (Components V2)</div>
          <ComponentsEditor
            value={editing.responseComponents}
            onChange={(payload) => setEditing((cur: any) => ({ ...cur, responseComponents: payload }))}
          />
        </div>

        <div className="flex gap-2">
          <button className={btn} onClick={save}>Save</button>
          <button className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button className={btn} onClick={() => setEditing(blank())}>+ New auto-reply</button>
      {(data ?? []).map((r) => (
        <div key={r.id} className={card + " flex flex-wrap items-center justify-between gap-2"}>
          <div className="min-w-0">
            <div className="font-medium">{r.name} {r.enabled ? "" : <span className="text-ink-soft">(disabled)</span>}</div>
            <div className="text-ink-soft text-sm">{r.matchType}: <code>{r.trigger}</code></div>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => setEditing(r)}>Edit</button>
            <button className={btnGhost} onClick={async () => { await api.deleteAutoreply(r.id); reload(); }}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

const CLUB_STATUS_STYLE: Record<string, string> = {
  approved: "bg-green-200",
  pending: "bg-sun",
  terminated: "bg-red-200",
  draft: "bg-paper-dim",
  rejected: "bg-red-200",
};

function Chip({ children, tone = "bg-paper-dim" }: { children: any; tone?: string }) {
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full border-2 border-black text-xs font-bold ${tone}`}
    >
      {children}
    </span>
  );
}

function ClubDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useAsync<any>(() => api.clubDetail(id), [id]);
  const name = useNames([data?.ownerId, ...(data?.memberIds ?? [])]);
  return (
    <Modal title={data?.name ?? "Club"} onClose={onClose}>
      {!data ? (
        <p className="text-ink-soft font-bold">Loading…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Chip tone={CLUB_STATUS_STYLE[data.status] ?? "bg-paper-dim"}>{data.status}</Chip>
            <Chip>{data.tierLabel} (tier {data.level})</Chip>
            <Chip>{data.memberIds.length} members</Chip>
          </div>

          {data.description && <p className="font-bold">{data.description}</p>}

          <div>
            <div className="font-bold mb-1">Activity: {data.activityScore}/100</div>
            <div
              className="h-5 rounded-full border-[3px] border-black overflow-hidden"
              style={{ backgroundColor: "#e8e0cc" }}
            >
              <div
                className="h-full"
                style={{
                  width: `${data.activityScore}%`,
                  backgroundImage: "linear-gradient(90deg, #ffd23f, #ff6b35)",
                }}
              />
            </div>
          </div>

          <div>
            <span className="font-bold">Owner:</span> <UserLink id={data.ownerId} />
          </div>

          <div>
            <div className="font-bold mb-1">Members</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {data.memberIds.map((id: string) => (
                <a
                  key={id}
                  href={`#/member/${id}`}
                  className="underline decoration-2 hover:text-accent"
                >
                  {name(id)}
                </a>
              ))}
              {data.memberIds.length === 0 && <span className="text-ink-soft">None.</span>}
            </div>
          </div>

          <div className="text-ink-soft font-bold border-t-2 border-black/15 pt-2">
            Founded {new Date(data.createdAt * 1000).toLocaleDateString()} · last active{" "}
            {new Date(data.lastActiveAt * 1000).toLocaleDateString()}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ClubsPage() {
  const { data, reload } = useAsync(() => api.clubs());
  const me = useMe();
  const [detailId, setDetailId] = useState<number | null>(null);
  // Regular members get a read-only club directory; oversight actions are
  // reserved for the president and admins (the API enforces this too).
  const canManage = ROLE_RANK[me?.role ?? "user"] >= ROLE_RANK.president;
  return (
    <div className="space-y-3">
      {(data ?? []).map((c) => (
        <div key={c.id} className={card + " flex flex-wrap items-center justify-between gap-2"}>
          <div className="min-w-0">
            <div className="font-medium">{c.name} <span className="text-ink-soft text-sm">· {c.status} · L{c.level} · {c.memberCount} members · activity {c.activityScore}/100</span></div>
            <div className="text-ink-soft text-sm">{c.description}</div>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => setDetailId(c.id)}>Details</button>
            {canManage && c.status === "pending" && (
              <button className={btn} onClick={async () => { await api.approveClub(c.id); reload(); }}>Approve</button>
            )}
            {canManage && c.status !== "terminated" && (
              <button className={btnGhost} onClick={async () => { await api.terminateClub(c.id); reload(); }}>Terminate</button>
            )}
          </div>
        </div>
      ))}
      {detailId !== null && <ClubDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

export function ElectionsPage() {
  const { data, reload } = useAsync(() => api.elections());
  const name = useNames((data?.candidates ?? []).map((c: any) => c.userId));
  if (!data) return <p className="on-bg-soft">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className={card}>
        {data.open ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {data.open.status === "registration" ? (
                <>Registration open — voting begins <code>{new Date(data.open.votingStartsAt * 1000).toLocaleString()}</code></>
              ) : (
                <>Election open — closes <code>{new Date(data.open.endsAt * 1000).toLocaleString()}</code></>
              )}
            </div>
            <button className={btnGhost} onClick={async () => { await api.closeElection(data.open.id); reload(); }}>Close & tally</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-ink-soft">No election open.</div>
            <button className={btn} onClick={async () => { await api.startElection(); reload(); }}>Start election</button>
          </div>
        )}
      </div>
      {data.candidates?.length > 0 && (
        <div className={card}>
          <div className="font-medium mb-2">Candidates</div>
          {data.candidates.map((c: any) => (
            <div key={c.id} className="text-sm py-1 border-b border-black/15 last:border-0">
              <strong>{name(c.userId)}</strong> — {c.motto} · {c.voteCount} votes
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function humanDuration(sec: number): string {
  if (sec <= 0) return "ready now";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ") || "<1m";
}

export function PresidentPage() {
  const { data, reload } = useAsync(() => api.president());
  const [name, setName] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return <p className="on-bg-soft">Loading…</p>;

  const onCooldown = data.cooldownRemaining > 0;
  const preview = (data.template as string).replace("%s", name || "…");

  const submit = async () => {
    setMsg(null);
    try {
      const res = await api.changeTheme({ name: name || undefined, iconUrl: iconUrl || undefined });
      setMsg("Applied: " + res.applied.join(", "));
      setName("");
      setIconUrl("");
      reload();
    } catch (e: any) {
      setMsg("Error: " + e.message);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className={card + " text-sm space-y-1"}>
        <div>Current president: {data.userId ? <strong><UserName id={data.userId} /></strong> : <span className="text-ink-soft">none elected</span>}</div>
        {data.termStart && <div className="text-ink-soft">Term started {new Date(data.termStart * 1000).toLocaleDateString()}</div>}
        <div className="text-ink-soft">Weekly theme change: <span className={onCooldown ? "text-amber-700" : "text-green-700"}>{humanDuration(data.cooldownRemaining)}</span></div>
      </div>

      <div className={card + " space-y-3"}>
        <div className="font-medium">Server theme</div>
        <label className="text-sm space-y-1 block">
          <span className="text-ink-soft">Custom name (fills the <code>%s</code> slot)</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring Festival" />
        </label>
        <div className="text-xs text-ink-soft">Preview: <code>{preview}</code></div>
        <label className="text-sm space-y-1 block">
          <span className="text-ink-soft">Server icon URL</span>
          <input className={input} value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="https://…/icon.png" />
        </label>
        <div className="flex items-center gap-3">
          <button className={btn} disabled={onCooldown} onClick={submit}>
            {onCooldown ? "On cooldown" : "Apply theme"}
          </button>
          {msg && <span className="text-sm text-ink">{msg}</span>}
        </div>
      </div>

      <div className={card + " text-sm text-ink-soft"}>
        Club oversight (approve / terminate) is on the <strong>Clubs</strong> tab.
      </div>
    </div>
  );
}

export function PresidencyHistoryPage() {
  const { data } = useAsync(() => api.presidencyHistory());
  const name = useNames((data ?? []).map((t: any) => t.userId));
  if (!data) return <p className="on-bg-soft">Loading…</p>;
  return (
    <div className={card + " overflow-x-auto"}>
      <table className="w-full text-sm">
        <thead className="text-ink-soft text-left">
          <tr><th className="py-1">President</th><th>Term start</th><th>Term end</th><th>Votes</th></tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr><td className="py-2 text-ink-soft" colSpan={4}>No elections have concluded yet.</td></tr>
          )}
          {data.map((t: any) => (
            <tr key={t.electionId} className="border-t border-black/15">
              <td className="py-1"><UserLink id={t.userId} /></td>
              <td>{new Date(t.termStart * 1000).toLocaleDateString()}</td>
              <td>{t.termEnd ? new Date(t.termEnd * 1000).toLocaleDateString() : "Present"}</td>
              <td>{t.votes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ModerationPage() {
  const warnings = useAsync(() => api.warnings());
  const modlog = useAsync(() => api.modlog());
  const name = useNames([
    ...(warnings.data ?? []).map((w) => w.userId),
    ...(modlog.data ?? []).map((m) => m.userId),
  ]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className={card}>
        <div className="font-medium mb-2">Recent warnings</div>
        {(warnings.data ?? []).map((w) => (
          <div key={w.id} className="text-sm py-1 border-b border-black/15 last:border-0">
            <strong>{name(w.userId)}</strong> — {w.reason}
          </div>
        ))}
      </div>
      <div className={card}>
        <div className="font-medium mb-2">Mod log</div>
        {(modlog.data ?? []).map((m) => (
          <div key={m.id} className="text-sm py-1 border-b border-black/15 last:border-0">
            <span className="text-accent font-bold">{m.action}</span> <strong>{name(m.userId)}</strong> {m.reason ?? ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeaderboardPage() {
  const { data } = useAsync(() => api.leaderboard());
  const name = useNames((data ?? []).map((m) => m.userId));
  return (
    <div className={card + " overflow-x-auto"}>
      <table className="w-full text-sm">
        <thead className="text-ink-soft text-left">
          <tr><th className="py-1">#</th><th>User</th><th>Credits</th><th>Level</th><th>XP</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((m, i) => (
            <tr key={m.userId} className="border-t border-black/15">
              <td className="py-1">{i + 1}</td>
              <td><UserLink id={m.userId} /></td>
              <td>{m.socialCredits}</td>
              <td>{m.level}</td>
              <td>{m.xp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const PAGES: {
  id: string;
  label: string;
  el: ReactElement;
  /** Minimum dashboard role that sees this page (default: every member). */
  minRole?: "president" | "admin";
}[] = [
  { id: "overview", label: "Overview", el: <Overview /> },
  { id: "profile", label: "My Profile", el: <ProfilePage /> },
  { id: "store", label: "Store", el: <StorePage /> },
  { id: "leaderboard", label: "Leaderboard", el: <LeaderboardPage /> },
  { id: "clubs", label: "Clubs", el: <ClubsPage /> },
  { id: "events", label: "Events", el: <EventsPage /> },
  { id: "presidency-history", label: "Presidency History", el: <PresidencyHistoryPage /> },
  { id: "president", label: "President", el: <PresidentPage />, minRole: "president" },
  { id: "config", label: "Config", el: <ConfigPage />, minRole: "admin" },
  { id: "autoreplies", label: "Auto-Replies", el: <AutoRepliesPage />, minRole: "admin" },
  { id: "elections", label: "Elections", el: <ElectionsPage />, minRole: "admin" },
  { id: "moderation", label: "Moderation", el: <ModerationPage />, minRole: "admin" },
  { id: "store-items", label: "Store Items", el: <StoreItemsPage />, minRole: "admin" },
  { id: "events-editor", label: "Events Editor", el: <EventsEditorPage />, minRole: "president" },
];

export type { Me };
