/**
 * What a player reads when the server refuses something on the QR pages, by error code, in words
 * for someone at the venue on their phone. A code with no entry shows the server's own sentence.
 */
import type { ErrorCode } from "@shared/api/errors";
import { errorMessage, isApiError } from "@/lib/api/http";

type Messages = Partial<Record<ErrorCode, string>>;

const SPEAK_TO_TD = "Please speak to the tournament director.";
const TOO_MANY = "Too many requests from this network just now. Please wait a few minutes and try again, or ask the tournament director.";

export const REGISTRATION_CLOSED_MESSAGE = "Registration for this tournament has closed.";
export const POOL_LOCKED_REGISTRATION_MESSAGE = `Registration has closed: the prize pool is locked. ${SPEAK_TO_TD}`;

/** POST /api/tournaments/:id/registrations. A sign-up past Max players is never refused: it joins the waiting list (round 5, item 15). */
const REGISTRATION_PROBLEMS: Messages = {
  ALREADY_REGISTERED: "You're already registered for this tournament. See you at the table!",
  HIGH_HAND_AWARDED: 'Every high-hand prize has already been won tonight. Choose "No thanks" and try again.',
  TOURNAMENT_CLOSED: REGISTRATION_CLOSED_MESSAGE,
  PRIZE_POOL_LOCKED: POOL_LOCKED_REGISTRATION_MESSAGE,
  HIGH_HAND_NOT_AVAILABLE: 'High hands isn\'t available for this tournament. Choose "No thanks" and try again.',
  PLAYER_NOT_FOUND: "We couldn't find that player. Go back and search again, or register as a new player.",
  NOT_FOUND: "This tournament no longer exists. Please check the link with the tournament director.",
  RATE_LIMITED: TOO_MANY,
};

/** POST /api/players (the sign-up step); PHONE_TAKEN and field problems go on their fields instead. */
const SIGN_UP_PROBLEMS: Messages = {
  TOURNAMENT_CLOSED: REGISTRATION_CLOSED_MESSAGE,
  NOT_FOUND: "This tournament no longer exists. Please check the link with the tournament director.",
  RATE_LIMITED: TOO_MANY,
};

/** POST /api/tournaments/:id/pending-actions */
const REQUEST_PROBLEMS: Messages = {
  DUPLICATE_PENDING_ACTION: "That request is already waiting for the tournament director, who will confirm it at the desk.",
  PLAYER_NOT_REGISTERED: `That player isn't registered for this tournament. ${SPEAK_TO_TD}`,
  PLAYER_ELIMINATED: "That player is already out of the tournament.",
  PRIZE_POOL_LOCKED: `Re-buys and add-ons have closed: the prize pool is locked. ${SPEAK_TO_TD}`,
  NOT_FOUND: "This tournament no longer exists.",
  RATE_LIMITED: TOO_MANY,
};

const FALLBACK = "Please try again, or speak to the tournament director.";

function problem(messages: Messages, error: unknown): string {
  const known = isApiError(error) && error.code ? messages[error.code] : undefined;
  return known ?? errorMessage(error, FALLBACK);
}

export const registrationProblem = (error: unknown) => problem(REGISTRATION_PROBLEMS, error);
export const signUpProblem = (error: unknown) => problem(SIGN_UP_PROBLEMS, error);
export const requestProblem = (error: unknown) => problem(REQUEST_PROBLEMS, error);
