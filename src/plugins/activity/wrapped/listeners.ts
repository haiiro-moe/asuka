import { Events, MessageFlags } from "discord.js";
import { defineListener } from "../../../core/plugin.ts";
import type { Listener } from "../../../core/plugin.ts";
import { OPTIN_BUTTON_ID, OPTOUT_BUTTON_ID, applyOptInChoice } from "./optin.ts";

/**
 * The sign-up message's `wrapped:optin` and `wrapped:optout` buttons. A click
 * records the choice for the member who clicked, then replies ephemerally with
 * the matching catalog message. The sign-up message itself is public, so it is
 * never edited (no `ackButtonLoading`, which would disable the buttons for
 * everyone).
 */
const optInButtons = defineListener({
  event: Events.InteractionCreate,
  async handle(ctx, interaction) {
    if (!interaction.isButton()) return;
    if (interaction.customId !== OPTIN_BUTTON_ID && interaction.customId !== OPTOUT_BUTTON_ID) return;
    try {
      const payload = await applyOptInChoice(
        ctx.client,
        interaction.user.id,
        interaction.customId === OPTIN_BUTTON_ID,
      );
      await interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    } catch (err) {
      console.error("[wrapped] opt-in button failed:", err);
    }
  },
});

/**
 * Interaction listeners for Wrapped: only the opt-in and opt-out buttons on
 * the sign-up message. Nothing here runs at boot or on a timer.
 */
export const wrappedListeners: Listener[] = [optInButtons];
