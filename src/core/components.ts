import {
  MessageFlags,
  ComponentType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  SeparatorSpacingSize,
  type APIMessageTopLevelComponent,
  type ButtonInteraction,
  type JSONEncodable,
} from "discord.js";

/** Components V2 builders and flags from discord.js, re-exported so plugins import every message part from here. */
export {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  MediaGalleryBuilder,
  AttachmentBuilder,
  MessageFlags,
};

type TopLevel = JSONEncodable<APIMessageTopLevelComponent> | APIMessageTopLevelComponent;

/**
 * Wrap top-level components into a Components V2 message payload. Every bot
 * message that isn't a trivial ephemeral ack should go through this so we never
 * accidentally fall back to legacy embeds.
 */
export function v2(...components: TopLevel[]) {
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components,
    // Never ping: mentions (<@id>, @everyone, roles) inside Components V2 still
    // notify unless allowed mentions are explicitly suppressed.
    allowedMentions: { parse: [] as const },
  };
}

/** A single markdown text display component. */
export function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

/** A horizontal separator, optionally with a visible divider line. */
export function separator(divider = true, large = false): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(divider)
    .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

/**
 * Build a titled container with markdown body lines. Optional accent color
 * (use an {@link Accent} value) and trailing action row of buttons. The helper
 * adds no decoration of its own: titles are written lowercase at the call
 * site, in the haiiro voice, with glyphs (`» @ ★ ✓ ×`) rather than emoji.
 */
export function card(opts: {
  accent?: number;
  title?: string;
  lines?: string[];
  buttons?: ButtonBuilder[];
}): ContainerBuilder {
  const container = new ContainerBuilder();
  if (opts.accent !== undefined) container.setAccentColor(opts.accent);

  if (opts.title) container.addTextDisplayComponents(text(`## ${opts.title}`));
  if (opts.lines?.length) {
    container.addTextDisplayComponents(text(opts.lines.join("\n")));
  }
  if (opts.buttons?.length) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(...opts.buttons),
    );
  }
  return container;
}

/** A media gallery showing an uploaded attachment by name (`attachment://`). */
export function attachmentImage(name: string): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(`attachment://${name}`),
  );
}

/**
 * Bundle a rendered PNG for a Components V2 message: the gallery goes inside a
 * container, the file rides in the top-level `files` send option, e.g.
 * `{ ...v2(container), files: [file] }`.
 */
export function pngAttachment(buffer: Buffer, name: string) {
  return {
    file: new AttachmentBuilder(buffer, { name }),
    gallery: attachmentImage(name),
  };
}

/** Deep-copy raw component JSON, disabling every button along the way. The
 * clicked button (if given) is relabeled "loading…" and loses any emoji. */
function disableButtonsDeep(node: unknown, clickedId?: string): unknown {
  if (Array.isArray(node)) return node.map((n) => disableButtonsDeep(n, clickedId));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = disableButtonsDeep(v, clickedId);
    if (out.type === ComponentType.Button) {
      out.disabled = true;
      if (clickedId && out.custom_id === clickedId) {
        out.label = "loading…";
        delete out.emoji;
      }
    }
    return out;
  }
  return node;
}

/**
 * Acknowledge a button click by immediately re-rendering the message with all
 * buttons disabled and the clicked one showing "loading…". Unlike a bare
 * deferUpdate() this gives instant visual feedback and blocks double-clicks
 * while the next state is computed. Callers finish (or restore buttons on
 * failure) with `interaction.editReply(...)`.
 */
export async function ackButtonLoading(interaction: ButtonInteraction) {
  const components = interaction.message.components.map((c) =>
    disableButtonsDeep(
      typeof (c as { toJSON?: () => unknown }).toJSON === "function"
        ? (c as unknown as { toJSON: () => unknown }).toJSON()
        : c,
      interaction.customId,
    ),
  ) as APIMessageTopLevelComponent[];
  await interaction.update({ components });
}

/**
 * Validate that a stored auto-reply payload looks like a Components V2 top-level
 * component array. Raw API JSON is accepted directly by discord.js's `components`
 * field, so the web editor stores exactly this shape.
 */
export function isValidComponentsPayload(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (c) => typeof c === "object" && c !== null && "type" in (c as object),
  );
}

/**
 * Accent palette for Components V2 containers, as Rose Pine hex integers. The
 * key names are the call-site contract and never change; each value is a haiiro
 * token with one job. The stripe on a Discord container is the only place
 * colour appears, so pine is only ever a bar, never text.
 *
 * - `primary`: pine (`color-pine`), the default frame colour.
 * - `success`: foam (`color-foam`), things that worked or were approved.
 * - `warning`: gold (`color-gold`), the one thing that needs a look.
 * - `danger`: love (`color-love`), destructive or failed.
 * - `star`: gold (`color-gold`), starboard and leaderboard.
 * - `club`: iris (`color-iris`), clubs.
 * - `election`: rose (`color-rose`), elections and the presidency.
 */
export const Accent = {
  primary: 0x31748f,
  success: 0x9ccfd8,
  warning: 0xf6c177,
  danger: 0xeb6f92,
  star: 0xf6c177,
  club: 0xc4a7e7,
  election: 0xebbcba,
} as const;
