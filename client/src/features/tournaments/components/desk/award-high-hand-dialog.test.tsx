import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { qk } from "@/lib/api/query-keys";
import { registrationDto, tournamentDto } from "@test/helpers/f1-tournaments";
import { awardResult, FIRST_HALF, hostPhone, listedTournament, SECOND_HALF, standingOf, win } from "@test/helpers/r10-high-hands";
import { LEGACY_HIGH_HAND_ID } from "@shared/domain/high-hands";
import type { PublicRegistration } from "@shared/api/public";
import type { HighHandStanding } from "@shared/domain/high-hands";
import type { PotCheck } from "../../staff-hooks";
import { AwardHighHandDialog } from "./award-high-hand-dialog";

/** A game with its one high hand of before round 10 (the legacy columns). */
const legacyGame = tournamentDto({ enableHighHand: true, highHandAmount: "10.00" });
const LEGACY = { id: LEGACY_HIGH_HAND_ID, name: "High hand" };

const entrant = (id: string, name: string, extra: Parameters<typeof registrationDto>[3] = {}) =>
  registrationDto(id, name, 1, { enteringHighHands: true, ...extra });

interface Shown {
  standings: HighHandStanding[];
  registrations: PublicRegistration[];
  tournament?: typeof legacyGame;
  potCheck?: PotCheck;
  onCheckPot?: () => void;
  onOpenChange?: (open: boolean) => void;
}

function show({ standings, registrations, tournament = legacyGame, potCheck = "current", onCheckPot = () => {}, onOpenChange = () => {} }: Shown) {
  const user = userEvent.setup();
  const rendered = renderWithApp(
    <AwardHighHandDialog open onOpenChange={onOpenChange} tournament={tournament} registrations={registrations} standings={standings} potCheck={potCheck} onCheckPot={onCheckPot} />,
  );
  return { user, ...rendered };
}

/** Records each award POSTed to `highHandId`, answered as the server would. */
function recordAwards(highHandId: string, registrations: readonly PublicRegistration[], amountCents = 1_500) {
  const sent: unknown[] = [];
  server.use(
    http.post(`/api/tournaments/t1/high-hands/${highHandId}/awards`, async ({ request }) => {
      const body = (await request.json()) as { registrationId: string };
      sent.push(body);
      const winner = registrations.find((registration) => registration.id === body.registrationId) ?? registrations[0];
      return HttpResponse.json(awardResult(winner, highHandId, amountCents), { status: 201 });
    }),
  );
  return sent;
}

