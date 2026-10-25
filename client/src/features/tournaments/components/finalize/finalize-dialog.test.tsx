import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import {
  alice,
  bob,
  carl,
  finalizeResultDto,
  HASH_A,
  HASH_B,
  HASH_C,
  mockFinalize,
  mockPreview,
  planRow as row,
  previewOf as preview,
  previewPrizePool,
} from "@test/helpers/f1-tournaments";
import { computePrizePool } from "@shared/domain/prize-pool";
import { FinalizeDialog } from "./finalize-dialog";

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

const finalized = () =>
  HttpResponse.json(finalizeResultDto("Tournament finalized: 3 players placed"));

function renderDialog() {
  const onOpenChange = vi.fn();
  renderWithApp(<FinalizeDialog open onOpenChange={onOpenChange} tournamentId="t1" />);
  return onOpenChange;
}

beforeEach(() => {
  mockSignedOut();
});

describe("FinalizeDialog: players who have not paid (round 6)", () => {
  const dee = { registrationId: "r4", playerId: "p4", playerName: "Dee", amountDueCents: 12_500 };
  const unpaidPlan = preview({
    ok: false,
    code: "UNPAID_PLAYERS",
    message: "Dee has not paid, so is not in the prize pool: confirm the payment, or leave them out",
    activePlayers: [alice],
    unpaid: [dee],
    warnings,
  });
  const readyPlan = preview({ planHash: HASH_A, activePlayers: [alice], rows: [row(alice, 1, 23_800), row(bob, 2, 14_200), row(carl, 3, 9_500)], warnings });
  const leftOutPlan = preview({ ...readyPlan, unpaid: [dee], warnings: [...warnings, "1 player who has not paid is left out, not ranked, paid or scored: Dee"] });

  it("names who has not paid with what they owe, and finalizes only once they are left out", async () => {
    const previews = mockPreview((_order, body) => (body.excludeUnpaid ? leftOutPlan : unpaidPlan));
    const finalizes = mockFinalize(finalized);
    const user = userEvent.setup();
    renderDialog();

    const panel = await screen.findByTestId("finalize-unpaid");
    expect(panel).toHaveTextContent("1 player has not paid");
    expect(panel).toHaveTextContent("Their money is not in the prize pool");
    expect(within(panel).getByTestId("unpaid-r4")).toHaveTextContent("DeeOwes $125");
    expect(screen.getByTestId("confirm-finalize")).toBeDisabled();
    // The panel says it: the server's refusal sentence is not repeated under the plan.
    expect(screen.queryByText(/confirm the payment, or leave them out/)).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Leave them out" }));

    await waitFor(() => expect(screen.getByTestId("confirm-finalize")).toBeEnabled());
    expect(previews.at(-1)).toEqual({ excludeUnpaid: true });
    expect(screen.getByTestId("finalize-unpaid")).toHaveTextContent("Left out: 1 not paid");
    expect(screen.getByTestId("finalize-warnings")).toHaveTextContent("left out, not ranked, paid or scored: Dee");
    await user.click(screen.getByTestId("confirm-finalize"));

    await waitFor(() => expect(finalizes).toHaveLength(1));
    expect(finalizes[0]).toEqual({ expectedPlanHash: HASH_A, excludeUnpaid: true });
  });

  it("confirms a payment from the dialog, works the plan out again and then finalizes with everyone paid", async () => {
    let paid = false;
    const previews = mockPreview(() => (paid ? readyPlan : unpaidPlan));
    const confirmed: string[] = [];
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", ({ params }) => {
        confirmed.push(String(params.id));
        paid = true;
        return HttpResponse.json({ id: "r4", player: { id: "p4", name: "Dee", imageUrl: null }, paymentConfirmed: true, seating: { status: "off" } });
      }),
    );
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Confirm Dee's payment" }));

    await waitFor(() => expect(screen.queryByTestId("finalize-unpaid")).not.toBeInTheDocument());
    expect(confirmed).toEqual(["r4"]);
    expect(previews.length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText("Dee has paid: $125 is in the prize pool.")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-finalize")).toBeEnabled();
  });

  it("keeps the dialog's plan when the payment is refused, and says why", async () => {
    mockPreview(() => unpaidPlan);
    server.use(http.patch("/api/registrations/:id/confirm-payment", () => apiError(409, "TOURNAMENT_FULL", "18 of 18 players accepted: raise Max players to accept more")));
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Confirm Dee's payment" }));

    expect(await screen.findByText("18 of 18 players accepted: raise Max players to accept more")).toBeInTheDocument();
    expect(screen.getByText("Tournament full")).toBeInTheDocument();
    expect(screen.getByTestId("finalize-unpaid")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-finalize")).toBeDisabled();
  });
});

