import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { prizePoolSnapshotDto } from "@test/helpers/dto";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { alice, bob, carl, HASH_A, HASH_B, mockFinalize, mockPreview, planRow as row, previewOf as preview, tournamentDto } from "@test/helpers/f1-tournaments";
import { CorrectResultsDialog } from "./correct-results-dialog";

beforeEach(() => {
  mockSignedOut();
  // The tournament as finalized, without a deal (finalize-deal.test.tsx has the corrections with one).
  server.use(http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ status: "completed", prizePoolSnapshot: prizePoolSnapshotDto() }))));
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

describe("CorrectResultsDialog: players who have not paid (round 6)", () => {
  const unpaidBob = { ...bob, amountDueCents: 10_000 };
  const unpaidCarl = { ...carl, amountDueCents: 10_000 };

  it("opens full screen on a phone, Finalize Again kept in view", async () => {
    mockPreview(() => preview({ planHash: HASH_A, requiresForce: true, rows: [row(alice, 1, 23_800), row(bob, 2, 14_200)] }));
    renderWithApp(<CorrectResultsDialog open onOpenChange={vi.fn()} tournamentId="t1" finishers={[alice, bob]} />);

    expect(await screen.findByRole("dialog", { name: "Correct Results" })).toBeInTheDocument();
    expect(screen.getByTestId("correct-results-sheet")).toHaveClass("w-full", "h-dvh");
    expect(screen.getByTestId("confirm-correction")).toHaveClass("h-11");
  });

  it("starts as the stored results left a player out for not paying, and puts them back at the foot of the order once they pay (R6REV1-PHONE-01)", async () => {
    // Carl was left out at End Tournament: no place stored, still not paid.
    let carlPaid = false;
    const previews = mockPreview((order, body) => {
      // The server's own check: the order names every player it ranks, which is the whole field unless an unpaid Carl is left out.
      const ranked = body.excludeUnpaid && !carlPaid ? 2 : 3;
      if ((order ?? []).length !== ranked) {
        return preview({ ok: false, code: "INVALID_FINISH_ORDER", message: "Give the finishing order of every player still in, or of every player, each once", requiresForce: true });
      }
      if (carlPaid) return preview({ planHash: HASH_A, requiresForce: true, rows: [row(alice, 1, 23_800), row(bob, 2, 14_200), row(carl, 3, 9_500)] });
      return body.excludeUnpaid
        ? preview({ planHash: HASH_B, requiresForce: true, rows: [row(alice, 1, 28_500), row(bob, 2, 19_000)], unpaid: [unpaidCarl] })
        : preview({ ok: false, code: "UNPAID_PLAYERS", message: "Carl has not paid", requiresForce: true, unpaid: [unpaidCarl] });
    });
    server.use(
      http.patch("/api/registrations/r3/confirm-payment", () => {
        carlPaid = true;
        return HttpResponse.json({ id: "r3", paymentConfirmed: true, seating: null, highHandUnawardedCents: 0 });
      }),
    );
    const finalizes = mockFinalize(() => HttpResponse.json({ success: true, message: "Tournament finalized successfully", snapshot: prizePoolSnapshotDto() }));
    const user = userEvent.setup();
    const field3 = [
      { ...alice, placed: true, paid: true },
      { ...bob, placed: true, paid: true },
      { ...carl, placed: false, paid: false },
    ];
    renderWithApp(<CorrectResultsDialog open onOpenChange={vi.fn()} tournamentId="t1" finishers={field3} />);

    // Opened as stored: Carl left out, the plan ready to finalize again, and no refusal.
    const panel = await screen.findByTestId("finalize-unpaid");
    expect(panel).toHaveTextContent("Left out: 1 not paid");
    await waitFor(() => expect(screen.getByTestId("confirm-correction")).toBeEnabled());
    expect(previews[0]).toEqual({ finishOrder: ["r1", "r2"], force: true, excludeUnpaid: true });
    expect(screen.getByRole("list", { name: "Finishing order" })).not.toHaveTextContent("Carl");

    // Carl pays: he is back in the order, last, and the night can be finalized again with him.
    await user.click(within(panel).getByRole("button", { name: "Confirm Carl's payment" }));
    expect(await screen.findByTestId("back-in-order")).toHaveTextContent("Carl has paid and is back in the order, last: move them up to where they finished.");
    const order = screen.getByRole("list", { name: "Finishing order" });
    await waitFor(() => expect(within(order).getAllByRole("listitem").at(-1)).toHaveTextContent("Carl"));
    await waitFor(() => expect(screen.getByTestId("confirm-correction")).toBeEnabled());
    expect(screen.queryByTestId("finalize-unpaid")).not.toBeInTheDocument();
    expect(previews.at(-1)).toEqual({ finishOrder: ["r1", "r2", "r3"], force: true, excludeUnpaid: true });
    expect(screen.queryByText(/Give the finishing order/)).not.toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-correction"));
    await waitFor(() => expect(finalizes).toEqual([{ finishOrder: ["r1", "r2", "r3"], force: true, excludeUnpaid: true, expectedPlanHash: HASH_A }]));
  });

  it("leaves a player who has not paid out of the order, and finalizes again without them", async () => {
    const previews = mockPreview((_order, body) =>
      body.excludeUnpaid
        ? preview({ planHash: HASH_A, requiresForce: true, rows: [row(alice, 1, 23_800), row(carl, 2, 14_200)], unpaid: [unpaidBob] })
        : preview({ ok: false, code: "UNPAID_PLAYERS", message: "Bob has not paid", requiresForce: true, unpaid: [unpaidBob] }),
    );
    const finalizes = mockFinalize(() => HttpResponse.json({ success: true, message: "Tournament finalized successfully", snapshot: prizePoolSnapshotDto() }));
    const user = userEvent.setup();
    renderWithApp(<CorrectResultsDialog open onOpenChange={vi.fn()} tournamentId="t1" finishers={[alice, bob, carl]} />);

    const panel = await screen.findByTestId("finalize-unpaid");
    expect(panel).toHaveTextContent("1 player has not paid");
    expect(screen.getByTestId("confirm-correction")).toBeDisabled();
    await user.click(within(panel).getByRole("button", { name: "Leave them out" }));

    await waitFor(() => expect(screen.getByTestId("confirm-correction")).toBeEnabled());
    expect(previews.at(-1)).toEqual({ finishOrder: ["r1", "r3"], force: true, excludeUnpaid: true });
    expect(screen.getByRole("list", { name: "Finishing order" })).not.toHaveTextContent("Bob");
    // Moving the players shown keeps Bob out of sight.
    await user.click(screen.getByRole("button", { name: "Move Carl up" }));
    await waitFor(() => expect(previews.at(-1)).toEqual({ finishOrder: ["r3", "r1"], force: true, excludeUnpaid: true }));

    await waitFor(() => expect(screen.getByTestId("confirm-correction")).toBeEnabled());
    await user.click(screen.getByTestId("confirm-correction"));
    await waitFor(() => expect(finalizes).toEqual([{ finishOrder: ["r3", "r1"], force: true, excludeUnpaid: true, expectedPlanHash: HASH_A }]));
  });
});