async function choosePlayer(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("combobox", { name: "Player" }));
  await user.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("AwardHighHandDialog, one high hand (TN2-04, as before round 10)", () => {
  it("records a tie once every prize is awarded: the new winner shares a winner's prize, half each", async () => {
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "30.00" }), entrant("r2", "Bea")];
    const sent = recordAwards(LEGACY_HIGH_HAND_ID, registrations);
    const { user } = show({ registrations, standings: [standingOf(LEGACY, { netCents: 3_000, awards: [{ registrationId: "r1", amountCents: 3_000 }] })] });

    expect(screen.getByRole("heading", { name: "Assign High Hand Winner" })).toBeInTheDocument();
    // With every prize awarded, nothing can be assigned until the tie is chosen.
    await choosePlayer(user, "Bea");
    expect(screen.getByTestId("assign-high-hand")).toBeDisabled();

    await user.click(screen.getByTestId("split-with"));
    await user.click(await screen.findByRole("option", { name: "Split with Ann ($30)" }));
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("15.00");
    await user.click(screen.getByTestId("assign-high-hand"));

    await waitFor(() => expect(sent).toEqual([{ registrationId: "r2", splitWith: "r1" }]));
  });

  it("refreshes the tournament after an award: a tie adds a prize, which the next award is worked out from (P2REV1-03)", async () => {
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "100.00" }), entrant("r2", "Bea")];
    recordAwards(LEGACY_HIGH_HAND_ID, registrations, 5_000);
    const { user, queryClient } = show({ registrations, standings: [standingOf(LEGACY, { netCents: 10_000, awards: [{ registrationId: "r1", amountCents: 10_000 }] })] });
    queryClient.setQueryData(qk.tournaments.detail("t1"), { id: "t1", highHandPayouts: 2 });

    await choosePlayer(user, "Bea");
    await user.click(screen.getByTestId("split-with"));
    await user.click(await screen.findByRole("option", { name: "Split with Ann ($100)" }));
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("50.00");
    await user.click(screen.getByTestId("assign-high-hand"));

    await waitFor(() => expect(queryClient.getQueryState(qk.tournaments.detail("t1"))?.isInvalidated).toBe(true));
    expect(await screen.findByText("High hand split: Bea gets $50")).toBeInTheDocument();
  });

  it("adds money paid into the pot after every prize was awarded to the winner the TD picks (R6REV0-MONEY-01)", async () => {
    let sent: { id: unknown; body: unknown } | undefined;
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "40.00" }), entrant("r2", "Bea")];
    server.use(
      http.patch("/api/tournaments/t1/high-hands/legacy/awards/:registrationId", async ({ request, params }) => {
        sent = { id: params.registrationId, body: await request.json() };
        return HttpResponse.json(awardResult(registrations[0], LEGACY_HIGH_HAND_ID, 4_500));
      }),
    );
    const onOpenChange = vi.fn();
    const { user } = show({ registrations, onOpenChange, standings: [standingOf(LEGACY, { netCents: 4_500, awards: [{ registrationId: "r1", amountCents: 4_000 }] })] });

    expect(screen.getByTestId("high-hand-top-up")).toHaveTextContent("$5 not awarded yet");
    await user.click(screen.getByRole("button", { name: "Add $5 to Ann's prize" }));

    await waitFor(() => expect(sent).toEqual({ id: "r1", body: { amount: "45.00" } }));
    expect(await screen.findByText("Ann's high hand is now $45")).toBeInTheDocument();
    expect(screen.getByText("Pay them the $5 more.")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers no top-up while prizes are still to come or nothing is left over", () => {
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "40.00" }), entrant("r2", "Bea")];
    const { unmount } = show({ registrations, standings: [standingOf(LEGACY, { netCents: 5_500, winners: 2, awards: [{ registrationId: "r1", amountCents: 4_000 }] })] });
    expect(screen.queryByTestId("high-hand-top-up")).not.toBeInTheDocument();
    unmount();

    show({ registrations, standings: [standingOf(LEGACY, { netCents: 4_000, awards: [{ registrationId: "r1", amountCents: 4_000 }] })] });
    expect(screen.queryByTestId("high-hand-top-up")).not.toBeInTheDocument();
  });

  it("awards the next prize by default while prizes are left", async () => {
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "15.00" }), entrant("r2", "Bea")];
    const sent = recordAwards(LEGACY_HIGH_HAND_ID, registrations);
    const { user } = show({ registrations, standings: [standingOf(LEGACY, { netCents: 3_000, winners: 2, awards: [{ registrationId: "r1", amountCents: 1_500 }] })] });

    await choosePlayer(user, "Bea");
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("15.00");
    await user.click(screen.getByTestId("assign-high-hand"));

    await waitFor(() => expect(sent).toEqual([{ registrationId: "r2" }]));
    expect(await screen.findByText("Bea wins the high hand: $15")).toBeInTheDocument();
  });

  it("takes back a win given by mistake, once asked", async () => {
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "15.00" }), entrant("r2", "Bea")];
    let deleted: unknown;
    server.use(
      http.delete("/api/tournaments/t1/high-hands/legacy/awards/:registrationId", ({ params }) => {
        deleted = params.registrationId;
        return HttpResponse.json({ highHandId: "legacy", awards: [], nextAwardCents: 1_500, unawardedCents: 0 });
      }),
    );
    const { user } = show({ registrations, standings: [standingOf(LEGACY, { netCents: 1_500, awards: [{ registrationId: "r1", amountCents: 1_500 }] })] });

    await user.click(screen.getByRole("button", { name: "Take back Ann's high hand win" }));
    const ask = await screen.findByTestId("take-back-high-hand-dialog");
    expect(ask).toHaveTextContent("Ann's $15 goes back into the high hand pot.");
    await user.click(within(ask).getByRole("button", { name: "Take back" }));

    await waitFor(() => expect(deleted).toBe("r1"));
    expect(await screen.findByText("Ann's high hand win was taken back")).toBeInTheDocument();
  });

  describe("the amount is worked out from the pot as it is now (P3REV-PERF-HIGHHAND-STALE-AMOUNT)", () => {
    const registrations = [entrant("r1", "Ann"), entrant("r2", "Bea")];
    const standings = [standingOf(LEGACY, { netCents: 1_500 })];

    it("says it is checking the pot, shows no amount and holds Assign until the pot is in", async () => {
      const { user } = show({ registrations, standings, potCheck: "checking" });

      await choosePlayer(user, "Bea");

      expect(screen.getByTestId("high-hand-amount")).toHaveValue("");
      expect(screen.getByTestId("high-hand-amount")).toHaveAccessibleDescription(expect.stringContaining("Checking the pot as it is now…"));
      expect(screen.getByTestId("assign-high-hand")).toHaveAttribute("aria-disabled", "true");
    });

    it("says an amount may be out of date when the pot could not be checked, and checks again", async () => {
      const sent = recordAwards(LEGACY_HIGH_HAND_ID, registrations);
      const onCheckPot = vi.fn();
      const { user } = show({ registrations, standings, potCheck: "failed", onCheckPot });

      expect(screen.getByTestId("high-hand-amount")).toHaveValue("15.00");
      expect(screen.getByTestId("high-hand-amount")).toHaveAccessibleDescription(expect.stringContaining("may be out of date"));
      await user.click(screen.getByRole("button", { name: "Check again" }));
      expect(onCheckPot).toHaveBeenCalledTimes(1);

      // The server decides what is paid, so the award can still be made.
      await choosePlayer(user, "Bea");
      await user.click(screen.getByTestId("assign-high-hand"));
      await waitFor(() => expect(sent).toEqual([{ registrationId: "r2" }]));
    });
  });
});

