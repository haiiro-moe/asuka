/**
 * Channel pickers built from {@link Select} and {@link Chip}: {@link ChannelSelect} for a clearable single
 * channel (or category) and {@link ChannelMultiSelect} for a list stored as `a,b,c`. They add no look of
 * their own. The choices come from `GET /api/guild-options` (see `channel-ids.ts` for the pure parts).
 *
 * @module
 */
import { useMemo } from "react";
import { Chip, cx } from "./basics.tsx";
import { Select } from "./Select.tsx";
import {
  channelChoices,
  chosenChannels,
  joinIdList,
  parseIdList,
  withNoneAndUnknown,
  type GuildChannel,
  type GuildChannelKind,
} from "./channel-ids.ts";

/** Props of {@link ChannelSelect}. */
export interface ChannelSelectProps {
  /** The guild's channels, from `GET /api/guild-options`. */
  channels: readonly GuildChannel[];
  /** Which kinds to offer, for example `POSTABLE_KINDS` or `CATEGORY_KINDS`. */
  kinds: readonly GuildChannelKind[];
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
 * A clearable single-channel select. The first row is `none`, which clears the setting. A stored id that
 * is missing from the list (a deleted channel) is shown as `unknown · <id>` and stays chosen, so saving
 * never drops it silently; pick `none` to clear it. The filter line appears from 13 rows, as in {@link Select}.
 */
export function ChannelSelect({ channels, kinds, value, onChange, ...rest }: ChannelSelectProps) {
  const options = useMemo(
    () => withNoneAndUnknown(channelChoices(channels, kinds), value, "none"),
    [channels, kinds, value],
  );
  return <Select options={options} value={value ?? ""} onChange={onChange} {...rest} />;
}

/** Props of {@link ChannelMultiSelect}. */
export interface ChannelMultiSelectProps {
  /** The guild's channels, from `GET /api/guild-options`. */
  channels: readonly GuildChannel[];
  /** Which kinds to offer. */
  kinds: readonly GuildChannelKind[];
  /** The stored comma list `a,b,c`. */
  value: string | null | undefined;
  /** Called with the canonical comma list (trimmed, de-duplicated, saved order kept). */
  onChange: (list: string) => void;
  disabled?: boolean;
  /** Accessible name of the add control when no SettingRow labels it. */
  ariaLabel?: string;
  /** Id of the element that names the control (a SettingRow's `labelId`). */
  ariaLabelledBy?: string;
  /** Shown while nothing is chosen. Default `none chosen.` */
  emptyText?: string;
  className?: string;
}

/**
 * A multi-channel picker: the chosen channels as chips in saved order, then an add-select listing only the
 * channels not chosen yet. A chip is an on/off {@link Chip} (`on` shows the check mark); activating it
 * removes the channel and its trailing `×` says so. An id that is not a listed channel of the offered kinds
 * stays as a dashed chip reading `unknown · <id>` and is kept on save until removed. Writes the canonical
 * `a,b,c`.
 */
export function ChannelMultiSelect({
  channels,
  kinds,
  value,
  onChange,
  disabled,
  ariaLabel,
  ariaLabelledBy,
  emptyText = "none chosen.",
  className,
}: ChannelMultiSelectProps) {
  const ids = useMemo(() => parseIdList(value), [value]);
  const chosen = useMemo(() => chosenChannels(ids, channels, kinds), [ids, channels, kinds]);
  const choices = useMemo(() => channelChoices(channels, kinds, new Set(ids)), [channels, kinds, ids]);
  const remove = (id: string) => onChange(joinIdList(ids.filter((x) => x !== id)));

  return (
    <span className={cx("flex flex-wrap items-center gap-2", className)}>
      {chosen.length === 0 && <span className="note-s">{emptyText}</span>}
      {chosen.map((c) => (
        <Chip
          key={c.id}
          on={!c.unknown}
          disabled={disabled}
          ariaLabel={`remove ${c.label}`}
          title={c.unknown ? "not a channel the picker offers; kept until removed" : undefined}
          onToggle={() => remove(c.id)}
        >
          {c.label} ×
        </Chip>
      ))}
      <Select
        options={choices}
        value={null}
        placeholder="add a channel"
        onChange={(id) => onChange(joinIdList([...ids, id]))}
        disabled={disabled || choices.length === 0}
        ariaLabel={ariaLabel}
        ariaLabelledBy={ariaLabelledBy}
      />
    </span>
  );
}
