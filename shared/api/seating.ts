/**
 * /api/tournaments/:id/tables/*, /api/tournaments/:id/seating/* and the public seat finder
 * (phase4-contracts §2): tables put out for a tournament and who sits where. The plans themselves
 * are shared/domain/seating; these are the request schemas and the DTOs.
 *
 * Writes need a manager of the tournament's club and an open tournament (409 TOURNAMENT_CLOSED once
 * it is completed or cancelled). Each runs in one transaction that locks the tournament row first
 * (the order every registration write uses), so two taps never seat anyone twice; the partial unique
 * indexes back that up (a lost race is 409 SEAT_CONFLICT). Every write answers SeatingMutationDto,
 * built after the commit.
 */
import { z } from "zod";
import { SEATING_LIMITS, type SeatReason } from "../domain/seating";
import type { ActivityEventType, TournamentStatus } from "../domain/tournaments";
import { idSchema } from "./common";
import type { PublicPlayer } from "./public";

const seatCount = z.number().int().min(SEATING_LIMITS.minSeats).max(SEATING_LIMITS.maxSeats);
const tableNumber = z.number().int().min(1).max(SEATING_LIMITS.maxTableNumber);
const version = z.string().regex(/^[0-9a-f]{8}$/, "Invalid seating version");

/** POST /api/tournaments/:id/tables: add `count` tables numbered after the highest (archived ones included). 409 TABLE_LIMIT past 50 active. */
export const createTablesSchema = z.object({
  count: z.number().int().min(1).max(20).default(1),
  seatCount: seatCount.default(SEATING_LIMITS.defaultSeats),
});
export type CreateTablesInput = z.infer<typeof createTablesSchema>;

/**
 * PATCH /api/tournaments/:id/tables/:tableId: rename, resize, renumber, or reopen an archived table
 * (status "active"). Shrinking below an occupied seat: 409 SEATS_OCCUPIED (details: { seatNumbers });
 * a number another table has: 409 TABLE_NUMBER_TAKEN; past 50 active on reopen: 409 TABLE_LIMIT.
 */
export const updateTableSchema = z
  .object({
    name: z
      .preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(40).nullable())
      .optional(),
    seatCount: seatCount.optional(),
    tableNumber: tableNumber.optional(),
    status: z.literal("active").optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), "Nothing to update");
export type UpdateTableInput = z.infer<typeof updateTableSchema>;

/**
 * POST /api/tournaments/:id/seating/setup: one tap from no tables to everyone seated. Creates
 * `tableCount` tables (default suggestTables(eligible, seatCount)) of `seatCount` seats, then draws
 * every eligible player (409 TABLES_EXIST when any table is active). `includeUnconfirmed: false`
 * leaves out entries whose payment is not confirmed (the response counts them: excludedUnconfirmed).
 */
export const seatingSetupSchema = z.object({
  seatCount: seatCount.default(SEATING_LIMITS.defaultSeats),
  tableCount: z.number().int().min(1).max(SEATING_LIMITS.maxActiveTables).optional(),
  includeUnconfirmed: z.boolean().default(true),
});
export type SeatingSetupInput = z.infer<typeof seatingSetupSchema>;

/**
 * POST /api/tournaments/:id/seating/draw: "unseated" seats everyone still in without a seat (or just
 * `registrationIds`); "all" redraws everyone still in. A repeated "unseated" tap seats nobody twice
 * (empty moves). With `expectedVersion` (the SeatingDto.version the TD confirmed against) a seating
 * changed since is 409 STALE_PLAN, so a second "Redraw everyone" from another phone redraws nothing.
 * 409 NO_TABLES, INSUFFICIENT_SEATS (details: { needed, available }); a registration of another
 * tournament or one who is out: 409 PLAYER_NOT_ACTIVE (details: { registrationId }).
 */
export const drawSeatsSchema = z.object({
  scope: z.enum(["unseated", "all"]).default("unseated"),
  registrationIds: z.array(idSchema).min(1).max(500).optional(),
  includeUnconfirmed: z.boolean().default(true),
  expectedVersion: version.optional(),
});
export type DrawSeatsInput = z.infer<typeof drawSeatsSchema>;