describe("AwardHighHandDialog, several high hands (round 10, on a host's phone)", () => {
  const game = listedTournament();
  // Ann is in both, Bea only in the second half, Cal only in the first; Ann has won the first half.
  const registrations = [
    entrant("r1", "Ann", { highHandIds: ["hh1", "hh2"], highHandWins: [win("hh1", 900)] }),
    entrant("r2", "Bea", { highHandIds: ["hh2"] }),
    entrant("r3", "Cal", { highHandIds: ["hh1"] }),
  ];
  const standings = [
    standingOf(FIRST_HALF, { netCents: 900, awards: [{ registrationId: "r1", amountCents: 900 }] }),
    standingOf(SECOND_HALF, { netCents: 1_000 }),
  ];

  it("asks which high hand was won, each with its pot and next prize", async () => {
    hostPhone();
    const { user } = show({ tournament: game, registrations, standings });

    expect(screen.getByRole("heading", { name: "Award a high hand" })).toBeInTheDocument();
    expect(screen.getByTestId("choose-high-hand-hh1")).toHaveTextContent("Pot $9 · 1 winner so far · every prize awarded");
    expect(screen.getByTestId("choose-high-hand-hh2")).toHaveTextContent("Pot $10 · 0 winners so far · next prize $10");

    await user.click(screen.getByRole("button", { name: "Award Second half high hand" }));
    expect(screen.getByRole("heading", { name: "Award Second half high hand" })).toBeInTheDocument();
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("10.00");
  });

  it("offers only that high hand's players, and awards that pot alone", async () => {
    hostPhone();
    const sent = recordAwards("hh2", registrations, 1_000);
    const { user } = show({ tournament: game, registrations, standings });

    await user.click(screen.getByRole("button", { name: "Award Second half high hand" }));
    await user.click(screen.getByRole("combobox", { name: "Player" }));
    expect(await screen.findByRole("option", { name: "Ann" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.click(screen.getByRole("option", { name: "Bea" }));
    await user.click(screen.getByRole("button", { name: "Award Second half high hand" }));

    await waitFor(() => expect(sent).toEqual([{ registrationId: "r2" }]));
    expect(await screen.findByText("Bea wins the Second half high hand: $10")).toBeInTheDocument();
  });

  it("goes back to the choice of high hand, and leaves a pot's winners out of its own choice of players", async () => {
    hostPhone();
    const { user } = show({ tournament: game, registrations, standings });

    await user.click(screen.getByRole("button", { name: "Award First half high hand" }));
    expect(screen.getByText(/Previous Winners/)).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Player" }));
    expect(await screen.findByRole("option", { name: "Cal" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Escape}");

    await user.click(screen.getByTestId("other-high-hand"));
    expect(screen.getByRole("heading", { name: "Award a high hand" })).toBeInTheDocument();
  });
});
