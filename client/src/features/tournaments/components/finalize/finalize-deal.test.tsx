/** A deal at End Tournament and in Correct Results (round 5, item 2), on a phone. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { prizePoolSnapshotDto } from "@test/helpers/dto";
import {
  alice,
  bob,
  carl,
  dealableOf,
  finalizeResultDto,
  HASH_A,
  HASH_B,
  mockFinalize,
  mockPreview,
  planRow as row,
  previewOf as preview,
  screenWidth,
  tournamentDto,
} from "@test/helpers/f1-tournaments";
import type { DealRequest, FinalizePreviewDto, FinalizePreviewInput } from "@shared/api/finalize";
import { toCents } from "@shared/domain/money";
import { CorrectResultsDialog } from "./correct-results-dialog";
import { FinalizeDialog } from "./finalize-dialog";

// Alice, Bob and Carl are still in; their places pay $238 / $142 / $95 of the $475 pool.
const dealable = dealableOf([alice, bob, carl], [23_800, 14_200, 9_500]);
const needsOrder = preview({
  ok: false,
  code: "ACTIVE_PLAYERS_NEED_ORDER",
  message: "More than one player is still in: give their finishing order",
  activePlayers: [alice, bob, carl],
  dealable: { ...dealable, players: dealable.players.map((player) => ({ ...player, position: null, plannedCents: null })) },
});
const plain = preview({ planHash: HASH_A, activePlayers: [alice, bob, carl], rows: [row(alice, 1, 23_800), row(bob, 2, 14_200), row(carl, 3, 9_500)], dealable });

/** The plan paying `deal`, as the server previews it. */
function dealPlan(deal: DealRequest): FinalizePreviewDto {
  const amount = (registrationId: string) => toCents(deal.amounts.find((share) => share.registrationId === registrationId)?.amount ?? "0");
  return preview({
    planHash: HASH_B,
    activePlayers: [alice, bob, carl],
    rows: [row(alice, 1, amount("r1")), row(bob, 2, amount("r2")), row(carl, 3, amount("r3"))],
    dealable,
    warnings: [`Deal: the 3 players still in share $475 as agreed (${deal.reason})`],
  });
}

const answer = (order: string[] | undefined, body: FinalizePreviewInput) => (!order ? needsOrder : body.deal ? dealPlan(body.deal) : plain);
const withDeal = (bodies: unknown[]) => bodies.filter((body) => (body as FinalizePreviewInput).deal !== undefined);
const amountOf = (name: string) => within(screen.getByTestId("deal-editor")).getByRole("textbox", { name });

function renderEndTournament() {
  const onOpenChange = vi.fn();
  renderWithApp(<FinalizeDialog open onOpenChange={onOpenChange} tournamentId="t1" />);
  return { onOpenChange, user: userEvent.setup() };
}

beforeEach(() => {
  mockSignedOut();
  screenWidth(390);
});

