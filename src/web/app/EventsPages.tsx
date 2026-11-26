/**
 * The events pages of the dashboard: the member-facing calendar and list ({@link EventsPage}) and the
 * president's editor for events, groups, colours and reminders ({@link EventsEditorPage}). Colours that
 * come from event data appear only as swatches, stripes and calendar bars, never as text colour.
 *
 * @module
 */
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { api } from "./api.ts";
import { useAsync } from "./ui.ts";
import { useMe } from "./me-context.ts";
import { DiscordMarkdown } from "./DiscordMarkdown.tsx";
import { Modal } from "./Modal.tsx";
import {
  Calendar,
  ColourField,
  Chip,
  DateTimeField,
  Empty,
  ErrorLine,
  Heading,
  ImageFrame,
  InkButton,
  Segmented,
  Loading,
  PromptField,
  Select,
  SettingRow,
  TextArea,
  Toggle,
  Swatch,
  Window,
  formatDateTimeInput,
  cx,
  formatDay,
  normaliseHex,
  parseDateTimeInput,
  timeZoneName,
  useConfirm,
  type CalendarEvent,
  type SelectOption,
  type SelectProps,
} from "./ui/index.ts";

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

/**
 * The default accent (pine `0x31748f`, decision D-020), never Discord blurple. It only backs
 * {@link accentHex}: an event with no accent is drawn with the iris token (see {@link accentColour} and
 * the calendar), because text on pine bars fails contrast, so pine is never used as a bar colour.
 */
const DEFAULT_ACCENT = 0x31748f;

/** An accent as `#rrggbb`. The default pine when the event has none. */
const accentHex = (accent: number | null) =>
  "#" + (accent ?? DEFAULT_ACCENT).toString(16).padStart(6, "0");

/**
 * The colour a swatch, stripe or calendar bar uses for an event: its own accent, or the iris token when
 * it has none.
 */
const accentColour = (accent: number | null): string =>
  accent != null ? accentHex(accent) : "var(--color-iris)";

/** A small helper for a lowercase `HH:mm` clock time in the viewer's zone. */
const clock = (d: Date) => formatDateTimeInput(d).slice(11);

// --- Small form helpers ---

const DESK = "(min-width: 721px)";

/**
 * The prompt width to give a field: `ch` on desk widths, `undefined` on phones. The system's shared prompt
 * width lets the prompt shrink below its text on a narrow screen and overlap the value, so phones keep
 * each prompt at its natural width instead.
 */
function usePromptWidth(ch: number): number | undefined {
  return useDesk() ? ch : undefined;
}

/** True at desk widths (721px and up); the server render is desk. */
function useDesk(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(DESK);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(DESK).matches,
    () => true,
  );
}

/**
 * A {@link Select} as a settings row: the name on the left, the control on the right, with the name wired
 * to the control for assistive tech.
 */
function SelectRow<T extends string | number>({
  label,
  description,
  ...select
}: { label: string; description?: ReactNode } & Omit<SelectProps<T>, "ariaLabel" | "ariaLabelledBy">) {
  const id = useId();
  return (
    <SettingRow label={label} labelId={id} description={description}>
      <Select {...select} ariaLabelledBy={id} />
    </SettingRow>
  );
}

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

/**
 * A filter day typed as `YYYY-MM-DD`. The filter state keeps the same `yyyy-mm-dd` string the old
 * `<input type="date">` produced, so {@link applyFilters} reads it unchanged.
 */
function DayFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
}) {
  const parsed = parseDateTimeInput(value, true);
  const pw = usePromptWidth(19);
  return (
    <DateTimeField
      label={label}
      dateOnly
      value={parsed.ok ? parsed.date : null}
      onChange={(d) => onChange(d ? formatDateTimeInput(d, true) : "")}
      hint="year-month-day, optional."
      promptWidth={pw}
    />
  );
}

