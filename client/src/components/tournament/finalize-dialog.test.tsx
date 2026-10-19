import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { computePrizePool } from "@shared/domain/prize-pool";
import type { FinalizePreviewDto, FinalizeRowDto } from "@shared/api/finalize";
import type { PrizePoolDto } from "@shared/api/prize-pool";
import { CorrectResultsDialog, FinalizeDialog } from "./finalize-dialog";

const HASH_A = "a".repeat(32);
const HASH_B = "b".repeat(32);
const HASH_C = "c".repeat(32);

const tournament = { buyInAmount: "100.00", rakeType: "fixed", rakeAmount: "5.00", payoutStructure: "standard" };
const breakdown = computePrizePool(tournament, [{ buyIns: 2 }, { buyIns: 2 }, { buyIns: 1 }]);
const prizePool: PrizePoolDto = {
  tournamentId: "t1",
  status: "in_progress",
  rakeLabel: "AP",
  locked: false,
  estimated: true,
  breakdown,
  display: { source: "live", rows: [], totalCents: breakdown.net, undistributedCents: 0 },
  adjustment: null,
};

const alice = { registrationId: "r1", playerId: "p1", playerName: "Alice" };
const bob = { registrationId: "r2", playerId: "p2", playerName: "Bob" };

const carl = { registrationId: "r3", playerId: "p3", playerName: "Carl" };

const row = (player: typeof alice, position: number, cents: number): FinalizeRowDto => ({
  ...player,
  finalPosition: position,
  amountCents: cents,
  prizeAmount: cents > 0 ? (cents / 100).toFixed(2) : null,
  pointsAwarded: null,
});

function preview(overrides: Partial<FinalizePreviewDto>): FinalizePreviewDto {
  return {
    ok: true,
    requiresForce: false,
    prizePool,
    rows: [],
    activePlayers: [],
    warnings: [],
    pendingRequests: [],
    previous: null,
    ...overrides,
  };
}

const warnings = ["The prize pool is not locked"];
const needsOrder = preview({
  ok: false,
  code: "ACTIVE_PLAYERS_NEED_ORDER",
  message: "Choose the finishing order of the 2 players still in",
  activePlayers: [alice, bob],
  warnings,
});
const aliceFirst = preview({
  planHash: HASH_A,
  activePlayers: [alice, bob],
  rows: [row(alice, 1, 23_800), row(bob, 2, 14_200), row(carl, 3, 9_500)],
  warnings,
});
const bobFirst = preview({
  planHash: HASH_B,
  activePlayers: [bob, alice],
  rows: [row(bob, 1, 23_800), row(alice, 2, 14_200), row(carl, 3, 9_500)],
  warnings,
});

/** Answers the preview by the finishing order sent, and records each request body. */
function mockPreview(byOrder: (finishOrder: string[] | undefined) => FinalizePreviewDto) {
  const bodies: unknown[] = [];
  server.use(
    http.post("/api/tournaments/t1/finalize/preview", async ({ request }) => {
      const body = (await request.json()) as { finishOrder?: string[] };
      bodies.push(body);
      return HttpResponse.json(byOrder(body.finishOrder));
    }),
  );
  return bodies;
}

function mockFinalize(answer: (body: unknown) => Response) {
  const bodies: unknown[] = [];
  server.use(
    http.post("/api/tournaments/t1/finalize", async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      return answer(body);
    }),
  );
  return bodies;
}

const finalized = () =>
  HttpResponse.json({ success: true, message: "Tournament finalized: 3 players placed", snapshot: {} });

function renderDialog() {
  const onOpenChange = vi.fn();
  renderWithApp(<FinalizeDialog open onOpenChange={onOpenChange} tournamentId="t1" />);
  return onOpenChange;
}

beforeEach(() => {
  mockSignedOut();
});

