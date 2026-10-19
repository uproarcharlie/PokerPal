import { Router } from "express";
import {
  createPlayerSchema,
  playersQuerySchema,
  updatePlayerSchema,
  type CreatePlayerInput,
  type UpdatePlayerInput,
} from "@shared/api/players";
import type { Player } from "@shared/schema";
import { asyncHandler } from "../http/async-handler";
import {
  allowPublic,
  canManagePlayer,
  clubScope,
  currentUser,
  requireAuth,
  requirePlayerManager,
  type AuthUser,
} from "../http/authz";
import { badRequest, conflict } from "../http/errors";
import { parseOrThrow, validateBody } from "../http/validate";
import { addingClub, createPlayer, listStaffPlayers, toPublicPlayer, toStaffPlayer, updatePlayer } from "../services/players";
import { issueSignUpToken } from "../services/sign-up-tokens";
import type { RouteDeps } from "./index";

const INVALID = { message: "Invalid player data" };

const mayManage = async (user: AuthUser | undefined, player: Player): Promise<boolean> =>
  user !== undefined && (await canManagePlayer(user, player.id)) === true;

/**
 * 409 PHONE_TAKEN. The other player is named only to someone who may manage them, so the sign-up form
 * cannot be used to look up whose number is whose (SEC-09).
 */
async function phoneTaken(user: AuthUser | undefined, other: Player) {
  return conflict(
    "PHONE_TAKEN",
    "That phone number is already registered to another player. If it is yours, enter your name as you first registered it, or ask the tournament director.",
    (await mayManage(user, other)) ? { player: toPublicPlayer(other) } : undefined,
  );
}

/**
 * Players: the staff list (no longer public: SEC-09), sign-up from the QR page or the staff's Players
 * page (public, narrow: no userId, SEC-04; the club adding a new player becomes its home club) and
 * edits by an admin or the staff of the player's home club (canManagePlayer).
 */
export function playersRoutes({ env, limiters }: RouteDeps): Router {
  const router = Router();

  router.get("/api/players", requireAuth, asyncHandler(async (req, res) => {
    const query = parseOrThrow(playersQuerySchema, req.query);
    res.json(await listStaffPlayers(await clubScope(currentUser(req)), query));
  }));

  router.post(
    "/api/players",
    allowPublic("QR sign-up"),
    limiters.publicWrite,
    validateBody(createPlayerSchema, INVALID),
    asyncHandler<Record<string, string>, unknown, CreatePlayerInput>(async (req, res) => {
      // Anonymous sign-ups must give a number: it is how a returning player is recognised.
      if (!req.user && !/\d/.test(req.body.phone ?? "")) {
        throw badRequest(INVALID.message, "VALIDATION", [
          { code: "custom", path: ["phone"], message: "Enter your phone number" },
        ]);
      }
      const outcome = await createPlayer(env, req.body, { clubId: await addingClub(req.user, req.body) });
      if (outcome.kind === "phone_taken") throw await phoneTaken(req.user, outcome.other);
      // A new player's details are what the caller just typed; an existing one's only go to their staff.
      const full = req.user !== undefined && (outcome.kind === "created" || (await mayManage(req.user, outcome.player)));
      const player = full ? toStaffPlayer(outcome.player) : toPublicPlayer(outcome.player);
      // The caller typed this player's details, so they may sign them up for any tournament (P2REV0-02).
      const body = { ...player, signUpToken: issueSignUpToken(env, outcome.player.id) };
      if (outcome.kind === "existing") res.status(200).json({ ...body, existing: true });
      else res.status(201).json(body);
    }),
  );

  router.put(
    "/api/players/:id",
    requirePlayerManager(),
    validateBody(updatePlayerSchema, INVALID),
    asyncHandler<{ id: string }, unknown, UpdatePlayerInput>(async (req, res) => {
      const outcome = await updatePlayer(env, req, req.params.id, req.body);
      if (outcome.kind === "phone_taken") throw await phoneTaken(req.user, outcome.other);
      res.json(toStaffPlayer(outcome.player));
    }),
  );

  return router;
}
