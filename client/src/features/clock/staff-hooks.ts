/**
 * The clock's changes, for the club's staff: the clock's actions, its structure and TV settings, early
 * birds, and the structures to copy. Every clock change answers with the live display as it now is, and
 * every refusal over the clock (409) carries it too: both go straight into the display's cache, so the
 * screen that lost a race shows the clock as it is at once (phase4-contracts §3.2). A poll already on
 * its way is cancelled first, so its older answer cannot overwrite the newer one.
 */
import { useEffect, useReducer, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ClockActionInput, ClockConfigInput, ClockDisplaySettingsPatch, ClockUndoDto, EarlyBirdsInput } from "@shared/api/clock";
import type { ClockConflictDetails, LiveDisplayDto } from "@shared/api/live-display";
import type { PublicRegistration } from "@shared/api/public";
import type { ConfirmedRegistrationDto, PendingRegistrationDto } from "@shared/api/registrations";
import { CLOCK_LIMITS, undoAvailable, type ClockStatus } from "@shared/domain/clock";
import { useBusyRows } from "@/hooks/use-busy-rows";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, hasErrorCode, isApiError } from "@/lib/api/http";
import { invalidateTournament } from "@/lib/api/invalidate";
import { qk } from "@/lib/api/query-keys";
import { deriveDisplayClock } from "./hooks";
import { serverTime } from "./server-time";
import { blindStructureQueries, patchClockDisplay, removeClock, saveClock, sendClockAction, setEarlyBirds } from "./staff-api";

type WithoutExpectations<T> = T extends unknown ? Omit<T, "expectedLevelIndex" | "expectedStatus"> : never;

/** A clock action as a control asks for it; the level or status the screen showed is added by `clockRequest`. */
export type ClockIntent = WithoutExpectations<ClockActionInput>;

/** What the screen showed when the control was used. */
export interface ShownClock {
  levelIndex: number;
  status: ClockStatus;
  /** For Undo: what the screen offered to undo (or redo), null for nothing (useUndoOffer). */
  undo?: ClockUndoDto | null;
}

/**
 * What Undo offers now: the clock's undo while it still works on the server's time (undoAvailable:
 * within the two minutes, the clock still on the level the change left it on), else null. Re-checked
 * the moment it lapses, so a paused clock's screen, which draws nothing new each second, greys Undo
 * out on time too.
 */
export function useUndoOffer(undo: ClockUndoDto | null, levelIndex: number): ClockUndoDto | null {
  const [, recheck] = useReducer((checks: number) => checks + 1, 0);
  const offered = undoAvailable(undo, levelIndex, serverTime.now()) ? undo : null;
  useEffect(() => {
    if (!offered) return;
    const timer = setTimeout(recheck, Math.max(0, offered.expiresAt - serverTime.now()) + 1);
    return () => clearTimeout(timer);
  }, [offered]);
  return offered;
}

/** The request went but no answer came back (a dropped connection, or SEND_TIMEOUT_MS): whether the server made the change is unknown. */
const isNoAnswer = (error: unknown) => isApiError(error) && error.status === 0;

/** Said when a clock action got no answer: the clock may or may not have changed. */
const NO_ANSWER_TOAST = {
  title: "No answer from the server",
  description: "The change may have been made: check the clock before trying again.",
  variant: "destructive",
} as const;

/** Said when Undo is asked for with nothing on screen to undo (the TV's U key; the button is greyed out then). */
const NOTHING_TO_UNDO_TOAST = {
  title: "Nothing to undo",
  description: `A clock change can be undone for ${String(CLOCK_LIMITS.undoWindowMs / 60_000)} minutes, until the clock moves to the next level by itself.`,
};

/**
 * The request for `intent`: next, prev, jump, adjust and set_remaining always carry the level the screen
 * showed, toggle the status it showed, and undo the undo it showed, so a double tap or a second device
 * never skips a level, pauses a clock someone just paused (spec D7), or redoes the change a first Undo
 * (or another screen's) just took back: the server leaves the clock alone when the undo it holds is
 * another (TDN2-UNDO-REDO-TRAP).
 */
