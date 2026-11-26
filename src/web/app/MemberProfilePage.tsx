import type { ReactNode } from "react";
import { api } from "./api.ts";
import { Chip, Empty, ErrorLine, Heading, ImageFrame, Loading, Swatch, Window, useAsync } from "./ui.ts";

/** Formats a unix timestamp (seconds) as `4 Nov 2026`. */
const fmtDate = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** The `~/<name>` part of a window label: lowercase, no spaces. */
const homeName = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

/**
 * HTML rendition of the /profile PNG card as a character sheet, plus live Discord roles.
 * `children` (e.g. the own-profile inventory) render between the sheet and the roles window.
 *
 * @param props.userId Discord user id of the member to show.
 * @param props.children Extra windows slotted under the sheet.
 */
export function MemberProfilePage({ userId, children }: { userId: string; children?: ReactNode }) {
  const { data, error } = useAsync<any>(() => api.memberProfile(userId), [userId]);

  if (error) {
    return (
      <Window label="fish: ~/unknown" tone="love">
        <ErrorLine>Member not found. The name you asked for is not on the roll.</ErrorLine>
      </Window>
    );
  }
  if (!data) return <Loading>Looking the member up</Loading>;

  const pct = data.xpNeeded > 0 ? Math.min(100, Math.max(0, (data.xpCurrent / data.xpNeeded) * 100)) : 0;

  return (
    <div className="flex w-full flex-col gap-4">
      <Window label={`fish: ~/${homeName(data.displayName)}`}>
        <div className="flex flex-wrap items-center gap-4 p-2">
          <ImageFrame src={data.avatarUrl} alt="" size={96} />
          <div className="min-w-0">
            <div className="disp break-words" style={{ fontSize: 48 }}>
              {data.displayName}
            </div>
            <p className="c4 m-0">
              level {data.level} » rank {data.rank ? `#${data.rank}` : "none yet"}
            </p>
            {!data.inGuild && <p className="nar m-0">No longer in the server.</p>}
          </div>
        </div>

        <div className="p-2">
          <div className="progress">
            <div className="progress_head">
              <span>level {data.level}</span>
              <span className="progress_num">
                {data.xpCurrent.toLocaleString()} / {data.xpNeeded.toLocaleString()} xp to level {data.level + 1}
              </span>
            </div>
            <div
              className="progress_track"
              role="progressbar"
              aria-label="xp to next level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
            >
              <div className="progress_fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div className="fx-sheet p-2">
          <span className="kv_label">credits</span>
          <span>{data.credits.toLocaleString()} SC</span>
          <span className="kv_label">xp</span>
          <span>{data.xp.toLocaleString()}</span>
          <span className="kv_label">messages</span>
          <span>{data.messageCount.toLocaleString()}</span>
          {data.guildJoinedAt && (
            <>
              <span className="kv_label">joined</span>
              <span>{fmtDate(data.guildJoinedAt)}</span>
            </>
          )}
        </div>
      </Window>

      {children}

      <Window label={`fish: ~/${homeName(data.displayName)}/roles`}>
        <Heading first>roles</Heading>
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          {data.roles.map((r: any) => (
            <Chip key={r.id} on>
              <Swatch colour={r.color ?? "var(--color-muted)"} /> {r.name}
            </Chip>
          ))}
          {data.roles.length === 0 && <Empty>No roles yet. The member wears nothing.</Empty>}
        </div>

        <Heading>clubs</Heading>
        <div className="flex flex-wrap gap-2 px-2 pb-2">
          {data.clubs.map((c: string) => (
            <Chip key={c}>{c}</Chip>
          ))}
          {data.clubs.length === 0 && <Empty>No clubs. A free evening, then.</Empty>}
        </div>
      </Window>

      {data.presidency.length > 0 && (
        <Window label={`fish: ~/${homeName(data.displayName)}/presidency`}>
          <div className="fx-scroll">
            <table className="fx-table">
              <thead>
                <tr>
                  <th>from</th>
                  <th>to</th>
                  <th className="r">votes</th>
                </tr>
              </thead>
              <tbody>
                {data.presidency.map((t: any, i: number) => (
                  <tr key={i}>
                    <td>{fmtDate(t.termStart)}</td>
                    <td>{t.termEnd ? fmtDate(t.termEnd) : "present"}</td>
                    <td className="r">{t.votes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Window>
      )}
    </div>
  );
}
