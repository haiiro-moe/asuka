import { isValidComponentsPayload, Accent } from "../../core/components.ts";
import type { ApiRoute } from "../../core/plugin.ts";
import { nowSec } from "../../core/util.ts";
import {
  peekAnnounceToken,
  consumeAnnounceToken,
  postRawToClubSpaceAndPin,
  dmRawToClubMembers,
  announceHeader,
  getClub,
  clubMemberIds,
} from "./service.ts";

/** Club info + composer state for the web announce page (no dashboard session). */
const getAnnounceInfo: ApiRoute = {
  method: "GET",
  path: "/api/club-announce/:token",
  access: "public",
  handle(_req, ctx) {
    const result = peekAnnounceToken(ctx.params.token!);
    if (!result) return Response.json({ error: "not found" }, { status: 404 });
    if (!result.valid) return Response.json({ error: result.reason }, { status: 410 });
    const club = getClub(result.row.clubId);
    if (!club) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      clubName: club.name,
      clubDescription: club.description,
      accent: Accent.club,
      memberCount: clubMemberIds(club.id).length,
      expiresInSec: result.row.expiresAt - nowSec(),
    });
  },
};

/** Consume the token and broadcast the composed announcement. */
const postAnnounce: ApiRoute = {
  method: "POST",
  path: "/api/club-announce/:token",
  access: "public",
  async handle(req, ctx) {
    const token = ctx.params.token!;
    const peek = peekAnnounceToken(token);
    if (!peek) return Response.json({ error: "not found" }, { status: 404 });
    if (!peek.valid) return Response.json({ error: peek.reason }, { status: 410 });

    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!isValidComponentsPayload(body?.components)) {
      return Response.json({ error: "components must be a non-empty Components V2 array" }, {
        status: 400,
      });
    }

    // Consume first so the token is single-use even if the send below fails partway.
    const consumed = consumeAnnounceToken(token);
    if (!consumed) return Response.json({ error: "already used or expired" }, { status: 410 });

    const club = getClub(consumed.clubId);
    if (!club) return Response.json({ error: "club not found" }, { status: 404 });

    const components = body!.components as unknown[];
    const dmPayload = [announceHeader(club.name), ...components];
    const guild = await ctx.client.guilds.fetch(ctx.guildId);
    const posted = await postRawToClubSpaceAndPin(guild, consumed.clubId, components);
    await dmRawToClubMembers(ctx.client, consumed.clubId, dmPayload);

    return Response.json({ ok: true, posted });
  },
};

export const clubApiRoutes: ApiRoute[] = [getAnnounceInfo, postAnnounce];
