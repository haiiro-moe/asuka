import { api } from "./api.ts";
import { card, useAsync } from "./ui.ts";

const fmtDate = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

function StatRow({ name, value }: { name: string; value: string | number }) {
  return (
    <div className="flex justify-between font-bold">
      <span>{name}</span>
      <span>{value}</span>
    </div>
  );
}

/** Chunky black-bordered progress bar, same look as the PNG cards' XP bar. */
function ComicBar({ pct }: { pct: number }) {
  return (
    <div
      className="h-7 rounded-full border-4 border-black overflow-hidden"
      style={{ backgroundColor: "#e8e0cc" }}
    >
      <div
        className="h-full"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          backgroundImage: "linear-gradient(90deg, #ffd23f, #ff6b35)",
        }}
      />
    </div>
  );
}

/**
 * HTML rendition of the /profile PNG card, plus live Discord roles.
 * `children` (e.g. the own-profile inventory) render between the XP and
 * roles cards.
 */
export function MemberProfilePage({
  userId,
  children,
}: {
  userId: string;
  children?: React.ReactNode;
}) {
  const { data, error } = useAsync<any>(() => api.memberProfile(userId), [userId]);

  if (error) return <div className={card + " font-bold"}>Member not found.</div>;
  if (!data) return <p className="on-bg">Loading…</p>;

  const pct = data.xpNeeded > 0 ? (data.xpCurrent / data.xpNeeded) * 100 : 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className={card + " flex flex-wrap items-center gap-4 sm:gap-5 p-5"}>
        {data.avatarUrl && (
          <img
            src={data.avatarUrl}
            alt=""
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-4 border-black shadow-[4px_4px_0_rgba(0,0,0,0.55)] object-cover shrink-0"
          />
        )}
        <div className="min-w-0">
          <div className="comic-title text-4xl sm:text-5xl break-words">{data.displayName}</div>
          <div className="comic-title text-xl sm:text-2xl" style={{ color: "#ff6b35" }}>
            LEVEL {data.level} · RANK #{data.rank || "—"}
          </div>
          {!data.inGuild && (
            <div className="text-ink-soft text-sm font-bold mt-1">No longer in the server.</div>
          )}
        </div>
      </div>

      <div className={card + " space-y-2"}>
        <StatRow name="Social Credits" value={data.credits.toLocaleString()} />
        <StatRow name="XP" value={data.xp.toLocaleString()} />
        <ComicBar pct={pct} />
        <div className="text-sm font-bold">
          {data.xpCurrent}/{data.xpNeeded} XP to level {data.level + 1}
        </div>
        <StatRow name="Messages" value={data.messageCount.toLocaleString()} />
        {data.guildJoinedAt && <StatRow name="Joined server" value={fmtDate(data.guildJoinedAt)} />}
      </div>

      {children}

      <div className={card}>
        <div className="comic-title text-2xl mb-2">ROLES</div>
        <div className="flex flex-wrap gap-2">
          {data.roles.map((r: any) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border-2 border-black bg-white text-sm font-bold"
            >
              <span
                className="w-3 h-3 rounded-full border border-black shrink-0"
                style={{ backgroundColor: r.color ?? "#99aab5" }}
              />
              {r.name}
            </span>
          ))}
          {data.roles.length === 0 && (
            <span className="text-ink-soft font-bold text-sm">No roles.</span>
          )}
        </div>
      </div>

      <div className={card}>
        <div className="comic-title text-2xl mb-1" style={{ color: "#ff6b35" }}>
          CLUBS
        </div>
        <div className="font-bold">{data.clubs.length ? data.clubs.join(", ") : "None"}</div>
      </div>

      {data.presidency.length > 0 && (
        <div className={card}>
          <div className="comic-title text-2xl mb-1" style={{ color: "#9b59b6" }}>
            PRESIDENCY LOG
          </div>
          {data.presidency.map((t: any, i: number) => (
            <div key={i} className="font-bold text-sm py-0.5">
              {fmtDate(t.termStart)} – {t.termEnd ? fmtDate(t.termEnd) : "Present"} ({t.votes}{" "}
              votes)
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
