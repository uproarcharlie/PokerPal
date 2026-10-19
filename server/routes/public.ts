import { Router } from "express";
import { publicPlayerSearchQuerySchema } from "@shared/api/public";
import { asyncHandler } from "../http/async-handler";
import { isAdmin, viewerFor } from "../http/authz";
import { parseOrThrow } from "../http/validate";
import { searchPlayers, type PlayerSearchScope } from "../services/players";
import { requireTournament } from "../services/tournaments";

/** Anonymous reads under /api/public. */
export function publicRoutes(): Router {
  const router = Router();

  /**
   * The QR register page's "find yourself": PublicPlayer only (SEC-09, security-13). Visitors search the
   * players known at this tournament's club (registered there, or added by it). Its staff also find
   * players known at other clubs, to register a visitor (which grants them nothing over that player:
   * their home club is already recorded); a player no club has added or registered is found only by an
   * admin, so nobody can make themselves that player's home club (SEC-P2-01).
   */
  router.get("/api/public/tournaments/:id/players", asyncHandler(async (req, res) => {
    const query = parseOrThrow(publicPlayerSearchQuerySchema, req.query);
    const tournament = await requireTournament(req.params.id);
    const { canManage } = await viewerFor(req, tournament.clubId);
    const scope: PlayerSearchScope = isAdmin(req.user) ? "all" : canManage ? "known" : { clubId: tournament.clubId };
    res.json(await searchPlayers({ q: query.q, limit: query.limit, scope }));
  }));

  return router;
}
