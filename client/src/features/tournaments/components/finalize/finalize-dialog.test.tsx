import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { alice, bob, carl, finalizeResultDto, HASH_A, HASH_B, HASH_C, mockFinalize, mockPreview, planRow as row, previewOf as preview } from "@test/helpers/f1-tournaments";
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
