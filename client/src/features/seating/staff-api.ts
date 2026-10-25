/**
 * The seating endpoints only the club's staff call (phase4-contracts §3.1, round5-contracts §3.2): the
 * TD's view of every table and seat (S1), and every change (S2–S11, Undo, round 5's open-table). Apart from api.ts so the public pages never load
 * them. Every change answers SeatingMutationDto: the seating after it, and who moved where.
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  AssignSeatInput,
  BalanceInput,
  BreakTableInput,
  CreateTablesInput,
  DrawSeatsInput,
  FinalTableInput,
  OpenTableInput,
  SeatingDto,
  SeatingMutationDto,
  SeatingSetupInput,
  UndoSeatingInput,
  UnseatInput,
  UpdateTableInput,
} from "@shared/api/seating";
import { apiGet, apiSend, segment } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { tournamentPath } from "@/features/tournaments/api";

const tablePath = (tournamentId: string, tableId: string) => `${tournamentPath(tournamentId)}/tables/${segment(tableId)}`;
const seatingPath = (tournamentId: string, action: string) => `${tournamentPath(tournamentId)}/seating/${action}`;

export const seatingQueries = {
  /** Every table (active, then archived), the unseated, the figures and the suggestions; 403 to anyone but staff. */
  detail: (tournamentId: string) =>
    queryOptions({
      queryKey: qk.tournaments.seating(tournamentId),
      queryFn: ({ signal }) => apiGet<SeatingDto>(`${tournamentPath(tournamentId)}/seating`, { signal }),
    }),
};

/** S6: tables for everyone still in, and their seats drawn, in one tap. */
export const setupSeating = (tournamentId: string, input: SeatingSetupInput) =>
  apiSend<SeatingMutationDto>("POST", seatingPath(tournamentId, "setup"), input);

/** S2: more tables, numbered after the highest (archived ones count). */
export const addTables = (tournamentId: string, input: CreateTablesInput) =>
  apiSend<SeatingMutationDto>("POST", `${tournamentPath(tournamentId)}/tables`, input);

/** S3: rename, resize, or reopen an archived table. */
export const updateTable = (tournamentId: string, tableId: string, input: UpdateTableInput) =>
  apiSend<SeatingMutationDto>("PATCH", tablePath(tournamentId, tableId), input);

/** S4: a table nobody sits at; deleted if it never seated anyone, else archived. */
export const removeTable = (tournamentId: string, tableId: string) => apiSend<SeatingMutationDto>("DELETE", tablePath(tournamentId, tableId));

/** S5: its players drawn onto the other tables, and the table archived. */
export const breakTable = (tournamentId: string, tableId: string, input: BreakTableInput) =>
  apiSend<SeatingMutationDto>("POST", `${tablePath(tournamentId, tableId)}/break`, input);

/** S7: seats for everyone waiting (or the players named), or a redraw of everyone. */
export const drawSeats = (tournamentId: string, input: DrawSeatsInput) => apiSend<SeatingMutationDto>("POST", seatingPath(tournamentId, "draw"), input);

/** S8: a player into a chosen seat (moved if seated), or swapped with its occupant. */
export const assignSeat = (tournamentId: string, input: AssignSeatInput) =>
  apiSend<SeatingMutationDto>("POST", seatingPath(tournamentId, "assign"), input);

/** S9: a player out of their seat, to wait for another. */
export const unseatPlayer = (tournamentId: string, input: UnseatInput) =>
  apiSend<SeatingMutationDto>("POST", seatingPath(tournamentId, "unseat"), input);

/** S10: the balancing moves the seating suggested, if it is still the seating they were worked out for. */
export const balanceTables = (tournamentId: string, input: BalanceInput) =>
  apiSend<SeatingMutationDto>("POST", seatingPath(tournamentId, "balance"), input);

/** S11: everyone still in redrawn at one table; the others archived. */
export const drawFinalTable = (tournamentId: string, input: FinalTableInput) =>
  apiSend<SeatingMutationDto>("POST", seatingPath(tournamentId, "final-table"), input);

/** R5-S13: the advisor's "Open Table N", exactly as it was shown (the seating version it was worked out from). */
export const openTable = (tournamentId: string, input: OpenTableInput) =>
  apiSend<SeatingMutationDto>("POST", seatingPath(tournamentId, "open-table"), input);

/** Puts back everyone the last table break, draw, balance, final table or opened table moved, while the seats are as it left them. */
export const undoSeatingChange = (tournamentId: string, input: UndoSeatingInput) =>
  apiSend<SeatingMutationDto>("POST", seatingPath(tournamentId, "undo"), input);