/**
 * POST /api/tournaments/:id/seating/assign: put a player in a seat (moving them if seated). An occupied
 * seat is 409 SEAT_TAKEN (details: { occupantRegistrationId }) unless `swap`, which trades the two
 * (409 NOT_SEATED for a mover with no seat). 409 PLAYER_NOT_ACTIVE, TABLE_NOT_ACTIVE; 404
 * TABLE_NOT_FOUND; 400 SEAT_OUT_OF_RANGE. With `expectedVersion` (the SeatingDto.version a confirm
 * dialog showed, e.g. "Swap Alice and Bob?") a seating changed since is 409 STALE_PLAN (details: {
 * seating }), so a swap never trades with someone who sat down in that seat meanwhile.
 */
export const assignSeatSchema = z.object({
  registrationId: idSchema,
  tableId: idSchema,
  seatNumber: z.number().int().min(1).max(SEATING_LIMITS.maxSeats),
  swap: z.boolean().default(false),
  expectedVersion: version.optional(),
});
export type AssignSeatInput = z.infer<typeof assignSeatSchema>;

/** POST /api/tournaments/:id/seating/unseat: take a player out of their seat (idempotent). */
export const unseatSchema = z.object({ registrationId: idSchema });
export type UnseatInput = z.infer<typeof unseatSchema>;

/**
 * POST /api/tournaments/:id/seating/balance: apply suggestions.balance. With `expectedVersion` (the
 * SeatingDto.version the suggestion was shown with) a seating changed since is 409 STALE_PLAN
 * (details: { seating: SeatingDto }), so Apply does exactly what was shown. Already balanced: no moves.
 */
export const balanceSchema = z.object({ expectedVersion: version.optional() });
export type BalanceInput = z.infer<typeof balanceSchema>;

/** POST /api/tournaments/:id/tables/:tableId/break: move its players to the other tables at random, then archive it. 409 LAST_TABLE, INSUFFICIENT_SEATS, TABLE_NOT_ACTIVE. */
export const breakTableSchema = z.object({ expectedVersion: version.optional() });
export type BreakTableInput = z.infer<typeof breakTableSchema>;

/**
 * POST /api/tournaments/:id/seating/final-table: redraw everyone seated at one table (default:
 * suggestions.finalTable) and archive the rest. Players waiting for a seat (SeatingDto.unseated:
 * often unpaid sign-ups who never came) stay waiting, unless `includeWaiting`, which draws them too
 * and counts them in the size check (TDN3-FINAL-TABLE-WAITING). With `expectedVersion`, a seating
 * changed since (e.g. the final table already drawn from another phone) is 409 STALE_PLAN.
 */
export const finalTableSchema = z.object({
  tableId: idSchema.optional(),
  includeWaiting: z.boolean().optional(),
  expectedVersion: version.optional(),
});
export type FinalTableInput = z.infer<typeof finalTableSchema>;

/**
 * POST /api/tournaments/:id/seating/undo: puts every player the last table break, draw, balance or
 * final table moved back where they were (SeatingDto.lastChange, its `activityId`), and reopens the
 * tables it archived. Only while nothing about the seats has changed since (lastChange.canUndo): else
 * 409 STALE_PLAN (details: { seating }); a change that is no longer the last, or was undone already, is
 * 409 NOTHING_TO_UNDO (details: { seating }). `expectedVersion` as for Balance.
 */
export const undoSeatingSchema = z.object({ activityId: idSchema, expectedVersion: version.optional() });
export type UndoSeatingInput = z.infer<typeof undoSeatingSchema>;

/** A seat's place, as screens name it: "Table 2, Seat 4". */
export interface SeatRefDto {
  tableId: string;
  tableNumber: number;
  tableName: string;
  seatNumber: number;
}

export interface SeatMoveDto {
  registrationId: string;
  playerName: string;
  from: SeatRefDto | null;
  to: SeatRefDto | null;
  reason: SeatReason;
}

export interface TableSeatDto {
  seatNumber: number;
  /** Null for an empty seat. */
  registrationId: string | null;
  player: PublicPlayer | null;
  /** Staff bookkeeping: whether that entry has paid (null for an empty seat). */
  paymentConfirmed: boolean | null;
}

