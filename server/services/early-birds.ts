/**
 * The early-bird bonus (phase4-contracts §3.2 rule 8): extra chips for players who were in their
 * seats on time. A flag per registration that only the clock's chip figures read (total chips and the
 * average stack): it never changes any money. Busted players may be marked too, since their chips
 * were in play.
 */
import type { EarlyBirdsInput, EarlyBirdsResultDto } from "@shared/api/clock";
import { db } from "../db";
import { conflict, notFound } from "../http/errors";
import { insertActivity } from "../repositories/activity";
import { countEarlyBirds, registrationIdsIn, setEarlyBird } from "../repositories/clock";
import { lockTournamentForRegistrationWrite } from "../repositories/registrations";
import { assertOpen } from "./tournament-views";

const players = (count: number) => `${count} player${count === 1 ? "" : "s"}`;

/**
 * POST /api/tournaments/:id/early-birds: gives (or takes back) the bonus for these entries, in one
 * transaction under the tournament's lock. Every id must be one of this tournament's registrations
 * (409 PLAYER_NOT_REGISTERED naming the others, and nothing changes). Logged (staff only) when any
 * flag changed.
 */
export async function setEarlyBirds(id: string, input: EarlyBirdsInput): Promise<EarlyBirdsResultDto> {
  const ids = Array.from(new Set(input.registrationIds));
  return await db.transaction(async (tx) => {
    const tournament = await lockTournamentForRegistrationWrite(tx, id);
    if (!tournament) throw notFound("Tournament not found");
    assertOpen(tournament, "its early birds");

    const registered = await registrationIdsIn(tx, id, ids);
    const strangers = ids.filter((registrationId) => !registered.has(registrationId));
    if (strangers.length > 0) {
      throw conflict(
        "PLAYER_NOT_REGISTERED",
        strangers.length === 1 ? "That entry is not registered for this tournament" : "Some of those entries are not registered for this tournament",
        { registrationIds: strangers },
      );
    }

    const flipped = new Set(await setEarlyBird(tx, id, ids, input.earlyBird));
    const changed = ids.filter((registrationId) => flipped.has(registrationId));
    if (changed.length > 0) {
      await insertActivity(tx, {
        tournamentId: id,
        eventType: "early_bird",
        description: input.earlyBird
          ? `Early-bird bonus given to ${players(changed.length)}`
          : `Early-bird bonus taken back from ${players(changed.length)}`,
        eventData: JSON.stringify({ earlyBird: input.earlyBird, registrationIds: changed }),
      });
    }
    return { changed, earlyBirds: await countEarlyBirds(tx, id) };
  });
}
