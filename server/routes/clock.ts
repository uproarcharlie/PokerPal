import { Router } from "express";
import {
  clockActionSchema,
  clockConfigSchema,
  clockDisplaySettingsPatchSchema,
  earlyBirdsSchema,
  type ClockActionInput,
  type ClockConfigInput,
  type ClockDisplaySettingsPatch,
  type EarlyBirdsInput,
} from "@shared/api/clock";
import { asyncHandler } from "../http/async-handler";
import { clubFrom, requireClubManager, requireClubManagerOr } from "../http/authz";
import { validateBody } from "../http/validate";
import {
  changeDisplaySettings,
  clubBlindStructures,
  configureClock,
  issueClockKey,
  removeClock,
  revokeClockKey,
  runClockAction,
} from "../services/clock";
import { CLOCK_KEY } from "../services/clock-key";
import { setEarlyBirds } from "../services/early-birds";
import { liveDisplay, publicSeasonLeaderboard } from "../services/live-display";

/**
 * The tournament clock and the live display (phase4-contracts §3.2): the club staff's clock writes
 * and early birds under /api/tournaments/:id (open tournaments only: 409 TOURNAMENT_CLOSED), the
 * club's previous structures, and two public, PII-free, never-cached reads: the live display the TV,
 * the clock panel and the header chip poll, and the season leaderboard behind the TV's QR code.
 * Every clock write answers with the live display. The clock's actions also accept the venue TV's
 * clock key in place of a staff session (server/services/clock-key.ts); nothing else does. The
 * limiters are the app's: these paths count under `live` (the GETs) and `liveOps` (the writes), never
 * the venue's shared budget.
 */
export function clockRoutes(): Router {
  const router = Router();

  router.get("/api/public/tournaments/:id/display", asyncHandler(async (req, res) => {
    const display = await liveDisplay(req, req.params.id);
    res.set("Cache-Control", "no-store").json(display);
  }));

  router.get("/api/public/seasons/:id/leaderboard", asyncHandler(async (req, res) => {
    const leaderboard = await publicSeasonLeaderboard(req.params.id);
    res.set("Cache-Control", "no-store").json(leaderboard);
  }));

  router.put(
    "/api/tournaments/:id/clock",
    requireClubManager(clubFrom.tournament()),
    validateBody(clockConfigSchema),
    asyncHandler<{ id: string }, unknown, ClockConfigInput>(async (req, res) => {
      const { created, display } = await configureClock(req, req.params.id, req.body);
      res.status(created ? 201 : 200).json(display);
    }),
  );

  router.delete(
    "/api/tournaments/:id/clock",
    requireClubManager(clubFrom.tournament()),
    asyncHandler<{ id: string }>(async (req, res) => {
      res.json(await removeClock(req, req.params.id));
    }),
  );

  router.post(
    "/api/tournaments/:id/clock/actions",
    requireClubManagerOr(CLOCK_KEY, clubFrom.tournament()),
    validateBody(clockActionSchema),
    asyncHandler<{ id: string }, unknown, ClockActionInput>(async (req, res) => {
      res.json(await runClockAction(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/clock/key",
    requireClubManager(clubFrom.tournament()),
    asyncHandler<{ id: string }>(async (req, res) => {
      res.set("Cache-Control", "no-store").status(201).json(await issueClockKey(req, req.params.id));
    }),
  );

  router.delete(
    "/api/tournaments/:id/clock/key",
    requireClubManager(clubFrom.tournament()),
    asyncHandler<{ id: string }>(async (req, res) => {
      res.json(await revokeClockKey(req, req.params.id));
    }),
  );

  router.patch(
    "/api/tournaments/:id/clock/display",
    requireClubManager(clubFrom.tournament()),
    validateBody(clockDisplaySettingsPatchSchema),
    asyncHandler<{ id: string }, unknown, ClockDisplaySettingsPatch>(async (req, res) => {
      res.json(await changeDisplaySettings(req, req.params.id, req.body));
    }),
  );

  router.post(
    "/api/tournaments/:id/early-birds",
    requireClubManager(clubFrom.tournament()),
    validateBody(earlyBirdsSchema),
    asyncHandler<{ id: string }, unknown, EarlyBirdsInput>(async (req, res) => {
      res.json(await setEarlyBirds(req.params.id, req.body));
    }),
  );

  router.get(
    "/api/clubs/:id/blind-structures",
    requireClubManager(clubFrom.club()),
    asyncHandler<{ id: string }>(async (req, res) => {
      res.json(await clubBlindStructures(req.params.id));
    }),
  );

  return router;
}