export function clockRequest(intent: ClockIntent, shown: ShownClock): ClockActionInput {
  switch (intent.action) {
    case "next":
    case "prev":
    case "jump":
    case "adjust":
    case "set_remaining":
      return { ...intent, expectedLevelIndex: shown.levelIndex };
    case "toggle":
      return shown.status === "finished" ? intent : { ...intent, expectedStatus: shown.status };
    case "undo":
      return shown.undo ? { ...intent, expectedUndo: { at: shown.undo.at, redo: shown.undo.redo } } : intent;
    default:
      return intent;
  }
}

/** The display a clock refusal carries (every 409 over the clock has one), or null. */
export function conflictDisplay(error: unknown): LiveDisplayDto | null {
  if (!isApiError(error) || error.status !== 409 || typeof error.details !== "object" || error.details === null) return null;
  const display = (error.details as Partial<ClockConflictDetails>).display;
  return typeof display === "object" && display !== null && typeof display.serverNow === "number" ? display : null;
}

const displayKey = (tournamentId: string) => qk.tournaments.display(tournamentId);

/** Puts the server's answer on screen, after cancelling a poll that could bring an older one. */
async function applyDisplay(queryClient: QueryClient, tournamentId: string, display: LiveDisplayDto): Promise<void> {
  await queryClient.cancelQueries({ queryKey: displayKey(tournamentId), exact: true });
  queryClient.setQueryData(displayKey(tournamentId), display);
}

/**
 * After a refusal: the display it carries goes on screen; a refusal without one (the clock was removed,
 * the tournament closed) asks for the display again, so the screen catches up at once.
 */
async function applyRefusal(queryClient: QueryClient, tournamentId: string, error: unknown): Promise<LiveDisplayDto | null> {
  const current = conflictDisplay(error);
  if (current) await applyDisplay(queryClient, tournamentId, current);
  else void queryClient.invalidateQueries({ queryKey: displayKey(tournamentId), exact: true });
  return current;
}

/**
 * What else a clock change touches: the activity feed (manual clock actions and structure edits are
 * logged), and everything about the tournament when the change also started it.
 */
function refreshAround(queryClient: QueryClient, tournamentId: string, before: LiveDisplayDto | undefined, after: LiveDisplayDto): void {
  if (before !== undefined && before.tournament.status !== after.tournament.status) {
    void invalidateTournament(queryClient, tournamentId);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: qk.tournaments.activity(tournamentId) });
}

/** The level the cached display shows now, to tell whether a LEVEL_CHANGED refusal is news to the screen. */
const shownLevel = (display: LiveDisplayDto | undefined) => deriveDisplayClock(display, serverTime.now())?.levelIndex ?? null;

/** Next, previous and jump: a second tap of one is refused once the first has moved the level. */
const movesLevel = (input: ClockActionInput) => input.action === "next" || input.action === "prev" || input.action === "jump";

/** One clock action as sent: `quiet` when the caller words the refusal itself (a dialog shows it). */
interface ClockRequest {
  input: ClockActionInput;
  quiet: boolean;
}

/**
 * The clock's controls. `send(intent, shown)` resolves true when the server took the action (or had
 * nothing to do) and false when it refused, which it says in a toast; `perform(intent, shown)` resolves
 * with the display and rejects with the refusal, for a dialog that shows it (Set time, Reset). Undo
 * names the undo the screen showed (`shown.undo`), and is not sent without one. Each
 * action's button is busy while its own request runs (`busy` holds the action names), so Pause still
 * works while a Next is on its way. Answers are put on screen one after another, in the order they came
 * back, so a double tap's refusal is judged against the level its first tap already put there.
 */
