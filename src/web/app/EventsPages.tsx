import { useMemo, useState } from "react";
import { api } from "./api.ts";
import { card, btn, btnGhost, input, useAsync } from "./ui.ts";
import { useMe } from "./me-context.ts";
import { DiscordMarkdown } from "./DiscordMarkdown.tsx";
import { Modal } from "./Modal.tsx";

/** Serialized event from GET /api/events (see events plugin serializeEvent). */
interface EventData {
  id: number;
  title: string;
  description: string;
  imageUrls: string[];
  accentColor: number | null;
  groupId: number | null;
  group: { id: number; name: string } | null;
  channelId: string | null;
  channelName: string | null;
  channelType: string | null;
  allDay: number;
  startAt: number;
  endAt: number | null;
  recurrence: string;
  recurrenceInterval: number;
  recurrenceUntil: number | null;
  recurrenceLabel: string;
  rewards: { id?: number; kind: string; roleId: string | null; amount: number | null; storeItemId: number | null }[];
  reminders: { id?: number; offsetMinutes: number }[];
  participantIds: string[];
  nextOccurrence: number | null;
  completed: boolean;
  occurrences: number[];
}

const RECURRENCE_OPTIONS = [
  { value: "none", label: "One-off (no repeat)" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly_day", label: "Monthly — same day of month" },
  { value: "monthly_weekday", label: "Monthly — same nth weekday" },
  { value: "yearly", label: "Yearly" },
  { value: "custom_days", label: "Every N days" },
];

const CHANNEL_TYPES = ["text", "voice", "stage", "forum"];

const accentHex = (accent: number | null) =>
  "#" + (accent ?? 0x5865f2).toString(16).padStart(6, "0");

// --- Filters (shared by the user page and the editor) ---

interface Filters {
  q: string;
  groupId: string;
  from: string; // yyyy-mm-dd
  to: string;
  completion: "all" | "upcoming" | "past";
  channelType: string;
  channel: string;
}

const emptyFilters: Filters = {
  q: "",
  groupId: "",
  from: "",
  to: "",
  completion: "all",
  channelType: "",
  channel: "",
};

function applyFilters(events: EventData[], f: Filters): EventData[] {
  const from = f.from ? new Date(f.from).getTime() / 1000 : null;
  const to = f.to ? new Date(f.to).getTime() / 1000 + 86400 : null;
  return events.filter((e) => {
    if (f.q && !e.title.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.groupId && String(e.groupId ?? "") !== f.groupId) return false;
    if (f.completion === "upcoming" && e.completed) return false;
    if (f.completion === "past" && !e.completed) return false;
    if (f.channelType && e.channelType !== f.channelType) return false;
    if (f.channel && !(e.channelName ?? "").toLowerCase().includes(f.channel.toLowerCase())) {
      return false;
    }
    if (from !== null || to !== null) {
      const anchor = e.nextOccurrence ?? e.startAt;
      const inRange = (t: number) =>
        (from === null || t >= from) && (to === null || t < to);
      if (!inRange(anchor) && !e.occurrences.some(inRange)) return false;
    }
    return true;
  });
}

function EventFilters({
  value,
  onChange,
  groups,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  groups: any[];
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  return (
    <div className={card + " grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 text-sm"}>
      <input
        className={input}
        placeholder="Search title…"
        value={value.q}
        onChange={(e) => set({ q: e.target.value })}
      />
      <select className={input} value={value.groupId} onChange={(e) => set({ groupId: e.target.value })}>
        <option value="">All groups</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
      <select
        className={input}
        value={value.completion}
        onChange={(e) => set({ completion: e.target.value as Filters["completion"] })}
      >
        <option value="all">Past & upcoming</option>
        <option value="upcoming">Upcoming only</option>
        <option value="past">Past only</option>
      </select>
      <select className={input} value={value.channelType} onChange={(e) => set({ channelType: e.target.value })}>
        <option value="">Any channel type</option>
        {CHANNEL_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <input
        className={input}
        placeholder="Channel name…"
        value={value.channel}
        onChange={(e) => set({ channel: e.target.value })}
      />
      <label className="flex items-center gap-1">
        <span className="text-ink-soft shrink-0">From</span>
        <input className={input} type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-ink-soft shrink-0">To</span>
        <input className={input} type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} />
      </label>
      <button className={btnGhost} onClick={() => onChange(emptyFilters)}>Clear</button>
    </div>
  );
}

// --- Calendar ---

function monthDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // weeks start Monday
  const count = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => new Date(year, month, i + 1)),
  ];
}

