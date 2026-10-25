/**
 * The prize money as the players see it (round 6, the owner: "Don't show the rake or what is kept by
 * the club"): the prize pool, what each place pays, the high-hand pot and the money carried in from an
 * earlier game, worked out here from the registrations as stored (with who has paid: only paid players
 * are in the pool), so neither a public page nor the TV is ever sent the club's takings to work it out
 * from. GET /api/public/tournaments/:id/prizes answers it; the TV's money (./live-display) is the same.
 */
import { toPublicPrizes, type PublicPrizesDto } from "@shared/api/live-display";
import { db } from "../db";
import { notFound } from "../http/errors";
import { registrationsOf } from "../repositories/registrations";
import { getTournament } from "../repositories/tournaments";

/** GET /api/public/tournaments/:id/prizes: 404 for an unknown tournament. */
export async function publicPrizes(id: string): Promise<PublicPrizesDto> {
  const tournament = await getTournament(db, id);
  if (!tournament) throw notFound("Tournament not found");
  return toPublicPrizes(tournament, await registrationsOf(db, id));
}