describe("FinalizeDialog", () => {
  it("shows beside a pool fixed by hand what the club keeps or adds, not the rates' AP the fixed pool overrides (MONEY-AP-03)", async () => {
    // $500 in, $25 AP by the rates, the pool fixed at $600: the club adds $100.
    const breakdown = { ...previewPrizePool.breakdown, manualPrizePool: 60_000, net: 60_000, netSource: "manual_pool" as const, impliedRake: -10_000 };
    mockPreview(() => preview({ planHash: HASH_A, prizePool: { ...previewPrizePool, breakdown } }));
    const { unmount } = renderWithApp(<FinalizeDialog open onOpenChange={() => undefined} tournamentId="t1" />);
    expect(await screen.findByTestId("finalize-pool")).toHaveTextContent("$600");
    expect(screen.getByTestId("finalize-ap")).toHaveTextContent("$100");
    expect(screen.getByText("Added by the club")).toBeInTheDocument();
    unmount();

    // The pool fixed at $450: the club keeps $50.
    mockPreview(() => preview({ planHash: HASH_A, prizePool: { ...previewPrizePool, breakdown: { ...breakdown, manualPrizePool: 45_000, net: 45_000, impliedRake: 5_000 } } }));
    renderWithApp(<FinalizeDialog open onOpenChange={() => undefined} tournamentId="t1" />);
    expect(await screen.findByTestId("finalize-ap")).toHaveTextContent("$50");
    expect(screen.getByText("AP the club keeps")).toBeInTheDocument();
  });

  it("says where the money the prizes leave goes before finalizing: carried over, kept or added (round 5, item 16)", async () => {
    // $500 in, $25 AP: $475 available. The pool fixed at $400 carries $75 over to the season's next tournament.
    const breakdown = computePrizePool(
      { buyInAmount: "100.00", rakeType: "fixed", rakeAmount: "5.00", payoutStructure: "standard", manualPrizePool: "400.00", prizeDifference: "carry" },
      [2, 2, 1].map((buyIns) => ({ buyIns, paymentConfirmed: true })),
    );
    mockPreview(() => preview({ planHash: HASH_A, prizePool: { ...previewPrizePool, breakdown, carryTarget: "Winter League" } }));
    renderDialog();

    expect(await screen.findByTestId("finalize-summary")).toHaveTextContent("Prize pool $400· AP $25· Carried over to Winter League $75");
    expect(screen.getByTestId("finalize-pool")).toHaveTextContent("$400");
  });

  it("opens full screen on a phone, Finalize kept in view under the plan", async () => {
    mockPreview(() => preview({ planHash: HASH_A }));
    renderDialog();

    expect(await screen.findByRole("dialog", { name: "End Tournament" })).toBeInTheDocument();
    expect(screen.getByTestId("finalize-sheet")).toHaveClass("w-full", "h-dvh");
    expect(await screen.findByTestId("confirm-finalize")).toHaveClass("h-11");
  });

  it("shows no breakdown line when the prizes are exactly the money available", async () => {
    mockPreview(() => preview({ planHash: HASH_A }));
    renderDialog();

    expect(await screen.findByTestId("finalize-pool")).toBeInTheDocument();
    expect(screen.queryByTestId("finalize-summary")).not.toBeInTheDocument();
  });

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
    // Bob is at the top now: his Up button says so but keeps focus, and the move is said aloud (MA-REV-03).
    const bobUp = screen.getByRole("button", { name: "Move Bob up" });
    expect(bobUp).toHaveFocus();
    expect(bobUp).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("finish-order-moved")).toHaveTextContent("Bob moved to 1st");
    await user.click(bobUp);
    expect(screen.getByTestId("finish-order-1")).toHaveTextContent("Bob");
    // The plan is one region in the dialog's own scroll, with no scroll box of its own (MA-REV-07).
    expect(screen.getByRole("region", { name: "Payout plan" })).not.toHaveClass("max-h-64");

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