export function useClockActions(tournamentId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { busy, run } = useBusyRows();
  const applying = useRef<Promise<void>>(Promise.resolve());
  const inTurn = (work: () => Promise<void>) => (applying.current = applying.current.then(work, work));
  const mutation = useMutation({
    mutationFn: ({ input }: ClockRequest) => sendClockAction(tournamentId, input),
    onSuccess: (display) =>
      inTurn(async () => {
        const before = queryClient.getQueryData<LiveDisplayDto>(displayKey(tournamentId));
        await applyDisplay(queryClient, tournamentId, display);
        refreshAround(queryClient, tournamentId, before, display);
      }),
    onError: (error, { input, quiet }) =>
      inTurn(async () => {
        const shownBefore = shownLevel(queryClient.getQueryData<LiveDisplayDto>(displayKey(tournamentId)));
        const current = await applyRefusal(queryClient, tournamentId, error);
        if (quiet) return;
        if (hasErrorCode(error, "LEVEL_CHANGED")) {
          // A double tap of Next: the first tap's level is already on screen, so the second's refusal says
          // nothing new. A minute added or a time set on a level that has gone was not done: that is news.
          if (movesLevel(input) && current && shownLevel(current) === shownBefore) return;
          toast({ title: "The clock moved on — check the level", variant: "destructive" });
          return;
        }
        // No answer is not a refusal: the server may have made the change and the answer been lost on the
        // venue's Wi-Fi. The screen asks for the clock again (applyRefusal), so the TD checks it rather than
        // pressing again and adding a second minute (TDN3-TIMEOUT-TOAST).
        if (isNoAnswer(error)) toast(NO_ANSWER_TOAST);
        else toast({ title: "The clock did not change", description: errorMessage(error), variant: "destructive" });
      }),
  });
  const perform = (intent: ClockIntent, shown: ShownClock): Promise<LiveDisplayDto> =>
    run(intent.action, () => mutation.mutateAsync({ input: clockRequest(intent, shown), quiet: true }));
  const send = (intent: ClockIntent, shown: ShownClock): Promise<boolean> => {
    // Never an undo of a change this screen did not show: one made on another device a poll ago.
    if (intent.action === "undo" && !shown.undo) {
      toast(NOTHING_TO_UNDO_TOAST);
      return Promise.resolve(false);
    }
    return run(intent.action, () => mutation.mutateAsync({ input: clockRequest(intent, shown), quiet: false })).then(
      () => true,
      () => false,
    );
  };
  return { send, perform, busy };
}

/** The clock a refusal's display shows now (the level a LEVEL_CHANGED moved on to), or null. */
export const clockAfterRefusal = (error: unknown) => deriveDisplayClock(conflictDisplay(error) ?? undefined, serverTime.now());

/**
 * Setting the clock up, editing its structure, changing the TV's settings and removing the clock. Each
 * answer (and each refusal's display) goes on screen; the caller words the outcome, since a structure
 * refusal belongs on the editor.
 */
export function useClockConfig(tournamentId: string) {
  const queryClient = useQueryClient();
  const settle = {
    onSuccess: async (display: LiveDisplayDto) => {
      const before = queryClient.getQueryData<LiveDisplayDto>(displayKey(tournamentId));
      await applyDisplay(queryClient, tournamentId, display);
      refreshAround(queryClient, tournamentId, before, display);
    },
    onError: async (error: unknown) => {
      await applyRefusal(queryClient, tournamentId, error);
    },
  };
  const save = useMutation({ mutationFn: (input: ClockConfigInput) => saveClock(tournamentId, input), ...settle });
  const remove = useMutation({ mutationFn: () => removeClock(tournamentId), ...settle });
  const patchDisplay = useMutation({ mutationFn: (patch: ClockDisplaySettingsPatch) => patchClockDisplay(tournamentId, patch), ...settle });
  return { save, remove, patchDisplay };
}

/**
 * Early birds: the entries the answer names take the new flag at once in every list that shows them
 * (the Clock tab's ticks and the payment desk's switches follow the server without waiting for a
 * refetch), then the tournament is refreshed for the chip figures.
 */
export function useEarlyBirds(tournamentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EarlyBirdsInput) => setEarlyBirds(tournamentId, input),
    onSuccess: (result, input) => {
      const changed = new Set(result.changed);
      const flag = <T extends { id: string; earlyBird: boolean }>(list: T[] | undefined) =>
        list?.map((registration) => (changed.has(registration.id) ? { ...registration, earlyBird: input.earlyBird } : registration));
      queryClient.setQueryData<PublicRegistration[]>(qk.tournaments.registrations(tournamentId), flag);
      queryClient.setQueryData<PendingRegistrationDto[]>(qk.tournaments.pendingRegistrations(tournamentId), flag);
      queryClient.setQueryData<ConfirmedRegistrationDto[]>(qk.tournaments.confirmedRegistrations(tournamentId), flag);
      void invalidateTournament(queryClient, tournamentId);
    },
  });
}

/** The club's recent structures to copy (staff), asked for only when wanted. */
export function useBlindStructures(clubId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...blindStructureQueries.list(clubId), enabled: enabled && Boolean(clubId) });
}
