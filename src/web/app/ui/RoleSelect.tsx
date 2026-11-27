/**
 * {@link RoleSelect}: a clearable single-role picker built from {@link Select} and {@link Swatch}. The
 * choices come from `GET /api/guild-options`.
 *
 * @module
 */
import { useMemo } from "react";
import { Swatch, cx } from "./basics.tsx";
import { Select, type SelectOption } from "./Select.tsx";
import { orderRoles, roleHex, unknownLabel, NONE_VALUE, type GuildRole } from "./channel-ids.ts";

/** Props of {@link RoleSelect}. */
export interface RoleSelectProps {
  /** The guild's roles, from `GET /api/guild-options`. */
  roles: readonly GuildRole[];
  /** The stored id; empty or null means none. An id that is not listed shows as `unknown · <id>`. */
  value: string | null | undefined;
  /** Called with the new id, or `""` when the user picks `none`. */
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Accessible name when no SettingRow labels the control. */
  ariaLabel?: string;
  /** Id of the element that names the control (a SettingRow's `labelId`). */
  ariaLabelledBy?: string;
  id?: string;
  className?: string;
}

/**
 * A clearable single-role select. Roles are listed highest first, bot-managed roles last (marked `bot` in
 * the meta column). Each row carries the role's colour as a {@link Swatch} (role colours are data, so they
 * are shown as a swatch and never as text colour), and the chosen role's swatch sits before the control.
 * A stored id that is missing from the list shows as `unknown · <id>` and is kept until the user picks
 * `none`. The filter line appears from 13 rows.
 */
export function RoleSelect({ roles, value, onChange, className, ...rest }: RoleSelectProps) {
  const id = (value ?? "").trim();
  const ordered = useMemo(() => orderRoles(roles), [roles]);
  const options = useMemo(() => {
    const out: SelectOption<string>[] = [{ value: NONE_VALUE, label: "none" }];
    if (id && !ordered.some((r) => r.id === id)) out.push({ value: id, label: unknownLabel(id) });
    for (const r of ordered) {
      out.push({
        value: r.id,
        label: r.name,
        meta: (
          <>
            {r.managed && <span className="mr-1">bot</span>}
            <Swatch colour={roleHex(r.colour)} />
          </>
        ),
      });
    }
    return out;
  }, [ordered, id]);
  const current = ordered.find((r) => r.id === id);
  return (
    <span className={cx("inline-flex max-w-full items-center gap-2", className)}>
      {current && <Swatch colour={roleHex(current.colour)} />}
      <Select options={options} value={id} onChange={onChange} {...rest} />
    </span>
  );
}