describe("FinalizeDialog", () => {
  it("asks for the finishing order, previews it, and finalizes the plan it showed", async () => {
    const previews = mockPreview((order) => (!order ? needsOrder : order[0] === "r1" ? aliceFirst : bobFirst));
    const finalizes = mockFinalize(finalized);
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    // The server's suggested order comes back with the payouts it pays.
    const plan = await screen.findByTestId("finalize-plan");
    expect(within(plan).getAllByRole("row")[1]).toHaveTextContent("1stAlice$238");
    expect(screen.getByTestId("finalize-pool")).toHaveTextContent("$475");
    expect(screen.getByTestId("finalize-warnings")).toHaveTextContent("The prize pool is not locked");

    await user.click(screen.getByRole("button", { name: "Move Bob up" }));
    await waitFor(() => expect(within(screen.getByTestId("finalize-plan")).getAllByRole("row")[1]).toHaveTextContent("1stBob"));
    expect(screen.getByTestId("finish-order-1")).toHaveTextContent("Bob");

    await user.click(screen.getByTestId("confirm-finalize"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(previews).toEqual([{}, { finishOrder: ["r1", "r2"] }, { finishOrder: ["r2", "r1"] }]);
    expect(finalizes).toEqual([{ finishOrder: ["r2", "r1"], expectedPlanHash: HASH_B }]);
    expect(await screen.findByText("Tournament finalized")).toBeInTheDocument();
  });

  it("shows the new plan when the results changed after the preview, and pays that one", async () => {
    const changed = preview({
      planHash: HASH_C,
      activePlayers: [alice, bob],
      rows: [row(alice, 1, 28_500), row(bob, 2, 17_100), row(carl, 3, 11_400)],
    });
    mockPreview((order) => (!order ? needsOrder : aliceFirst));
    const finalizes = mockFinalize((body) =>
      (body as { expectedPlanHash: string }).expectedPlanHash === HASH_A
        ? apiError(409, "PLAN_CHANGED", "The plan changed", { preview: changed })
        : finalized(),
    );
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await screen.findByTestId("finalize-plan");
    await user.click(screen.getByTestId("confirm-finalize"));

    expect(await screen.findByTestId("finalize-notice")).toHaveTextContent("The results changed");
    expect(within(screen.getByTestId("finalize-plan")).getAllByRole("row")[1]).toHaveTextContent("$285");
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("confirm-finalize"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(finalizes).toEqual([
      { finishOrder: ["r1", "r2"], expectedPlanHash: HASH_A },
      { finishOrder: ["r1", "r2"], expectedPlanHash: HASH_C },
    ]);
  });

  it("finalizes without an order when one player is left", async () => {
    mockPreview(() => preview({ planHash: HASH_A, activePlayers: [alice], rows: [row(alice, 1, 23_800), row(bob, 2, 14_200)] }));
    const finalizes = mockFinalize(finalized);
    const user = userEvent.setup();
    renderDialog();

    await screen.findByTestId("finalize-plan");
    expect(screen.queryByRole("list", { name: "Finishing order" })).not.toBeInTheDocument();
    await user.click(screen.getByTestId("confirm-finalize"));

    await waitFor(() => expect(finalizes).toEqual([{ expectedPlanHash: HASH_A }]));
  });

  it("refuses to run again for a tournament that is already finalized", async () => {
    mockPreview(() => preview({ ok: false, code: "ALREADY_FINALIZED", message: "Already finalized", requiresForce: true }));
    renderDialog();

    expect(await screen.findByTestId("already-finalized")).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-finalize")).not.toBeInTheDocument();
  });

  it("shows the server's sentence when the preview is refused", async () => {
    server.use(
      http.post("/api/tournaments/t1/finalize/preview", () => apiError(403, "FORBIDDEN", "You do not manage this club")),
    );
    renderDialog();

    expect(await screen.findByText("You do not manage this club")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-finalize")).toBeDisabled();
  });

  it("drops a finishing order that went stale when another device busted all but one player, instead of getting stuck (P2REV1-06)", async () => {
    let bobBusted = false;
    const lastOneIn = preview({ planHash: HASH_C, activePlayers: [alice], rows: [row(alice, 1, 23_800), row(bob, 2, 14_200), row(carl, 3, 9_500)] });
    const staleOrder = preview({
      ok: false,
      code: "INVALID_FINISH_ORDER",
      message: "Give the finishing order of every player still in, or of every player, each once",
      activePlayers: [alice],
    });
    const previews = mockPreview((order) => (!order ? (bobBusted ? lastOneIn : needsOrder) : bobBusted ? staleOrder : aliceFirst));
    const finalizes = mockFinalize((body) =>
      (body as { finishOrder?: string[] }).finishOrder ? apiError(409, "INVALID_FINISH_ORDER", staleOrder.message!) : finalized(),
    );
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await screen.findByTestId("finalize-plan");
    bobBusted = true;
    await user.click(screen.getByTestId("confirm-finalize"));

    await waitFor(() => expect(screen.getByTestId("confirm-finalize")).toBeEnabled());
    expect(screen.queryByRole("list", { name: "Finishing order" })).not.toBeInTheDocument();
    await user.click(screen.getByTestId("confirm-finalize"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(previews.at(-1)).toEqual({});
    expect(finalizes).toEqual([{ finishOrder: ["r1", "r2"], expectedPlanHash: HASH_A }, { expectedPlanHash: HASH_C }]);
  });

  it("warns about player requests that finalizing would discard", async () => {
    const waiting = "1 player request still waiting will be discarded: Bob's re-buy ($100). Confirm or dismiss them under Confirm Actions first";
    mockPreview(() => preview({ planHash: HASH_A, activePlayers: [alice], rows: [row(alice, 1, 23_800)], warnings: [waiting] }));
    renderDialog();

    expect(await screen.findByTestId("finalize-warnings")).toHaveTextContent("Bob's re-buy ($100)");
  });

  it("shows why a cancelled tournament cannot be finalized", async () => {
    mockPreview(() => preview({ ok: false, code: "TOURNAMENT_CANCELLED", message: "A cancelled tournament cannot be finalized" }));
    renderDialog();

    expect(await screen.findByText("A cancelled tournament cannot be finalized")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-finalize")).toBeDisabled();
  });
});

describe("CorrectResultsDialog (P2REV1-01)", () => {
  it("shows each player's points beside what was stored before, and the warning when points would change", async () => {
    const pointsWarning = "Season points change for 1 player whose place stays the same: Carl 20 → none";
    mockPreview(() =>
      preview({
        planHash: HASH_A,
        requiresForce: true,
        rows: [
          { ...row(bob, 1, 23_800), pointsAwarded: 100 },
          { ...row(alice, 2, 14_200), pointsAwarded: 50 },
          { ...row(carl, 3, 9_500), pointsAwarded: null },
        ],
        warnings: ["Finalizing again replaces the stored positions, prizes and points", pointsWarning],
        previous: {
          finalizedAt: "2026-10-01T10:00:00.000Z",
          rows: [],
          results: [
            { registrationId: "r1", finalPosition: 1, pointsAwarded: 100 },
            { registrationId: "r2", finalPosition: 2, pointsAwarded: 50 },
            { registrationId: "r3", finalPosition: 3, pointsAwarded: 20 },
          ],
        },
      }),
    );
    renderWithApp(<CorrectResultsDialog open onOpenChange={vi.fn()} tournamentId="t1" finishers={[alice, bob, carl]} />);

    expect(await screen.findByTestId("finalize-warnings")).toHaveTextContent(pointsWarning);
    expect(screen.getByTestId("plan-points-r2")).toHaveTextContent("100(was 50)");
    expect(screen.getByTestId("plan-points-r1")).toHaveTextContent("50(was 100)");
    expect(screen.getByTestId("plan-points-r3")).toHaveTextContent("-(was 20)");
  });

  it("keeps the points column when every new row has none but the stored results had points", async () => {
    mockPreview(() =>
      preview({
        planHash: HASH_A,
        requiresForce: true,
        rows: [row(alice, 1, 23_800), row(bob, 2, 14_200)],
        previous: {
          finalizedAt: null,
          rows: [],
          results: [
            { registrationId: "r1", finalPosition: 2, pointsAwarded: 50 },
            { registrationId: "r2", finalPosition: 1, pointsAwarded: 100 },
          ],
        },
      }),
    );
    renderWithApp(<CorrectResultsDialog open onOpenChange={vi.fn()} tournamentId="t1" finishers={[bob, alice]} />);

    expect(await screen.findByTestId("plan-points-r1")).toHaveTextContent("-(was 50)");
    expect(screen.getByTestId("plan-points-r2")).toHaveTextContent("-(was 100)");
  });
});