/** The filter window shared by the member page and the editor. */
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
  const pw = usePromptWidth(19);
  const groupOptions: SelectOption<string>[] = [
    { value: "", label: "all groups" },
    ...groups.map((g) => ({ value: String(g.id), label: g.name as string })),
  ];
  const completionOptions: SelectOption<Filters["completion"]>[] = [
    { value: "all", label: "past and upcoming" },
    { value: "upcoming", label: "upcoming only" },
    { value: "past", label: "past only" },
  ];
  const typeOptions: SelectOption<string>[] = [
    { value: "", label: "any" },
    ...CHANNEL_TYPES.map((t) => ({ value: t, label: t })),
  ];
  return (
    <Window label="grep: ~/events" foot={<span>narrows the calendar and the list</span>}>
      <div className="grid grid-cols-1 gap-x-8 desk:grid-cols-2">
        <div>
          <PromptField label="title" value={value.q} onChange={(q) => set({ q })} placeholder="search" promptWidth={pw} />
          <PromptField
            label="channel"
            value={value.channel}
            onChange={(channel) => set({ channel })}
            placeholder="channel name"
            promptWidth={pw}
          />
          <DayFilter label="from" value={value.from} onChange={(from) => set({ from })} />
          <DayFilter label="to" value={value.to} onChange={(to) => set({ to })} />
        </div>
        <div>
          <SelectRow label="group" options={groupOptions} value={value.groupId} onChange={(groupId) => set({ groupId })} />
          <SelectRow
            label="when"
            options={completionOptions}
            value={value.completion}
            onChange={(completion) => set({ completion })}
          />
          <SelectRow
            label="channel type"
            options={typeOptions}
            value={value.channelType}
            onChange={(channelType) => set({ channelType })}
          />
          <div className="btns">
            <InkButton tone="muted" onClick={() => onChange(emptyFilters)}>
              clear
            </InkButton>
          </div>
        </div>
      </div>
    </Window>
  );
}

// --- Calendar ---

/**
 * The month calendar window of both events pages. Each event shows on every day it occurs in the visible
 * month (once per day), as a bar in its accent colour; a day with more than three shows `+N more`, which
 * opens that day's events in a dialog. Phones get the calendar's list view.
 *
 * @param props.events - The events to place, already filtered.
 * @param props.onSelect - Called with the event that was chosen.
 */
export function EventCalendar({
  events,
  onSelect,
}: {
  events: EventData[];
  onSelect?: (e: EventData) => void;
}) {
  const [month, setMonth] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [dayOpen, setDayOpen] = useState<Date | null>(null);

  const { items, byId } = useMemo(() => {
    const items: CalendarEvent[] = [];
    const seen = new Set<string>();
    for (const e of events) {
      for (const at of e.occurrences.length ? e.occurrences : [e.startAt]) {
        const d = new Date(at * 1000);
        const key = `${formatDateTimeInput(d, true)}#${e.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ id: e.id, title: e.title, colour: e.accentColor != null ? accentHex(e.accentColor) : null, date: d });
      }
    }
    return { items, byId: new Map(events.map((e) => [String(e.id), e])) };
  }, [events]);

  const choose = (id: CalendarEvent["id"]) => {
    const e = byId.get(String(id));
    if (e) onSelect?.(e);
  };
  const dayKey = dayOpen ? formatDateTimeInput(dayOpen, true) : "";
  const dayItems = dayOpen ? items.filter((i) => formatDateTimeInput(i.date, true) === dayKey) : [];

  return (
    <Window label="cal: ~/events" foot={<span>times in {timeZoneName()}</span>}>
      <Calendar month={month} events={items} onSelect={choose} onSelectDay={setDayOpen} onMonthChange={setMonth} />
      {dayOpen && (
        <Modal title={formatDay(dayOpen)} label={`ls: ~/events/${dayKey}`} onClose={() => setDayOpen(null)}>
          <div className="list">
            {dayItems.map((i) => (
              <button
                key={i.id}
                type="button"
                className="li"
                onClick={() => {
                  setDayOpen(null);
                  choose(i.id);
                }}
              >
                <Swatch colour={i.colour ?? "var(--color-iris)"} />
                <span className="grow">{i.title}</span>
                <span className="meta">{clock(i.date)}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </Window>
  );
}

// --- Shared event summary bits ---

/** When an event next happens (or started), as copy: `4 Nov 2026 20:00 Budapest`, or `4 Nov 2026 (all day)`. */
function when(e: EventData): string {
  const at = e.nextOccurrence ?? e.startAt;
  const d = new Date(at * 1000);
  return e.allDay ? `${formatDay(d)} (all day)` : `${formatDay(d)} ${clock(d)} ${timeZoneName()}`;
}

/** The one-line summary under an event title: when, repeat, channel, group. */
function summary(e: EventData, withChannelType = false): string {
  return (
    `${when(e)} · ${e.recurrenceLabel}` +
    (e.channelName ? ` · #${e.channelName}${withChannelType ? ` (${e.channelType})` : ""}` : "") +
    (e.group ? ` · ${e.group.name}` : "")
  );
}

/**
 * The detail dialog of one event: images in full colour, the description as Discord shows it, when and
 * where, who takes part, and (when allowed) a join or leave button.
 */
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
    <Modal title={event.title} label={`cat: ~/events/${event.id}`} onClose={onClose} wide>
      {event.imageUrls.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          {event.imageUrls.map((url) => (
            <ImageFrame key={url} src={url} alt="" size={128} />
          ))}
        </div>
      )}
      {event.description && (
        <div className="mx-2 mb-2 flex items-stretch gap-2">
          <span className="stripe" style={{ "--sw": accentColour(event.accentColor) } as CSSProperties} aria-hidden="true" />
          <div className="min-w-0 grow border border-ink-muted bg-base p-2">
            <DiscordMarkdown content={event.description} />
          </div>
        </div>
      )}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-2">
        <span className="text-subtle">when</span>
        <span>
          {when(event)} · {event.recurrenceLabel}
        </span>
        {event.channelName && (
          <>
            <span className="text-subtle">where</span>
            <span>
              #{event.channelName} ({event.channelType})
            </span>
          </>
        )}
        {event.group && (
          <>
            <span className="text-subtle">group</span>
            <span>{event.group.name}</span>
          </>
        )}
        <span className="text-subtle">colour</span>
        <span>
          <Swatch colour={accentColour(event.accentColor)} label="event colour" />
        </span>
      </div>
      {event.completed && (
        <p className="nar px-2 pt-2">
          <span className="c6">✓</span> This event has ended.
        </p>
      )}
      <Heading>
        {ids.length} {ids.length === 1 ? "participant" : "participants"}
      </Heading>
      {ids.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-2">
          {ids.map((id) => (
            <Chip key={id}>{names.data?.[id] ?? id}</Chip>
          ))}
        </div>
      ) : (
        <p className="nar px-2">Nobody has joined yet. The room is empty.</p>
      )}
      {onToggle && !event.completed && (
        <div className="btns">
          <InkButton tone={joined ? "muted" : "gold"} onClick={onToggle}>
            {joined ? "leave" : "join"}
          </InkButton>
        </div>
      )}
    </Modal>
  );
}