export function EventCalendar({
  events,
  onSelect,
}: {
  events: EventData[];
  onSelect?: (e: EventData) => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const byDay = useMemo(() => {
    const map = new Map<string, EventData[]>();
    for (const e of events) {
      for (const at of e.occurrences.length ? e.occurrences : [e.startAt]) {
        const d = new Date(at * 1000);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (!map.has(key)) map.set(key, []);
        if (!map.get(key)!.some((x) => x.id === e.id)) map.get(key)!.push(e);
      }
    }
    return map;
  }, [events]);

  const days = monthDays(cursor.y, cursor.m);
  const label = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const shift = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-2">
        <button className={btnGhost} onClick={() => shift(-1)}>◀</button>
        <div className="comic-title text-2xl">{label}</div>
        <button className={btnGhost} onClick={() => shift(1)}>▶</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs font-bold text-ink-soft mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const key = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : `x${i}`;
          const todays = d ? (byDay.get(key) ?? []) : [];
          const isToday =
            d &&
            d.getFullYear() === today.getFullYear() &&
            d.getMonth() === today.getMonth() &&
            d.getDate() === today.getDate();
          return (
            <div
              key={key}
              className={
                "min-h-12 sm:min-h-16 min-w-0 rounded border-2 p-1 text-xs " +
                (d ? "border-black/20 bg-paper-dim/40" : "border-transparent") +
                (isToday ? " border-black bg-sun/50" : "")
              }
            >
              {d && <div className="font-bold text-ink-soft">{d.getDate()}</div>}
              {todays.map((e) => (
                <button
                  key={e.id}
                  onClick={() => onSelect?.(e)}
                  title={e.title}
                  className="block w-full truncate text-left rounded px-1 mb-0.5 text-white font-bold"
                  style={{ backgroundColor: accentHex(e.accentColor) }}
                >
                  {e.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Shared event summary bits ---

function when(e: EventData): string {
  const at = e.nextOccurrence ?? e.startAt;
  const d = new Date(at * 1000);
  return e.allDay
    ? d.toLocaleDateString() + " (all day)"
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function EventDetailModal({
  event,
  joined,
  onToggle,
  onClose,
}: {
  event: EventData;
  joined: boolean;
  onToggle?: () => void;
  onClose: () => void;
}) {
  const ids = event.participantIds;
  const names = useAsync<Record<string, string>>(
    () => (ids.length ? api.usernames(ids) : Promise.resolve({})),
    [event.id, ids.join(",")],
  );
  return (
    <Modal title={event.title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {event.imageUrls.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {event.imageUrls.map((url) => (
              <img key={url} src={url} className="max-h-40 rounded border-2 border-black" />
            ))}
          </div>
        )}
        {event.description && (
          <div className="bg-[#313338] text-slate-100 rounded p-3">
            <DiscordMarkdown content={event.description} />
          </div>
        )}
        <div className="space-y-1 font-bold">
          <div>🕒 {when(event)} · {event.recurrenceLabel}</div>
          {event.channelName && <div>📍 #{event.channelName} ({event.channelType})</div>}
          {event.group && <div>🏷️ {event.group.name}</div>}
          {event.completed && <div className="text-ink-soft">✔ This event has ended.</div>}
        </div>
        <div className="space-y-1">
          <div className="font-bold">🔔 {ids.length} participant(s)</div>
          {ids.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ids.map((id) => (
                <span key={id} className="bg-black/10 rounded px-2 py-0.5 text-xs font-normal">
                  {names.data?.[id] ?? id}
                </span>
              ))}
            </div>
          )}
        </div>
        {onToggle && !event.completed && (
          <button className={joined ? btnGhost : btn} onClick={onToggle}>
            {joined ? "🔕 Stop participating" : "🔔 Participate"}
          </button>
        )}
      </div>
    </Modal>
  );
}

// --- User-facing page ---

export function EventsPage() {
  const me = useMe();
  const { data, reload } = useAsync<EventData[]>(() => api.events());
  const groups = useAsync(() => api.eventGroups());
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, completion: "upcoming" });
  // Track the id (not the object) so a reload after toggling refreshes the modal.
  const [detailId, setDetailId] = useState<number | null>(null);

  if (!data) return <p className="on-bg-soft">Loading…</p>;
  const joined = (e: EventData) => !!me && e.participantIds.includes(me.userId);
  const toggle = async (e: EventData) => {
    await api.toggleEventParticipation(e.id);
    reload();
  };
  const detail = detailId !== null ? (data.find((e) => e.id === detailId) ?? null) : null;
  const filtered = applyFilters(data, filters);
  const upcoming = [...filtered]
    .filter((e) => e.nextOccurrence !== null)
    .sort((a, b) => a.nextOccurrence! - b.nextOccurrence!);
  const listed = filters.completion === "past" ? filtered : upcoming;

  return (
    <div className="space-y-4">
      <EventFilters value={filters} onChange={setFilters} groups={groups.data ?? []} />
      <EventCalendar events={filtered} onSelect={(e) => setDetailId(e.id)} />
      <div className="space-y-2">
        <div className="comic-title text-2xl">Upcoming</div>
        {listed.map((e) => (
          <div
            key={e.id}
            className={card + " w-full text-left flex items-center gap-3 cursor-pointer"}
            onClick={() => setDetailId(e.id)}
          >
            <span
              className="w-3 h-8 rounded shrink-0 border-2 border-black"
              style={{ backgroundColor: accentHex(e.accentColor) }}
            />
            <span className="flex-1 min-w-0">
              <span className="font-bold block truncate">{e.title}</span>
              <span className="text-ink-soft text-sm">
                {when(e)} · {e.recurrenceLabel}
                {e.channelName ? ` · #${e.channelName}` : ""}
                {e.group ? ` · ${e.group.name}` : ""}
              </span>
            </span>
            <span className="text-ink-soft text-sm shrink-0">🔔 {e.participantIds.length}</span>
            {!e.completed && (
              <button
                className={joined(e) ? btnGhost : btn}
                onClick={(ev) => {
                  ev.stopPropagation();
                  toggle(e);
                }}
              >
                {joined(e) ? "🔕 Leave" : "🔔 Join"}
              </button>
            )}
          </div>
        ))}
        {listed.length === 0 && <p className="on-bg-soft">No events match.</p>}
      </div>
      {detail && (
        <EventDetailModal
          event={detail}
          joined={joined(detail)}
          onToggle={() => toggle(detail)}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// --- Admin editor ---

/** Local <-> unix helpers for datetime-local / date inputs. */
const toLocalInput = (sec: number | null, allDay: boolean): string => {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string): number | null =>
  value ? Math.floor(new Date(value).getTime() / 1000) : null;

interface Draft {
  id?: number;
  title: string;
  description: string;
  imageUrls: string[];
  accentColor: number | null;
  groupId: string;
  channelId: string;
  allDay: boolean;
  start: string;
  end: string;
  recurrence: string;
  recurrenceInterval: number;
  recurrenceUntil: string;
  reminders: number[];
  rewards: { kind: string; roleId: string; amount: number; storeItemId: string }[];
}

const blankDraft = (): Draft => ({
  title: "",
  description: "",
  imageUrls: [],
  accentColor: null,
  groupId: "",
  channelId: "",
  allDay: false,
  start: "",
  end: "",
  recurrence: "none",
  recurrenceInterval: 2,
  recurrenceUntil: "",
  reminders: [1440], // default: one day before
  rewards: [],
});

const toDraft = (e: EventData): Draft => ({
  id: e.id,
  title: e.title,
  description: e.description,
  imageUrls: e.imageUrls,
  accentColor: e.accentColor,
  groupId: e.groupId != null ? String(e.groupId) : "",
  channelId: e.channelId ?? "",
  allDay: !!e.allDay,
  start: toLocalInput(e.startAt, !!e.allDay),
  end: toLocalInput(e.endAt, !!e.allDay),
  recurrence: e.recurrence,
  recurrenceInterval: e.recurrenceInterval,
  recurrenceUntil: toLocalInput(e.recurrenceUntil, true),
  reminders: e.reminders.map((r) => r.offsetMinutes),
  rewards: e.rewards.map((r) => ({
    kind: r.kind,
    roleId: r.roleId ?? "",
    amount: r.amount ?? 100,
    storeItemId: r.storeItemId != null ? String(r.storeItemId) : "",
  })),
});

function draftToBody(d: Draft) {
  return {
    title: d.title,
    description: d.description,
    imageUrls: d.imageUrls.filter((u) => u.trim()),
    accentColor: d.accentColor,
    groupId: d.groupId || null,
    channelId: d.channelId || null,
    allDay: d.allDay,
    startAt: fromLocalInput(d.start),
    endAt: fromLocalInput(d.end),
    recurrence: d.recurrence,
    recurrenceInterval: d.recurrenceInterval,
    recurrenceUntil: fromLocalInput(d.recurrenceUntil),
    reminders: d.reminders,
    rewards: d.rewards.map((r) => ({
      kind: r.kind,
      roleId: r.kind === "role" ? r.roleId : undefined,
      amount: r.kind === "credits" || r.kind === "xp" ? r.amount : undefined,
      storeItemId: r.kind === "store_item" ? Number(r.storeItemId) : undefined,
    })),
  };
}

/** Markdown textarea with a mini toolbar and a live Discord-style preview. */
function MarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const insert = (before: string, after = before) =>
    onChange(value + (value && !value.endsWith("\n") && before.startsWith("#") ? "\n" : "") + before + "text" + after);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1 text-xs">
        <button type="button" className={btnGhost} onClick={() => insert("**")}>B</button>
        <button type="button" className={btnGhost} onClick={() => insert("*")}>I</button>
        <button type="button" className={btnGhost} onClick={() => insert("__")}>U</button>
        <button type="button" className={btnGhost} onClick={() => insert("~~")}>S</button>
        <button type="button" className={btnGhost} onClick={() => insert("## ", "")}>H</button>
        <button type="button" className={btnGhost} onClick={() => insert("- ", "")}>• list</button>
        <button type="button" className={btnGhost} onClick={() => insert("> ", "")}>quote</button>
        <button type="button" className={btnGhost} onClick={() => insert("`")}>code</button>
        <span className="flex-1" />
        <button type="button" className={preview ? btn : btnGhost} onClick={() => setPreview(!preview)}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="bg-[#313338] text-slate-100 rounded p-3 min-h-24">
          <DiscordMarkdown content={value || "*Nothing yet.*"} />
        </div>
      ) : (
        <textarea
          className={input + " min-h-24 font-mono"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Discord-flavored markdown…"
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="text-sm space-y-1 block">
      <span className="text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function EventEditor({
  draft,
  setDraft,
  groups,
  options,
  onSave,
  onCancel,
  error,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  groups: any[];
  options: { channels: any[]; roles: any[]; storeItems: any[] } | null;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  return (
    <div className={card + " space-y-4"}>
      <div className="comic-title text-2xl">{draft.id ? "Edit event" : "New event"}</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Title">
          <input className={input} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Group (optional — pings its roles on creation)">
          <select className={input} value={draft.groupId} onChange={(e) => set({ groupId: e.target.value })}>
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description (markdown — used in the announcement card)">
        <MarkdownEditor value={draft.description} onChange={(v) => set({ description: v })} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Location (text / voice / stage / forum channel)">
          <select className={input} value={draft.channelId} onChange={(e) => set({ channelId: e.target.value })}>
            <option value="">No location</option>
            {(options?.channels ?? []).map((c) => (
              <option key={c.id} value={c.id}>#{c.name} ({c.type})</option>
            ))}
          </select>
        </Field>
        <Field label="Accent color">
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={accentHex(draft.accentColor)}
              onChange={(e) => set({ accentColor: parseInt(e.target.value.slice(1), 16) })}
            />
            <button type="button" className={btnGhost} onClick={() => set({ accentColor: null })}>
              Default
            </button>
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) => set({ allDay: e.target.checked })}
          />
          <span className="text-ink-soft">All-day</span>
        </label>
        <Field label={draft.allDay ? "Start date" : "Start"}>
          <input
            className={input}
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.start}
            onChange={(e) => set({ start: e.target.value })}
          />
        </Field>
        <Field label={draft.allDay ? "End date (optional)" : "End (optional)"}>
          <input
            className={input}
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.end}
            onChange={(e) => set({ end: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Repeats">
          <select className={input} value={draft.recurrence} onChange={(e) => set({ recurrence: e.target.value })}>
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        {draft.recurrence === "custom_days" && (
          <Field label="Every N days">
            <input
              className={input}
              type="number"
              min={1}
              value={draft.recurrenceInterval}
              onChange={(e) => set({ recurrenceInterval: Number(e.target.value) })}
            />
          </Field>
        )}
        {draft.recurrence !== "none" && (
          <Field label="Repeat until (optional)">
            <input
              className={input}
              type="date"
              value={draft.recurrenceUntil}
              onChange={(e) => set({ recurrenceUntil: e.target.value })}
            />
          </Field>
        )}
      </div>

      <div>
        <div className="font-medium text-sm mb-1">Images</div>
        {draft.imageUrls.map((url, i) => (
          <div key={i} className="flex gap-2 mb-1">
            <input
              className={input}
              placeholder="https://…/image.png"
              value={url}
              onChange={(e) =>
                set({ imageUrls: draft.imageUrls.map((u, j) => (j === i ? e.target.value : u)) })
              }
            />
            <button
              className={btnGhost}
              onClick={() => set({ imageUrls: draft.imageUrls.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button className={btnGhost} onClick={() => set({ imageUrls: [...draft.imageUrls, ""] })}>
          + Add image
        </button>
      </div>

      <div>
        <div className="font-medium text-sm mb-1">
          Reminders (minutes before start — channel post + DM to participants)
        </div>
        {draft.reminders.map((m, i) => (
          <div key={i} className="flex gap-2 mb-1 items-center">
            <input
              className={input + " max-w-32"}
              type="number"
              min={0}
              value={m}
              onChange={(e) =>
                set({ reminders: draft.reminders.map((x, j) => (j === i ? Number(e.target.value) : x)) })
              }
            />
            <span className="text-ink-soft text-xs">
              {m >= 1440 ? `${Math.round((m / 1440) * 10) / 10} day(s)` : m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`} before
            </span>
            <button
              className={btnGhost}
              onClick={() => set({ reminders: draft.reminders.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button className={btnGhost} onClick={() => set({ reminders: [...draft.reminders, 60] })}>
          + Add reminder
        </button>
      </div>

      <div>
        <div className="font-medium text-sm mb-1">Rewards (granted to participants when the event ends)</div>
        {draft.rewards.map((r, i) => {
          const setReward = (patch: any) =>
            set({ rewards: draft.rewards.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="flex gap-2 mb-1">
              <select className={input + " max-w-36"} value={r.kind} onChange={(e) => setReward({ kind: e.target.value })}>
                <option value="credits">Social Credits</option>
                <option value="xp">XP</option>
                <option value="role">Role</option>
                <option value="store_item">Store item</option>
              </select>
              {(r.kind === "credits" || r.kind === "xp") && (
                <input
                  className={input + " max-w-32"}
                  type="number"
                  min={1}
                  value={r.amount}
                  onChange={(e) => setReward({ amount: Number(e.target.value) })}
                />
              )}
              {r.kind === "role" && (
                <select className={input} value={r.roleId} onChange={(e) => setReward({ roleId: e.target.value })}>
                  <option value="">Pick a role…</option>
                  {(options?.roles ?? []).map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              )}
              {r.kind === "store_item" && (
                <select className={input} value={r.storeItemId} onChange={(e) => setReward({ storeItemId: e.target.value })}>
                  <option value="">Pick an item…</option>
                  {(options?.storeItems ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.name} ({item.kind})</option>
                  ))}
                </select>
              )}
              <button className={btnGhost} onClick={() => set({ rewards: draft.rewards.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          );
        })}
        <button
          className={btnGhost}
          onClick={() => set({ rewards: [...draft.rewards, { kind: "credits", roleId: "", amount: 100, storeItemId: "" }] })}
        >
          + Add reward
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className={btn} onClick={onSave}>{draft.id ? "Save" : "Create & announce"}</button>
        <button className={btnGhost} onClick={onCancel}>Cancel</button>
        {error && <span className="text-red-700 text-sm font-bold">{error}</span>}
      </div>
    </div>
  );
}

function GroupsManager({ options }: { options: { roles: any[] } | null }) {
  const { data, reload } = useAsync(() => api.eventGroups());
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      if (editing.id) await api.updateEventGroup(editing.id, editing);
      else await api.createEventGroup(editing);
      setEditing(null);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className={card + " space-y-2"}>
      <div className="flex items-center justify-between">
        <div className="font-medium">Event groups</div>
        <button
          className={btnGhost}
          onClick={() => setEditing({ name: "", description: "", mentionRoleIds: [] })}
        >
          + New group
        </button>
      </div>
      {(data ?? []).map((g: any) => (
        <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-t border-black/15 pt-1">
          <div className="min-w-0">
            <span className="font-bold">{g.name}</span>{" "}
            <span className="text-ink-soft">
              {g.description} · pings {g.mentionRoleIds.length} role(s)
            </span>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => setEditing({ ...g })}>Edit</button>
            <button
              className={btnGhost}
              onClick={async () => {
                await api.deleteEventGroup(g.id);
                reload();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      {editing && (
        <Modal title={editing.id ? "Edit group" : "New group"} onClose={() => setEditing(null)}>
          <div className="space-y-3 text-sm">
            <Field label="Name">
              <input className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Description">
              <input className={input} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <Field label="Roles mentioned when a new event is created (hold Ctrl/Cmd to multi-select)">
              <select
                multiple
                className={input + " min-h-28"}
                value={editing.mentionRoleIds}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    mentionRoleIds: [...e.target.selectedOptions].map((o) => o.value),
                  })
                }
              >
                {(options?.roles ?? []).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2 items-center">
              <button className={btn} onClick={save}>Save</button>
              <button className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
              {error && <span className="text-red-700 font-bold">{error}</span>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function EventsEditorPage() {
  const { data, reload } = useAsync<EventData[]>(() => api.events());
  const groups = useAsync(() => api.eventGroups());
  const options = useAsync(() => api.eventOptions());
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const body = draftToBody(draft);
      if (draft.id) await api.updateEvent(draft.id, body);
      else await api.createEvent(body);
      setDraft(null);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (draft) {
    return (
      <EventEditor
        draft={draft}
        setDraft={setDraft}
        groups={groups.data ?? []}
        options={options.data}
        onSave={save}
        onCancel={() => {
          setDraft(null);
          setError(null);
        }}
        error={error}
      />
    );
  }

  const filtered = applyFilters(data ?? [], filters);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button className={btn} onClick={() => setDraft(blankDraft())}>+ New event</button>
      </div>
      <GroupsManager options={options.data} />
      <EventFilters value={filters} onChange={setFilters} groups={groups.data ?? []} />
      <EventCalendar events={filtered} onSelect={(e) => setDraft(toDraft(e))} />
      <div className="space-y-2">
        {filtered.map((e) => (
          <div key={e.id} className={card + " flex flex-wrap items-center gap-3"}>
            <span
              className="w-3 h-8 rounded shrink-0 border-2 border-black"
              style={{ backgroundColor: accentHex(e.accentColor) }}
            />
            <div className="flex-1 min-w-0">
              <div className="font-bold truncate">
                {e.title}{" "}
                {e.completed && <span className="text-ink-soft font-normal text-sm">(ended)</span>}
              </div>
              <div className="text-ink-soft text-sm">
                {when(e)} · {e.recurrenceLabel}
                {e.channelName ? ` · #${e.channelName} (${e.channelType})` : ""}
                {e.group ? ` · ${e.group.name}` : ""} · 🔔 {e.participantIds.length} ·{" "}
                {e.reminders.length} reminder(s) · {e.rewards.length} reward(s)
              </div>
            </div>
            <button className={btnGhost} onClick={() => setDraft(toDraft(e))}>Edit</button>
            <button
              className={btnGhost}
              onClick={async () => {
                if (!confirm(`Delete "${e.title}"?`)) return;
                await api.deleteEvent(e.id);
                reload();
              }}
            >
              Delete
            </button>
          </div>
        ))}
        {filtered.length === 0 && <p className="on-bg-soft">No events match.</p>}
      </div>
    </div>
  );
}