describe("a deal at End Tournament", () => {
  it("starts from what each place pays, chops evenly in one tap, and finalizes the plan that pays the deal", async () => {
    const previews = mockPreview(answer);
    const finalizes = mockFinalize(() => HttpResponse.json(finalizeResultDto()));
    const { user, onOpenChange } = renderEndTournament();

    await user.click(await screen.findByTestId("make-deal"));
    expect(amountOf("Alice")).toHaveValue("238");
    expect(amountOf("Carl")).toHaveValue("95");
    expect(amountOf("Alice")).toHaveAttribute("inputmode", "decimal");
    expect(amountOf("Alice")).toHaveClass("h-11");
    expect(screen.getByText("1st pays $238")).toBeInTheDocument();

    await user.click(screen.getByTestId("even-chop"));
    expect(amountOf("Alice")).toHaveValue("159");
    expect(amountOf("Bob")).toHaveValue("158");
    expect(screen.getByTestId("deal-total")).toHaveTextContent("$475 of $475: it adds up");
    // No reason yet: nothing to finalize, and the deal is not previewed.
    expect(screen.getByTestId("deal-pending")).toHaveTextContent("Fix the deal, or choose No deal, to finalize.");
    expect(screen.getByTestId("confirm-finalize")).toBeDisabled();
    expect(withDeal(previews)).toEqual([]);

    await user.click(within(screen.getByRole("group", { name: "Common deals" })).getByRole("button", { name: "Even chop at 3 handed" }));
    const deal = {
      amounts: [
        { registrationId: "r1", amount: "159.00" },
        { registrationId: "r2", amount: "158.00" },
        { registrationId: "r3", amount: "158.00" },
      ],
      reason: "Even chop at 3 handed",
    };
    await waitFor(() => expect(withDeal(previews)).toEqual([{ finishOrder: ["r1", "r2", "r3"], deal }]));
    expect(await screen.findByTestId("plan-deal-r1")).toHaveTextContent("Deal (place pays $238)");
    expect(within(screen.getByTestId("finalize-plan")).getAllByRole("row")[1]).toHaveTextContent("1stAlice$159");
    expect(screen.getByTestId("finalize-warnings")).toHaveTextContent("Deal: the 3 players still in share $475 as agreed (Even chop at 3 handed)");

    await waitFor(() => expect(screen.getByTestId("confirm-finalize")).toBeEnabled());
    await user.click(screen.getByTestId("confirm-finalize"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(finalizes).toEqual([{ finishOrder: ["r1", "r2", "r3"], expectedPlanHash: HASH_B, deal }]);
  });

  it("never previews or finalizes a deal that does not add up, and says by how much", async () => {
    const previews = mockPreview(answer);
    const { user } = renderEndTournament();

    await user.click(await screen.findByTestId("make-deal"));
    await user.type(screen.getByRole("textbox", { name: "What was agreed" }), "Chip chop");
    await user.clear(amountOf("Alice"));
    await user.type(amountOf("Alice"), "300");

    expect(screen.getByTestId("deal-total")).toHaveTextContent("$537 of $475: $62 too much");
    expect(screen.getByTestId("confirm-finalize")).toBeDisabled();
    await user.clear(amountOf("Bob"));
    expect(within(screen.getByTestId("deal-row-r2")).getByText("Each amount must be $0 or more, to the cent")).toBeInTheDocument();
    expect(amountOf("Bob")).toHaveAttribute("aria-invalid", "true");
    expect(withDeal(previews)).toEqual([]);
  });

  it("goes back to the places' payouts with No deal", async () => {
    mockPreview(answer);
    const finalizes = mockFinalize(() => HttpResponse.json(finalizeResultDto()));
    const { user } = renderEndTournament();

    await user.click(await screen.findByTestId("make-deal"));
    await user.click(screen.getByTestId("even-chop"));
    await user.type(screen.getByRole("textbox", { name: "What was agreed" }), "Chop");
    await screen.findByTestId("plan-deal-r1");
    await user.click(screen.getByTestId("cancel-deal"));

    expect(screen.queryByTestId("deal-editor")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("plan-deal-r1")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("confirm-finalize")).toBeEnabled());
    await user.click(screen.getByTestId("confirm-finalize"));
    await waitFor(() => expect(finalizes).toEqual([{ finishOrder: ["r1", "r2", "r3"], expectedPlanHash: HASH_A }]));
  });

  it("shows why the server refused the deal, and asks for the plan again", async () => {
    const previews = mockPreview(answer);
    mockFinalize(() =>
      apiError(409, "DEAL_INVALID", "The deal must share $575 (it is $100 short)", { dealProblems: [{ code: "DEAL_TOTAL", message: "The deal must share $575 (it is $100 short)" }], dealable }),
    );
    const { user, onOpenChange } = renderEndTournament();

    await user.click(await screen.findByTestId("make-deal"));
    await user.click(within(screen.getByRole("group", { name: "Common deals" })).getByRole("button", { name: "Chip chop at 3 handed" }));
    await screen.findByTestId("plan-deal-r1");
    await waitFor(() => expect(screen.getByTestId("confirm-finalize")).toBeEnabled());
    const asked = previews.length;
    await user.click(screen.getByTestId("confirm-finalize"));

    expect(await screen.findByTestId("finalize-notice")).toHaveTextContent("The deal must share $575 (it is $100 short)");
    await waitFor(() => expect(previews.length).toBeGreaterThan(asked));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("offers no deal with one player left", async () => {
    mockPreview(() => preview({ planHash: HASH_A, activePlayers: [alice], rows: [row(alice, 1, 23_800), row(bob, 2, 14_200)] }));
    renderEndTournament();

    await screen.findByTestId("finalize-plan");
    expect(screen.queryByTestId("make-deal")).not.toBeInTheDocument();
  });
});

describe("a deal in Correct Results", () => {
  const paidDeal = {
    reason: "Chip chop at 3 handed",
    totalCents: 47_500,
    players: [
      { ...alice, position: 1, plannedCents: 23_800, amountCents: 20_000 },
      { ...bob, position: 2, plannedCents: 14_200, amountCents: 15_000 },
      { ...carl, position: 3, plannedCents: 9_500, amountCents: 12_500 },
    ],
  };

  it("starts from the deal finalize paid, and corrects the results with it", async () => {
    server.use(
      http.get("/api/tournaments/t1", () =>
        HttpResponse.json(tournamentDto({ status: "completed", prizePoolSnapshot: prizePoolSnapshotDto({ deal: paidDeal }) })),
      ),
    );
    const previews = mockPreview((_order, body) => (body.deal ? { ...dealPlan(body.deal), requiresForce: true } : { ...plain, requiresForce: true }));
    const finalizes = mockFinalize(() => HttpResponse.json(finalizeResultDto()));
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithApp(<CorrectResultsDialog open onOpenChange={onOpenChange} tournamentId="t1" finishers={[alice, bob, carl]} />);

    expect(await screen.findByTestId("deal-editor")).toBeInTheDocument();
    expect(amountOf("Alice")).toHaveValue("200");
    expect(amountOf("Carl")).toHaveValue("125");
    expect(screen.getByRole("textbox", { name: "What was agreed" })).toHaveValue("Chip chop at 3 handed");
    const deal = {
      amounts: [
        { registrationId: "r1", amount: "200.00" },
        { registrationId: "r2", amount: "150.00" },
        { registrationId: "r3", amount: "125.00" },
      ],
      reason: "Chip chop at 3 handed",
    };
    await waitFor(() => expect(withDeal(previews)).toContainEqual({ finishOrder: ["r1", "r2", "r3"], force: true, deal }));
    await waitFor(() => expect(screen.getByTestId("confirm-correction")).toBeEnabled());
    await user.click(screen.getByTestId("confirm-correction"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(finalizes).toEqual([{ finishOrder: ["r1", "r2", "r3"], force: true, deal, expectedPlanHash: HASH_B }]);
  });

  it("offers a deal when the first finalize made none", async () => {
    server.use(http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ status: "completed", prizePoolSnapshot: prizePoolSnapshotDto() }))));
    mockPreview(() => ({ ...plain, requiresForce: true }));
    renderWithApp(<CorrectResultsDialog open onOpenChange={vi.fn()} tournamentId="t1" finishers={[alice, bob, carl]} />);

    expect(await screen.findByTestId("make-deal")).toBeInTheDocument();
    expect(screen.queryByTestId("deal-editor")).not.toBeInTheDocument();
  });
});