export interface TableDto {
  id: string;
  tableNumber: number;
  name: string | null;
  /** name, or "Table <number>". */
  displayName: string;
  seatCount: number;
  status: "active" | "broken";
  occupied: number;
  /** One per seat (seatCount) while active; [] once archived. */
  seats: TableSeatDto[];
}

/**
 * The seating operations whose moves are kept in their activity entries: the four that can be undone,
 * and the undo of one (which cannot itself be undone).
 */
export const SEATING_CHANGE_EVENTS = ["table_broken", "seating_drawn", "seating_balanced", "final_table", "seating_undone"] as const satisfies readonly ActivityEventType[];
export type SeatingChangeEvent = (typeof SEATING_CHANGE_EVENTS)[number];

/**
 * The last table break, draw, balance or final table, or the undo of one ("Show last moves", Undo):
 * its activity entry and every move it made, as they were named then.
 */
export interface SeatingChangeDto {
  activityId: string;
  eventType: SeatingChangeEvent;
  description: string;
  at: string;
  moves: SeatMoveDto[];
  /** It can be undone: it is not itself an undo, the tournament is open, and the seats are as it left them. */
  canUndo: boolean;
}

/** GET /api/tournaments/:id/seating (staff). */
export interface SeatingDto {
  tournamentId: string;
  tournamentStatus: TournamentStatus;
  /** Completed or cancelled: shown, not changed. */
  readOnly: boolean;
  /** seatingVersion: send it back as expectedVersion with Balance or Break. */
  version: string;
  /** Active tables by number, then archived ones. */
  tables: TableDto[];
  /** Players still in without a seat, by name. */
  unseated: Array<{ registrationId: string; player: PublicPlayer; paymentConfirmed: boolean }>;
  stats: {
    activePlayers: number;
    seated: number;
    unseated: number;
    unconfirmedUnseated: number;
    openSeats: number;
    capacity: number;
    activeTables: number;
    maxDiff: number;
  };
  suggestions: {
    balance: SeatMoveDto[];
    /**
     * Break and the final table count the players at the tables only: players waiting for a seat
     * (stats.unseated, unconfirmedUnseated of them unpaid) never block them; say so with
     * waitingText (shared/domain/seating), e.g. "2 players are waiting for a seat (2 unpaid)".
     */
    breakTable: { tableId: string; tableNumber: number; playersToMove: number } | null;
    finalTable: { tableId: string; tableNumber: number } | null;
    /** While no table is active: suggestTables(players still in, 9). */
    setup: { seatCount: number; tableCount: number; perTable: number[] } | null;
  };
  /** Every seated registration's seat, for the standings table's Seat column. */
  seatByRegistrationId: Record<string, { tableNumber: number; seatNumber: number }>;
  /** Null until a table is broken, seats are drawn, tables are balanced or a final table is drawn. */
  lastChange: SeatingChangeDto | null;
}

/** 200/201 from every seating write. */
export interface SeatingMutationDto {
  seating: SeatingDto;
  moves: SeatMoveDto[];
  /** Draw and setup: entries left out because their payment is not confirmed. */
  excludedUnconfirmed?: number;
  /** DELETE of a table: "deleted" when it never seated anyone, else "archived" (its history is kept). */
  removed?: "deleted" | "archived";
}

/**
 * GET /api/public/tournaments/:id/seating ("Find your seat", the TV's seating overlay). Anyone; players
 * as PublicPlayer only, players who are out left out, archived tables left out; Cache-Control no-store.
 */
export interface PublicSeatingDto {
  tournament: { id: string; name: string; status: TournamentStatus };
  club: { id: string; name: string; slug: string; imageUrl: string | null };
  /** Active tables by number. */
  tables: Array<{ tableNumber: number; displayName: string; seatCount: number; seats: Array<{ seatNumber: number; player: PublicPlayer | null }> }>;
  /** Every seated player, by name, for the search. */
  players: Array<{ player: PublicPlayer; tableNumber: number; tableName: string; seatNumber: number }>;
  unseatedCount: number;
}