// --- User-facing page ---

/**
 * The member-facing events page: filters, the month calendar, the upcoming list and each event's detail
 * dialog. Every member can join or leave an event that has not ended.
 */
export function EventsPage() {
  const me = useMe();
  const { data, error, reload } = useAsync<EventData[]>(() => api.events());
  const groups = useAsync(() => api.eventGroups());
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, completion: "upcoming" });
  // Track the id (not the object) so a reload after toggling refreshes the modal.
  const [detailId, setDetailId] = useState<number | null>(null);
  // The month calendar on desk widths and the upcoming list on phones, until the viewer picks one.
  const desk = useDesk();
  const [picked, setPicked] = useState<"month" | "list" | null>(null);
  const view = picked ?? (desk ? "month" : "list");

  if (!data) {
    return error ? <ErrorLine>{error}</ErrorLine> : <Loading>Looking at the calendar</Loading>;
  }
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
    <div className="space-y-6">
      <EventFilters value={filters} onChange={setFilters} groups={groups.data ?? []} />
      <div className="flex flex-wrap items-center gap-3 px-1">
        <Segmented
          ariaLabel="events view"
          value={view}
          onChange={setPicked}
          options={[
            { value: "month", label: "month" },
            { value: "list", label: "list" },
          ]}
        />
      </div>
      {view === "month" && <EventCalendar events={filtered} onSelect={(e) => setDetailId(e.id)} />}
      {view === "list" && (
      <Window label={`ls: ~/events/${filters.completion === "past" ? "past" : "upcoming"}`}>
        {listed.map((e) => (
          <div key={e.id} className="flex items-stretch gap-3 px-2 py-1">
            <span className="stripe" style={{ "--sw": accentColour(e.accentColor) } as CSSProperties} aria-hidden="true" />
            <button type="button" className="li min-w-0 grow" onClick={() => setDetailId(e.id)}>
              <span className="block min-w-0 flex-auto">
                <span className="block truncate">{e.title}</span>
                <span className="cap m-0 block">{summary(e)}</span>
              </span>
              <span className="meta">{e.participantIds.length} joined</span>
            </button>
            {!e.completed && (
              <InkButton className="self-center" tone={joined(e) ? "muted" : "foam"} onClick={() => toggle(e)}>
                {joined(e) ? "leave" : "join"}
              </InkButton>
            )}
          </div>
        ))}
        {listed.length === 0 && <Empty>Nothing matches. The calendar is quiet.</Empty>}
      </Window>
      )}
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

