/**
 * The clock's changes and its one staff read (phase4-contracts §3.2, C2–C7): set up or edit the
 * structure, the clock's actions, the TV's settings, removing the clock, early birds, and the club's
 * recent structures to copy. Every clock change answers with the fresh live display, which also feeds
 * the server-time estimate. Staff only: apart from api.ts so the TV page never loads them.
 */
import { queryOptions } from "@tanstack/react-query";
import type {
  BlindStructureSourceDto,
  ClockActionInput,
  ClockConfigInput,
  ClockDisplaySettingsPatch,
  EarlyBirdsInput,
  EarlyBirdsResultDto,
} from "@shared/api/clock";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { apiGet, apiSend, segment, type SendMethod } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { tournamentPath } from "@/features/tournaments/api";
import { withServerTime } from "./server-time";

const clockPath = (tournamentId: string, rest = "") => `${tournamentPath(tournamentId)}/clock${rest}`;

const sendForDisplay = (method: SendMethod, url: string, body?: unknown) => withServerTime(() => apiSend<LiveDisplayDto>(method, url, body));

export const blindStructureQueries = {
  /** The club's recent tournaments' structures (staff; distinct ones, newest first), for "Copy from a previous game". */
  list: (clubId: string) =>
    queryOptions({
      queryKey: qk.clubs.blindStructures(clubId),
      queryFn: ({ signal }) => apiGet<BlindStructureSourceDto[]>(`/api/clubs/${segment(clubId)}/blind-structures`, { signal }),
    }),
};

/** Sets the clock up (baseHash null) or replaces its structure (baseHash: the structure the edit started from). */
export const saveClock = (tournamentId: string, input: ClockConfigInput) => sendForDisplay("PUT", clockPath(tournamentId), input);

/** One clock action (start, pause, next, +1 min, undo…), with the level or status the device showed. */
export const sendClockAction = (tournamentId: string, input: ClockActionInput) => sendForDisplay("POST", clockPath(tournamentId, "/actions"), input);

/** Changes what the TV shows. */
export const patchClockDisplay = (tournamentId: string, patch: ClockDisplaySettingsPatch) =>
  sendForDisplay("PATCH", clockPath(tournamentId, "/display"), patch);

/** Removes the clock (nothing to remove is not an error). */
export const removeClock = (tournamentId: string) => sendForDisplay("DELETE", clockPath(tournamentId));

/** Gives (or takes back) the early-bird bonus chips for these entries. */
export const setEarlyBirds = (tournamentId: string, input: EarlyBirdsInput) =>
  apiSend<EarlyBirdsResultDto>("POST", `${tournamentPath(tournamentId)}/early-birds`, input);
