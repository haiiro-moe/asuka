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
 * Build a titled container with markdown body lines. Optional accent color and
 * trailing action row of buttons.
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
 * clicked button (if given) is relabeled as a loading indicator. */
function disableButtonsDeep(node: unknown, clickedId?: string): unknown {
  if (Array.isArray(node)) return node.map((n) => disableButtonsDeep(n, clickedId));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = disableButtonsDeep(v, clickedId);
    if (out.type === ComponentType.Button) {
      out.disabled = true;
      if (clickedId && out.custom_id === clickedId) {
        out.label = "Loading…";
        out.emoji = { name: "⏳" };
      }
    }
    return out;
  }
  return node;
}

/**
 * Acknowledge a button click by immediately re-rendering the message with all
 * buttons disabled and the clicked one showing "⏳ Loading…". Unlike a bare
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

/** Accent palette reused across feature cards for visual consistency. */
export const Accent = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  star: 0xffac33,
  club: 0xeb459e,
  election: 0x9b59b6,
} as const;