/** Width of the prompts in the editor's windows, in `ch`: `@ asuka » ` plus the longest label. */
const PW = 24;

/**
 * A stored time as the typed field's value, cut to the minute like the old `datetime-local` input did.
 * Empty (0 or null) stays `null`.
 */
const toDate = (sec: number | null): Date | null => {
  if (!sec) return null;
  const d = new Date(sec * 1000);
  d.setSeconds(0, 0);
  return d;
};

/**
 * A typed date as the unix seconds the API takes. A date-only value goes out as midnight UTC of the typed
 * day, which is exactly what `new Date("yyyy-mm-dd")` gave for the old `<input type="date">`; a date and
 * time goes out as the local moment typed, as `datetime-local` did.
 *
 * @param d - The typed date (local time), or null for an empty field.
 * @param dayOnly - The field holds a day, not a moment (all-day events, repeat-until).
 */
const fromDate = (d: Date | null, dayOnly: boolean): number | null => {
  if (!d) return null;
  const ms = dayOnly ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) : d.getTime();
  return Math.floor(ms / 1000);
};

interface Draft {
  id?: number;
  title: string;
  description: string;
  imageUrls: string[];
  accentColor: number | null;
  groupId: string;
  channelId: string;
  allDay: boolean;
  start: Date | null;
  end: Date | null;
  recurrence: string;
  recurrenceInterval: number;
  recurrenceUntil: Date | null;
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
  start: null,
  end: null,
  recurrence: "none",
  recurrenceInterval: 2,
  recurrenceUntil: null,
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
  start: toDate(e.startAt),
  end: toDate(e.endAt),
  recurrence: e.recurrence,
  recurrenceInterval: e.recurrenceInterval,
  recurrenceUntil: toDate(e.recurrenceUntil),
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
    startAt: fromDate(d.start, d.allDay),
    endAt: fromDate(d.end, d.allDay),
    recurrence: d.recurrence,
    recurrenceInterval: d.recurrenceInterval,
    recurrenceUntil: fromDate(d.recurrenceUntil, true),
    reminders: d.reminders,
    rewards: d.rewards.map((r) => ({
      kind: r.kind,
      roleId: r.kind === "role" ? r.roleId : undefined,
      amount: r.kind === "credits" || r.kind === "xp" ? r.amount : undefined,
      storeItemId: r.kind === "store_item" ? Number(r.storeItemId) : undefined,
    })),
  };
}

/** `3 reminders`, `1 reward`: a count with its noun. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** How long before the start a reminder fires, in words. */
function beforeText(m: number): string {
  if (m >= 1440) return count(Math.round((m / 1440) * 10) / 10, "day");
  if (m >= 60) return `${Math.round((m / 60) * 10) / 10} h`;
  return `${m} min`;
}

/**
 * A typed date or date and time (`YYYY-MM-DD HH:mm`) that also reports whether what is typed right now is
 * a real date. {@link DateTimeField} only calls `onChange` for valid text, so a half-typed date would
 * leave the old value in the draft; the editor uses the report to hold the save back instead.
 *
 * @param props.onValidity - Called with false while the text is not a real date, true otherwise.
 */
function TypedDate({
  label,
  value,
  onChange,
  dateOnly,
  optional,
  onValidity,
}: {
  label: string;
  value: Date | null;
  onChange: (d: Date | null) => void;
  dateOnly?: boolean;
  optional?: boolean;
  onValidity: (ok: boolean) => void;
}) {
  const pw = usePromptWidth(PW);
  // switching between a day and a moment rewrites the text, so any earlier complaint is void
  useEffect(() => onValidity(true), [dateOnly]);
  const format = dateOnly
    ? "year-month-day, like 2026-11-28."
    : `year-month-day hour:minute, your time zone (${timeZoneName()}).`;
  return (
    <div onInput={(e) => onValidity(parseDateTimeInput((e.target as HTMLInputElement).value, dateOnly).ok)}>
      <DateTimeField
        label={label}
        value={value}
        onChange={onChange}
        dateOnly={dateOnly}
        required={!optional}
        hint={optional ? `${format} Optional.` : format}
        promptWidth={pw}
      />
    </div>
  );
}

