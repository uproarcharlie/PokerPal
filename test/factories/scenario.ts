import type {
  Club,
  Player,
  PointsAllocation,
  PointsSystem,
  Season,
  Tournament,
  TournamentRegistration,
  User,
} from "@shared/schema";
import { getDb, type Database } from "../../server/db";
import { createClub, createSeason } from "./clubs";
import { createPlayer } from "./players";
import { createPointsAllocations, createPointsSystem, type AllocationSpec } from "./points";
import { createRegistration, createTournament, type NewTournament } from "./tournaments";

export type RakeType = "none" | "percentage" | "fixed";

export interface TournamentScenarioOptions {
  /** Registered players (default 8). They are referred to by index below. */
  players?: number;
  /** Buy-in as a decimal string (default "50.00"); also the default rebuy/add-on price. */
  buyIn?: string;
  /** Buy-in rake (default none). */
  rake?: { type: RakeType; amount: string };
  /** Player index → number of rebuys / add-ons. */
  rebuys?: Readonly<Record<number, number>>;
  addons?: Readonly<Record<number, number>>;
  /** Whose payment is confirmed: everyone (default), no one, or these player indexes. */
  paid?: boolean | readonly number[];
  /** Busted players, first out first; `by` credits the knockout to another player. */
  eliminations?: ReadonlyArray<number | { player: number; by: number }>;
  /** A season points system for the tournament; omitted means the tournament has none. */
  points?: { participation?: number; knockout?: number; allocations: readonly AllocationSpec[] };
  /** Club owner (default: no owner). */
  owner?: Pick<User, "id">;
  /** Any other tournament columns. */
  tournament?: Partial<NewTournament>;
}

export interface TournamentScenario {
  club: Club;
  season: Season;
  pointsSystem: PointsSystem | null;
  allocations: PointsAllocation[];
  tournament: Tournament;
  /** In index order. */
  players: Player[];
  /** `registrations[i]` belongs to `players[i]`. */
  registrations: TournamentRegistration[];
}

const ELIMINATION_INTERVAL_MS = 10 * 60 * 1000;

function assertPlayerIndex(index: number, count: number, field: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${field}: player index ${index} is outside 0..${count - 1}`);
  }
}

/**
 * A club, season and tournament with registered players in a given state:
 * rebuys, add-ons, payments and eliminations (with elimination times 10
 * minutes apart from the start, and knockouts credited). Nothing is finalized:
 * positions, prizes and points are left for the code under test.
 */
export async function createTournamentScenario(
  options: TournamentScenarioOptions = {},
  db: Database = getDb(),
): Promise<TournamentScenario> {
  const playerCount = options.players ?? 8;
  const buyIn = options.buyIn ?? "50.00";
  const eliminations = (options.eliminations ?? []).map((entry) =>
    typeof entry === "number" ? { player: entry, by: undefined } : entry,
  );
  for (const [field, indexes] of [
    ["rebuys", Object.keys(options.rebuys ?? {}).map(Number)],
    ["addons", Object.keys(options.addons ?? {}).map(Number)],
    ["paid", Array.isArray(options.paid) ? options.paid : []],
    ["eliminations", eliminations.flatMap(({ player, by }) => (by === undefined ? [player] : [player, by]))],
  ] as const) {
    for (const index of indexes) assertPlayerIndex(index, playerCount, field);
  }
  const knockouts = new Map<number, number>();
  const eliminated = new Map<number, { order: number; by?: number }>();
  eliminations.forEach(({ player, by }, order) => {
    if (eliminated.has(player) || by === player) {
      throw new RangeError(`eliminations: player ${player} is eliminated twice or by themselves`);
    }
    eliminated.set(player, { order, by });
    if (by !== undefined) knockouts.set(by, (knockouts.get(by) ?? 0) + 1);
  });

  const club = await createClub({ ownerId: options.owner?.id ?? null }, db);
  const season = await createSeason({ clubId: club.id }, db);

  let pointsSystem: PointsSystem | null = null;
  let allocations: PointsAllocation[] = [];
  if (options.points) {
    pointsSystem = await createPointsSystem(
      {
        seasonId: season.id,
        participationPoints: options.points.participation ?? 0,
        knockoutPoints: options.points.knockout ?? 0,
      },
      db,
    );
    allocations = await createPointsAllocations(pointsSystem.id, options.points.allocations, db);
  }

  const tournament = await createTournament(
    {
      clubId: club.id,
      seasonId: season.id,
      pointsSystemId: pointsSystem?.id ?? null,
      buyInAmount: buyIn,
      rebuyAmount: options.rebuys ? buyIn : null,
      addonAmount: options.addons ? buyIn : null,
      rakeType: options.rake?.type ?? "none",
      rakeAmount: options.rake?.amount ?? "0.00",
      maxPlayers: Math.max(playerCount, 2),
      ...options.tournament,
    },
    db,
  );

  const players: Player[] = [];
  for (let index = 0; index < playerCount; index++) players.push(await createPlayer({}, db));

  const paid = options.paid ?? true;
  const isPaid = (index: number) => (typeof paid === "boolean" ? paid : paid.includes(index));

  const registrations: TournamentRegistration[] = [];
  for (let index = 0; index < playerCount; index++) {
    const elimination = eliminated.get(index);
    registrations.push(
      await createRegistration(
        {
          tournamentId: tournament.id,
          playerId: players[index].id,
          rebuys: options.rebuys?.[index] ?? 0,
          addons: options.addons?.[index] ?? 0,
          knockouts: knockouts.get(index) ?? 0,
          paymentConfirmed: isPaid(index),
          isEliminated: elimination !== undefined,
          eliminationTime: elimination
            ? new Date(tournament.startDateTime.getTime() + (elimination.order + 1) * ELIMINATION_INTERVAL_MS)
            : null,
          eliminatedBy: elimination?.by === undefined ? null : players[elimination.by].id,
        },
        db,
      ),
    );
  }

  return { club, season, pointsSystem, allocations, tournament, players, registrations };
}
