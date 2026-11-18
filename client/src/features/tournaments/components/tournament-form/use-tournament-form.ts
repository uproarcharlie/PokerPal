import { useState } from "react";
import { useForm, type Path } from "react-hook-form";
import type { ErrorCode } from "@shared/api/errors";
import { showServerFieldErrors, formResolver } from "@/lib/forms";
import { highHandProblem, isHighHandField } from "../../high-hands-form";
import {
  inClubZone,
  NEW_TOURNAMENT_VALUES,
  tournamentConfig,
  tournamentFormSchema,
  type TournamentConfig,
  type TournamentFormValues,
} from "../../tournament-form";

const FIELDS = Object.keys(NEW_TOURNAMENT_VALUES) as string[];

/** A box of the form: a setting, or one of a high hand's ("highHands.1.entryFee"). */
const isFormField = (name: string) => FIELDS.includes(name) || isHighHandField(name);

/** Refusals about one field that the server names by code rather than by path. */
const FIELD_CODES: Partial<Record<ErrorCode, Path<TournamentFormValues>>> = {
  SEASON_NOT_IN_CLUB: "seasonId",
  POINTS_SYSTEM_NOT_IN_SEASON: "pointsSystemId",
  // A part switched off while entries are recorded at its price (P3REV0-PARITY-EDIT-REPRICE).
  REBUYS_RECORDED: "enableRebuys",
  ADDONS_RECORDED: "enableAddons",
};

/** What the points switch says for a game with no season (round 7). */
export const ONE_OFF_NO_POINTS = "No points — one-off game";

/**
 * Why the form's points switch is off whatever it holds, or undefined while it can be used: a one-off
 * game (no season) has no points system, and points are scored only with one (the server stores
 * trackPoints false without a points system).
 */
export function pointsOffReason({ seasonId, pointsSystemId }: Pick<TournamentFormValues, "seasonId" | "pointsSystemId">): string | undefined {
  if (!seasonId) return ONE_OFF_NO_POINTS;
  if (!pointsSystemId) return "Choose a points system to track points";
  return undefined;
}

/**
 * The checked settings to send for the form's values (they have passed the resolver), the start read on
 * the club's wall clock (`timeZone`). A one-off game (no season) sends no points system, and points are
 * sent on only with a points system (pointsOffReason), as the server stores them.
 */
export function configFromValues(values: TournamentFormValues, timeZone: string): TournamentConfig {
  const config = tournamentConfig(tournamentFormSchema.parse(inClubZone(values, timeZone)));
  const pointsSystemId = config.seasonId ? (config.pointsSystemId ?? null) : null;
  return { ...config, pointsSystemId, trackPoints: config.trackPoints === true && pointsSystemId !== null };
}

/**
 * The tournament form's state: checked by the shared schema, the values left as typed (the submit
 * builds the request body from them), whether an image is still uploading (Save waits for it), and a
 * way to put a server refusal on its field: a high hand's (its awards no longer fit its pot, players
 * are in it: `details.highHandId`) on that high hand's card.
 */
export function useTournamentForm(defaultValues: TournamentFormValues) {
  const form = useForm<TournamentFormValues>({
    resolver: formResolver(tournamentFormSchema),
    defaultValues,
  });
  const [uploading, setUploading] = useState(false);
  const showServerError = (error: unknown) => {
    const problem = highHandProblem(error, form.getValues("highHands"));
    if (problem) {
      form.setError(`highHands.${problem.index}`, { type: "server", message: problem.message });
      return true;
    }
    return showServerFieldErrors(form.setError, error, { fields: isFormField, codes: FIELD_CODES });
  };
  return { form, uploading, setUploading, showServerError };
}