/** The palette hues offered under the accent field. Pine is left out: bar text on pine is unreadable. */
const ACCENT_PRESETS = ["foam", "gold", "love", "iris", "rose"] as const;

/**
 * The event accent: a typed `#rrggbb` with a live swatch ({@link ColourField}) and one-click palette
 * presets. Empty means "no accent", which the API stores as null and the calendar draws in iris.
 *
 * @param props.value - The accent as the integer the API uses, or null.
 * @param props.onChange - Called with the new accent integer, or null when the field is emptied.
 */
function AccentField({ value, onChange }: { value: number | null; onChange: (accent: number | null) => void }) {
  const [tokens, setTokens] = useState<Record<string, string | null>>({});
  const pw = usePromptWidth(PW);
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setTokens(Object.fromEntries(ACCENT_PRESETS.map((p) => [p, normaliseHex(cs.getPropertyValue(`--color-${p}`))])));
  }, []);
  const hex = value != null ? accentHex(value) : "";
  return (
    <>
      <ColourField
        label="accent colour"
        value={hex}
        allowEmpty
        presets={false}
        promptWidth={pw}
        hint="Palette colours, or any #rrggbb. Empty keeps the default."
        onChange={(h) => onChange(h ? parseInt(h.slice(1), 16) : null)}
      />
      <div className="swatches" role="group" aria-label="palette colours">
        {ACCENT_PRESETS.map((p) => {
          const tokenHex = tokens[p];
          if (!tokenHex) return null;
          const on = hex === tokenHex;
          return (
            <button
              key={p}
              type="button"
              className={cx("swatch", on && "on")}
              style={{ "--sw": `var(--color-${p})` } as CSSProperties}
              aria-label={p}
              aria-pressed={on}
              onClick={() => onChange(parseInt(tokenHex.slice(1), 16))}
            />
          );
        })}
      </div>
    </>
  );
}

/** A Discord-flavoured markdown box: description box with a mini toolbar and a live preview. */
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
  const tool = (label: string, title: string, before: string, after?: string) => (
    <InkButton tone="flat" aria-label={title} title={title} onClick={() => insert(before, after)}>
      {label}
    </InkButton>
  );
  return (
    <div>
      <Heading>description</Heading>
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
        {tool("B", "bold", "**")}
        {tool("I", "italic", "*")}
        {tool("U", "underline", "__")}
        {tool("S", "strikethrough", "~~")}
        {tool("H", "heading", "## ", "")}
        {tool("list", "list", "- ", "")}
        {tool("quote", "quote", "> ", "")}
        {tool("code", "code", "`")}
        <span className="flex-auto" />
        <InkButton tone="flat" on={preview} onClick={() => setPreview(!preview)}>
          {preview ? "edit" : "preview"}
        </InkButton>
      </div>
      {preview ? (
        <div className="mx-2 min-h-24 border border-ink-muted bg-base p-2">
          <DiscordMarkdown content={value || "*Nothing yet.*"} />
        </div>
      ) : (
        <TextArea
          ariaLabel="description"
          value={value}
          onChange={onChange}
          rows={6}
          mono
          placeholder="discord-flavoured markdown"
          hint="markdown, used in the announcement card"
        />
      )}
    </div>
  );
}

