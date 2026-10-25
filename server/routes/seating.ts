import { Router } from "express";
import {
  assignSeatSchema,
  balanceSchema,
  breakTableSchema,
  createTablesSchema,
  drawSeatsSchema,
  finalTableSchema,
  openTableSchema,
  seatingSetupSchema,
  undoSeatingSchema,
  unseatSchema,
  updateTableSchema,
  type AssignSeatInput,
  type BalanceInput,
  type BreakTableInput,
  type CreateTablesInput,
  type DrawSeatsInput,
  type FinalTableInput,
  type OpenTableInput,
  type SeatingSetupInput,
  type UndoSeatingInput,
  type UnseatInput,
  type UpdateTableInput,
} from "@shared/api/seating";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, requireClubManager } from "../http/authz";
import { validateBody } from "../http/validate";
import {
  addTables,
  assignSeat,
  balanceTables,
  breakTable,
  drawFinalTable,
  drawSeats,
  getPublicSeating,
  getSeating,
  openTable,
  removeTable,
  setUpSeating,
  undoSeatingChange,
  unseatPlayer,
  updateTable,
} from "../services/seating";

type TournamentParams = { id: string };
type TableParams = { id: string; tableId: string };

/**
 * Tables and seating (phase4-contracts §3.1): the staff read and writes under
 * /api/tournaments/:id/{seating,tables} need a manager of the tournament's club, and the writes an
 * open tournament (409 TOURNAMENT_CLOSED once completed or cancelled); the seat finder
 * GET /api/public/tournaments/:id/seating is anyone's (PublicPlayer only). The reads are never cached.
 * The app counts these against its `live` / `liveOps` limiters; this module mounts none.
 */
export function seatingRoutes(): Router {
  const router = Router();

  router.get("/api/tournaments/:id/seating", requireClubManager(clubFrom.tournament()), asyncHandler<TournamentParams>(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await getSeating(req.params.id));
  }));

  router.post(
    "/api/tournaments/:id/tables",
    requireClubManager(clubFrom.tournament()),
    validateBody(createTablesSchema),
    asyncHandler<TournamentParams, unknown, CreateTablesInput>(async (req, res) => {
      res.status(201).json(await addTables(req.params.id, req.body));
    }),
  );

  router.patch(
    "/api/tournaments/:id/tables/:tableId",
    requireClubManager(clubFrom.tournament()),
    validateBody(updateTableSchema),
    asyncHandler<TableParams, unknown, UpdateTableInput>(async (req, res) => {
      res.json(await updateTable(req.params.id, req.params.tableId, req.body));
    }),
  );

  router.delete("/api/tournaments/:id/tables/:tableId", requireClubManager(clubFrom.tournament()), asyncHandler<TableParams>(async (req, res) => {
    res.json(await removeTable(req.params.id, req.params.tableId));
  }));

  router.post(
    "/api/tournaments/:id/tables/:tableId/break",
    requireClubManager(clubFrom.tournament()),
    validateBody(breakTableSchema),
    asyncHandler<TableParams, unknown, BreakTableInput>(async (req, res) => {
      res.json(await breakTable(req, req.params.id, req.params.tableId, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/seating/setup",
    requireClubManager(clubFrom.tournament()),
    validateBody(seatingSetupSchema),
    asyncHandler<TournamentParams, unknown, SeatingSetupInput>(async (req, res) => {
      res.status(201).json(await setUpSeating(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/seating/draw",
    requireClubManager(clubFrom.tournament()),
    validateBody(drawSeatsSchema),
    asyncHandler<TournamentParams, unknown, DrawSeatsInput>(async (req, res) => {
      res.json(await drawSeats(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/seating/assign",
    requireClubManager(clubFrom.tournament()),
    validateBody(assignSeatSchema),
    asyncHandler<TournamentParams, unknown, AssignSeatInput>(async (req, res) => {
      res.json(await assignSeat(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/seating/unseat",
    requireClubManager(clubFrom.tournament()),
    validateBody(unseatSchema),
    asyncHandler<TournamentParams, unknown, UnseatInput>(async (req, res) => {
      res.json(await unseatPlayer(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/seating/balance",
    requireClubManager(clubFrom.tournament()),
    validateBody(balanceSchema),
    asyncHandler<TournamentParams, unknown, BalanceInput>(async (req, res) => {
      res.json(await balanceTables(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/seating/final-table",
    requireClubManager(clubFrom.tournament()),
    validateBody(finalTableSchema),
    asyncHandler<TournamentParams, unknown, FinalTableInput>(async (req, res) => {
      res.json(await drawFinalTable(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/seating/open-table",
    requireClubManager(clubFrom.tournament()),
    validateBody(openTableSchema),
    asyncHandler<TournamentParams, unknown, OpenTableInput>(async (req, res) => {
      res.status(201).json(await openTable(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/seating/undo",
    requireClubManager(clubFrom.tournament()),
    validateBody(undoSeatingSchema),
    asyncHandler<TournamentParams, unknown, UndoSeatingInput>(async (req, res) => {
      res.json(await undoSeatingChange(req, req.params.id, req.body));
    }),
  );

  router.get("/api/public/tournaments/:id/seating", asyncHandler<TournamentParams>(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await getPublicSeating(req.params.id));
  }));

  return router;
}
