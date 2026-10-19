import { Router } from "express";
import { finalizePreviewSchema, finalizeSchema, type FinalizeInput, type FinalizePreviewInput } from "@shared/api/finalize";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, requireClubManager } from "../http/authz";
import { validateBody } from "../http/validate";
import { finalizeTournament, previewFinalize } from "../services/finalize";

/**
 * Finalizing a tournament: finishing positions, prizes and points (spec §5.2 #21-#22). Both need a
 * manager of the tournament's club (SEC-02). The preview writes nothing; finalize pays exactly what
 * the preview showed, or refuses with PLAN_CHANGED when the expected plan hash no longer matches.
 */
export function finalizeRoutes(): Router {
  const router = Router();

  router.post(
    "/api/tournaments/:id/finalize/preview",
    requireClubManager(clubFrom.tournament()),
    validateBody(finalizePreviewSchema),
    asyncHandler<{ id: string }, unknown, FinalizePreviewInput>(async (req, res) => {
      res.json(await previewFinalize(req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/finalize",
    requireClubManager(clubFrom.tournament()),
    validateBody(finalizeSchema),
    asyncHandler<{ id: string }, unknown, FinalizeInput>(async (req, res) => {
      res.json(await finalizeTournament(req, req.params.id, req.body));
    }),
  );

  return router;
}