/**
 * The full-page editor for one event, as labelled windows: details, when, images, reminders, rewards and
 * the save line. Nothing is sent until the gold button is pressed.
 */
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
  const pw = usePromptWidth(PW);
  // which typed dates currently hold text that is not a real date
  const [badDates, setBadDates] = useState<Record<string, boolean>>({});
  const [blocked, setBlocked] = useState(false);
  const mark = (key: string) => (ok: boolean) =>
    setBadDates((prev) => (prev[key] === !ok ? prev : { ...prev, [key]: !ok }));
  const save = () => {
    if (Object.values(badDates).some(Boolean)) return setBlocked(true);
    setBlocked(false);
    onSave();
  };
  const anyBad = Object.values(badDates).some(Boolean);

  const groupOptions: SelectOption<string>[] = [
    { value: "", label: "no group" },
    ...groups.map((g) => ({ value: String(g.id), label: g.name as string })),
  ];
  const channelOptions: SelectOption<string>[] = [
    { value: "", label: "no location" },
    ...(options?.channels ?? []).map((c) => ({ value: c.id as string, label: `#${c.name} (${c.type})` })),
  ];
  const kindOptions: SelectOption<string>[] = [
    { value: "credits", label: "social credits" },
    { value: "xp", label: "xp" },
    { value: "role", label: "role" },
    { value: "store_item", label: "store item" },
  ];
  const roleOptions: SelectOption<string>[] = (options?.roles ?? []).map((r) => ({ value: r.id as string, label: r.name as string }));
  const itemOptions: SelectOption<string>[] = (options?.storeItems ?? []).map((i) => ({
    value: String(i.id),
    label: `${i.name} (${i.kind})`,
  }));
  const recurrenceOptions: SelectOption<string>[] = RECURRENCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  const name = draft.id ? `~/events/${draft.id}` : "~/events/new";

  return (
    <div className="space-y-6">
      <Window label={`vim: ${name}`}>
        <PromptField label="title" value={draft.title} onChange={(title) => set({ title })} promptWidth={pw} />
        <SelectRow
          label="group"
          description="Optional. Its roles are pinged when the event is created."
          options={groupOptions}
          value={draft.groupId}
          onChange={(groupId) => set({ groupId })}
        />
        <SelectRow
          label="location"
          description="A text, voice, stage or forum channel."
          options={channelOptions}
          value={draft.channelId}
          onChange={(channelId) => set({ channelId })}
        />
        <MarkdownEditor value={draft.description} onChange={(description) => set({ description })} />
        <Heading>accent</Heading>
        <AccentField value={draft.accentColor} onChange={(accentColor) => set({ accentColor })} />
      </Window>

      <Window label={`cal: ${name}`}>
        <Toggle label="all day" checked={draft.allDay} onChange={(allDay) => set({ allDay })} />
        <TypedDate
          label={draft.allDay ? "start date" : "starts"}
          dateOnly={draft.allDay}
          value={draft.start}
          onChange={(start) => set({ start })}
          onValidity={mark("start")}
        />
        <TypedDate
          label={draft.allDay ? "end date" : "ends"}
          dateOnly={draft.allDay}
          optional
          value={draft.end}
          onChange={(end) => set({ end })}
          onValidity={mark("end")}
        />
        <SelectRow
          label="repeats"
          options={recurrenceOptions}
          value={draft.recurrence}
          onChange={(recurrence) => set({ recurrence })}
        />
        {draft.recurrence === "custom_days" && (
          <PromptField
            label="every n days"
            type="number"
            min={1}
            promptWidth={pw}
            value={String(draft.recurrenceInterval)}
            onChange={(v) => set({ recurrenceInterval: Number(v) })}
          />
        )}
        {draft.recurrence !== "none" && (
          <TypedDate
            label="repeat until"
            dateOnly
            optional
            value={draft.recurrenceUntil}
            onChange={(recurrenceUntil) => set({ recurrenceUntil })}
            onValidity={mark("until")}
          />
        )}
      </Window>

      <Window label={`ls: ${name}/images`}>
        {draft.imageUrls.length === 0 && <Empty>No images. The announcement goes out plain.</Empty>}
        {draft.imageUrls.map((url, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-auto">
              <PromptField
                label={`image ${i + 1}`}
                promptWidth={pw}
                placeholder="https://…/image.png"
                value={url}
                trailing={/^https?:\/\//.test(url.trim()) ? <ImageFrame src={url.trim()} alt="" size={24} /> : undefined}
                onChange={(v) => set({ imageUrls: draft.imageUrls.map((u, j) => (j === i ? v : u)) })}
              />
            </div>
            <InkButton
              tone="flat"
              aria-label={`remove image ${i + 1}`}
              onClick={() => set({ imageUrls: draft.imageUrls.filter((_, j) => j !== i) })}
            >
              ×
            </InkButton>
          </div>
        ))}
        <div className="btns">
          <InkButton tone="muted" onClick={() => set({ imageUrls: [...draft.imageUrls, ""] })}>
            add image
          </InkButton>
        </div>
      </Window>

      <Window label={`at: ${name}/reminders`} foot={<span>minutes before the start; each posts in the channel and DMs the participants</span>}>
        {draft.reminders.length === 0 && <Empty>No reminders. Nobody is nudged before it starts.</Empty>}
        {draft.reminders.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-auto">
              <PromptField
                label={`reminder ${i + 1}`}
                type="number"
                min={0}
                promptWidth={pw}
                value={String(m)}
                hint={`${beforeText(m)} before`}
                onChange={(v) => set({ reminders: draft.reminders.map((x, j) => (j === i ? Number(v) : x)) })}
              />
            </div>
            <InkButton
              tone="flat"
              aria-label={`remove reminder ${i + 1}`}
              onClick={() => set({ reminders: draft.reminders.filter((_, j) => j !== i) })}
            >
              ×
            </InkButton>
          </div>
        ))}
        <div className="btns">
          <InkButton tone="muted" onClick={() => set({ reminders: [...draft.reminders, 60] })}>
            add reminder
          </InkButton>
        </div>
      </Window>

      <Window label={`ls: ${name}/rewards`} foot={<span>granted to participants when the event ends</span>}>
        {draft.rewards.length === 0 && <Empty>No rewards. Taking part is its own reward.</Empty>}
        {draft.rewards.map((r, i) => {
          const setReward = (patch: any) =>
            set({ rewards: draft.rewards.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="flex flex-wrap items-center gap-x-3 px-2 py-1">
              <Select
                ariaLabel={`reward ${i + 1} kind`}
                options={kindOptions}
                value={r.kind}
                onChange={(kind) => setReward({ kind })}
              />
              {(r.kind === "credits" || r.kind === "xp") && (
                <div className="min-w-[28ch] flex-1">
                  <PromptField
                    label="amount"
                    type="number"
                    min={1}
                    value={String(r.amount)}
                    onChange={(v) => setReward({ amount: Number(v) })}
                  />
                </div>
              )}
              {r.kind === "role" && (
                <Select
                  ariaLabel={`reward ${i + 1} role`}
                  placeholder="pick a role"
                  options={roleOptions}
                  value={r.roleId || null}
                  onChange={(roleId) => setReward({ roleId })}
                />
              )}
              {r.kind === "store_item" && (
                <Select
                  ariaLabel={`reward ${i + 1} item`}
                  placeholder="pick an item"
                  options={itemOptions}
                  value={r.storeItemId || null}
                  onChange={(storeItemId) => setReward({ storeItemId })}
                />
              )}
              <span className="flex-auto" />
              <InkButton
                tone="flat"
                aria-label={`remove reward ${i + 1}`}
                onClick={() => set({ rewards: draft.rewards.filter((_, j) => j !== i) })}
              >
                ×
              </InkButton>
            </div>
          );
        })}
        <div className="btns">
          <InkButton
            tone="muted"
            onClick={() => set({ rewards: [...draft.rewards, { kind: "credits", roleId: "", amount: 100, storeItemId: "" }] })}
          >
            add reward
          </InkButton>
        </div>
      </Window>

      <Window label={`fish: ${name}/write`} tone={error || blocked ? "love" : "pine"}>
        {blocked && anyBad && <ErrorLine>One of the dates is not a real date. Fix it before saving.</ErrorLine>}
        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="btns">
          <InkButton tone="gold" onClick={save}>
            {draft.id ? "save" : "create and announce"}
          </InkButton>
          <InkButton tone="muted" onClick={onCancel}>
            cancel
          </InkButton>
        </div>
      </Window>
    </div>
  );
}

/**
 * The event groups window of the editor: list, create, edit and delete. A group names the roles that are
 * pinged when one of its events is created.
 */
function GroupsManager({ options }: { options: { roles: any[] } | null }) {
  const { data, reload } = useAsync(() => api.eventGroups());
  const [editing, setEditing] = useState<any | null>(null);
  const pw = usePromptWidth(18);
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
  const close = () => {
    setEditing(null);
    setError(null);
  };
  const toggleRole = (id: string, on: boolean) =>
    setEditing({
      ...editing,
      mentionRoleIds: on ? [...editing.mentionRoleIds, id] : editing.mentionRoleIds.filter((r: string) => r !== id),
    });

  return (
    <Window label="ls: ~/events/groups" foot={<span>a group pings its roles when an event is created</span>}>
      {data === null && <Loading>Fetching the groups</Loading>}
      {data && data.length === 0 && <Empty>No groups yet. Events go out without a ping.</Empty>}
      {(data ?? []).map((g: any) => (
        <div key={g.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-ink-hairline px-2 py-1 first:border-t-0">
          <div className="min-w-0 flex-auto">
            <span>{g.name}</span>{" "}
            <span className="text-subtle">
              {g.description} · pings {count(g.mentionRoleIds.length, "role")}
            </span>
          </div>
          <div className="flex gap-2">
            <InkButton tone="flat" onClick={() => setEditing({ ...g })}>
              edit
            </InkButton>
            <InkButton
              tone="love"
              onClick={async () => {
                await api.deleteEventGroup(g.id);
                reload();
              }}
            >
              delete
            </InkButton>
          </div>
        </div>
      ))}
      <div className="btns">
        <InkButton tone="muted" onClick={() => setEditing({ name: "", description: "", mentionRoleIds: [] })}>
          new group
        </InkButton>
      </div>
      {editing && (
        <Modal
          title={editing.id ? "edit group" : "new group"}
          label={`vim: ~/events/groups/${editing.id ?? "new"}`}
          onClose={close}
          onSubmit={save}
        >
          <PromptField label="name" promptWidth={pw} value={editing.name} onChange={(name) => setEditing({ ...editing, name })} />
          <PromptField
            label="description"
            promptWidth={pw}
            value={editing.description}
            onChange={(description) => setEditing({ ...editing, description })}
          />
          <Heading>roles mentioned when a new event is created</Heading>
          <div className="flex flex-wrap gap-2 px-2">
            {(options?.roles ?? []).map((r) => (
              <Chip key={r.id} on={editing.mentionRoleIds.includes(r.id)} onToggle={(on) => toggleRole(r.id, on)}>
                {r.name}
              </Chip>
            ))}
            {(options?.roles ?? []).length === 0 && <Empty>No roles to pick from.</Empty>}
          </div>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="btns">
            <InkButton tone="gold" onClick={save}>
              save
            </InkButton>
            <InkButton tone="muted" onClick={close}>
              cancel
            </InkButton>
          </div>
        </Modal>
      )}
    </Window>
  );
}

/**
 * The president's events editor: write a new event, manage groups, filter, and edit or delete any event
 * from the calendar or the list. Choosing an event opens the full-page {@link EventEditor}.
 */
export function EventsEditorPage() {
  const { data, error: loadError, reload } = useAsync<EventData[]>(() => api.events());
  const groups = useAsync(() => api.eventGroups());
  const options = useAsync(() => api.eventOptions());
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

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
    <div className="space-y-6">
      <Window label="vim: ~/events/new">
        <p className="nar px-2">Write an event here. It is announced to the channel the moment you create it.</p>
        <div className="btns">
          <InkButton tone="gold" onClick={() => setDraft(blankDraft())}>
            new event
          </InkButton>
        </div>
      </Window>
      <GroupsManager options={options.data} />
      <EventFilters value={filters} onChange={setFilters} groups={groups.data ?? []} />
      <EventCalendar events={filtered} onSelect={(e) => setDraft(toDraft(e))} />
      <Window label="ls: ~/events/all">
        {data === null && (loadError ? <ErrorLine>{loadError}</ErrorLine> : <Loading>Fetching the events</Loading>)}
        {filtered.map((e) => (
          <div key={e.id} className="flex flex-col gap-1 px-2 py-1 min-[721px]:flex-row min-[721px]:items-stretch min-[721px]:gap-3">
            <div className="flex min-w-0 flex-auto items-stretch gap-3">
            <span className="stripe" style={{ "--sw": accentColour(e.accentColor) } as CSSProperties} aria-hidden="true" />
            <div className="min-w-0 flex-auto">
              <div className="truncate">
                {e.title} {e.completed && <Chip>ended</Chip>}
              </div>
              <div className="cap m-0">
                {summary(e, true)} · {e.participantIds.length} joined · {count(e.reminders.length, "reminder")} ·{" "}
                {count(e.rewards.length, "reward")}
              </div>
            </div>
            </div>
            <div className="flex items-center gap-2 min-[721px]:ml-auto">
              <InkButton tone="flat" onClick={() => setDraft(toDraft(e))}>
                edit
              </InkButton>
              <InkButton
                tone="love"
                onClick={async () => {
                  if (
                    !(await confirm({
                      label: "confirm: ~/events/delete",
                      title: "delete event",
                      message: `Delete "${e.title}"? It is gone for good.`,
                      confirmLabel: "delete",
                    }))
                  )
                    return;
                  await api.deleteEvent(e.id);
                  reload();
                }}
              >
                delete
              </InkButton>
            </div>
          </div>
        ))}
        {data && filtered.length === 0 && <Empty>Nothing matches. The calendar is quiet.</Empty>}
      </Window>
      {dialog}
    </div>
  );
}
