import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { LIVE_REFRESH_MS } from "@/lib/live-refresh";
import { clubDto, finalizeResultDto, HASH_A, HASH_B, mockDeskLiveReads, previewOf, registrationDto, tournamentDto } from "@test/helpers/f1-tournaments";
import type { PublicRegistration } from "@shared/api/public";
import type { ManagedRegistration } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { seatingDto, seatingMutation, seatMove, seatRef } from "@test/helpers/seating-dto";
import TournamentDetails from "./tournament-details";

const field = [registrationDto("r1", "Ann", 2), registrationDto("r2", "Bob", 2), registrationDto("r3", "Cat", 1)];

function mockPage(
  canManage: boolean,
  {
    canOwn = canManage,
    overrides = {},
    registrations = field,
  }: { canOwn?: boolean; overrides?: Partial<TournamentDetailDto>; registrations?: PublicRegistration[] } = {},
) {
  mockDeskLiveReads(tournamentDto({ ...overrides, viewer: { canManage, canOwn } }), registrations);
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ ...overrides, viewer: { canManage, canOwn } }))),
    http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
    http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([])),
  );
}

function renderDetails() {
  return renderWithApp(<TournamentDetails />, { path: "/admin/tournaments/t1", route: "/admin/tournaments/:id" });
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("TournamentDetails", () => {
  it("shows the pool and payouts with the shared v2 maths and the club's AP label", async () => {
    mockPage(true);
    renderDetails();

    expect(await screen.findByTestId("prize-pool")).toHaveTextContent("$475");
    expect(screen.getByTestId("payout-1")).toHaveTextContent("$238");
    expect(screen.getByTestId("payout-2")).toHaveTextContent("$142");
    expect(screen.getByTestId("payout-3")).toHaveTextContent("$95");
    expect(await screen.findByText("AP (buy-ins $5 per entry)")).toBeInTheDocument();
  });

  it("opens the finalize preview from End Tournament for the club's staff", async () => {
    mockPage(true);
    server.use(
      http.post("/api/tournaments/t1/finalize/preview", () =>
        HttpResponse.json(previewOf({ planHash: HASH_A })),
      ),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByTestId("end-tournament"));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Check the finishing order and the payouts");
    expect(await screen.findByTestId("finalize-pool")).toHaveTextContent("$475");
  });

  it("says how many player requests are waiting beside End Tournament and Confirm Actions, since ending discards them (P2REV1-02)", async () => {
    mockPage(true);
    const request = (id: string, actionType: string) => ({ id, tournamentId: "t1", playerId: "p-r1", actionType, targetPlayerId: null, timestamp: "2026-10-23T08:00:00.000Z", player: null, targetPlayer: null });
    server.use(http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([request("pa1", "rebuy"), request("pa2", "addon")])));
    const user = userEvent.setup();
    renderDetails();

    expect(await screen.findByTestId("end-tournament-waiting")).toHaveTextContent("2 waiting");
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    expect(await screen.findByTestId("waiting-requests")).toHaveTextContent("2 player requests waiting");
  });

  it("says the waiting requests could not be checked, not that none wait, when their count failed (P3REV3-CQ-05)", async () => {
    mockPage(true);
    server.use(http.get("/api/tournaments/t1/pending-actions", () => apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now")));
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    expect(await screen.findByTestId("waiting-requests")).toHaveTextContent("Could not check for waiting requests");
    expect(screen.queryByTestId("end-tournament-waiting")).not.toBeInTheDocument();
  });

  it("hides the staff controls from someone who does not run the club", async () => {
    mockPage(false);
    renderDetails();

    expect(await screen.findByTestId("prize-pool")).toHaveTextContent("$475");
    expect(screen.queryByTestId("end-tournament")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("offers Delete to the club's owner, never to a manager, who gets a 403 for it (TN-09)", async () => {
    mockPage(true, { canOwn: false });
    const manager = renderDetails();

    expect(await screen.findByTestId("end-tournament")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    manager.unmount();

    mockPage(true, { canOwn: true });
    renderDetails();
    expect(await screen.findByRole("button", { name: /Delete/ })).toBeInTheDocument();
  });

  it("warns that places beyond the entrants are not paid, and totals only what finalize would pay (MONEY-REV-01)", async () => {
    mockPage(true, { registrations: [registrationDto("r1", "Ann", 1), registrationDto("r2", "Bob", 1)] });
    renderDetails();

    // Standard pays three places, but two players can only take two of them: $190 net, $38 unpaid.
    expect(await screen.findByTestId("undistributed")).toHaveTextContent("Only 2 players: $38 of the pool is not paid out unless more players enter.");
    expect(screen.getByTestId("payout-1")).toHaveTextContent("$95");
    expect(screen.queryByTestId("payout-3")).not.toBeInTheDocument();
  });

  it("registers a player who has played before, found by name, from the tournament page (TN-02)", async () => {
    mockPage(true);
    let registered: unknown;
    server.use(
      http.get("/api/public/tournaments/t1/players", ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get("q") === "Dee" ? [{ id: "p-dee", name: "Dee Visitor", imageUrl: null }] : []),
      ),
      http.post("/api/tournaments/t1/registrations", async ({ request }) => {
        registered = await request.json();
        return HttpResponse.json(
          { ...registrationDto("r9", "Dee Visitor"), playerId: "p-dee", player: { id: "p-dee", name: "Dee Visitor", imageUrl: null }, paymentConfirmed: false } satisfies ManagedRegistration,
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByTestId("register-player"));
    // The search box is named by the visible "Player" above it, and its star is not read out (P3REV-MA-REQUIRED-STAR).
    expect(screen.getByText("Fields marked * are required.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Buy-ins" })).toHaveAttribute("aria-required", "true");
    await user.type(screen.getByRole("searchbox", { name: "Player" }), "Dee");
    await user.click(await screen.findByTestId("player-option-p-dee"));
    await user.click(screen.getByTestId("register-player-final"));

    expect(await screen.findByText("Dee Visitor is in.")).toBeInTheDocument();
    expect(registered).toEqual({ playerId: "p-dee", buyIns: 1, rebuys: 0, addons: 0 });
  });

  it("says a late walk-in is waiting for a seat while the tables are in play, and seats them in one tap (TDN2-WAITING-NOT-FLAGGED)", async () => {
    mockPage(true);
    const tables = [{ id: "tb1", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Ann" } } }];
    const draws: unknown[] = [];
    server.use(
      http.get("/api/public/tournaments/t1/players", () => HttpResponse.json([{ id: "p-dee", name: "Dee Visitor", imageUrl: null }])),
      http.post("/api/tournaments/t1/registrations", () =>
        HttpResponse.json(
          { ...registrationDto("r9", "Dee Visitor"), playerId: "p-dee", player: { id: "p-dee", name: "Dee Visitor", imageUrl: null }, paymentConfirmed: false } satisfies ManagedRegistration,
          { status: 201 },
        ),
      ),
      http.get("/api/tournaments/t1/seating", () => HttpResponse.json(seatingDto({ tables, unseated: [{ id: "r9", name: "Dee Visitor" }] }))),
      http.post("/api/tournaments/t1/seating/draw", async ({ request }) => {
        draws.push(await request.json());
        const seated = seatingDto({ tables: [{ ...tables[0], seated: { ...tables[0].seated, 2: { id: "r9", name: "Dee Visitor" } } }] });
        return HttpResponse.json(seatingMutation(seated, [seatMove("r9", "Dee Visitor", null, seatRef("tb1", 1, 2), "draw")]));
      }),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByTestId("register-player"));
    await user.type(screen.getByRole("searchbox", { name: "Player" }), "Dee");
    await user.click(await screen.findByTestId("player-option-p-dee"));
    await user.click(screen.getByTestId("register-player-final"));

    const notifications = within(screen.getByTestId("notifications"));
    expect(await notifications.findByText("Dee Visitor is in, waiting for a seat.")).toBeInTheDocument();
    await user.click(notifications.getByRole("button", { name: "Seat now" }));
    expect(await notifications.findByText("Dee Visitor: Table 1, Seat 2.")).toBeInTheDocument();
    expect(draws).toEqual([{ scope: "unseated", registrationIds: ["r9"], includeUnconfirmed: true }]);
  });

  it("locks the prize pool only after the TD confirms, and offers to unlock it again (TN2-01)", async () => {
    mockPage(true);
    const sent: unknown[] = [];
    server.use(
      http.put("/api/tournaments/t1", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json(tournamentDto({ prizePoolLocked: true }));
      }),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await user.click(await screen.findByTestId("prize-pool-lock-card"));
    expect(await screen.findByTestId("confirm-lock")).toHaveTextContent("requests players sent before the lock can still be confirmed");
    expect(sent).toEqual([]);
    await user.click(screen.getByTestId("confirm-lock-action"));
    await waitFor(() => expect(sent).toEqual([{ prizePoolLocked: true }]));
  });

  it("keeps the lock dialog open with the server's reason when the lock is refused", async () => {
    mockPage(true);
    server.use(http.put("/api/tournaments/t1", () => apiError(403, "FORBIDDEN", "Only the club's staff can do that")));
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await user.click(await screen.findByTestId("prize-pool-lock-card"));
    await user.click(await screen.findByTestId("confirm-lock-action"));

    expect(await within(screen.getByTestId("confirm-lock")).findByRole("alert")).toHaveTextContent("Only the club's staff can do that");
    expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
  });

  it("unlocks a locked pool from the same card", async () => {
    mockPage(true, { overrides: { prizePoolLocked: true } });
    let sent: unknown;
    server.use(
      http.put("/api/tournaments/t1", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(tournamentDto());
      }),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await user.click(await screen.findByTestId("prize-pool-lock-card"));
    await user.click(within(await screen.findByTestId("confirm-lock")).getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(sent).toEqual({ prizePoolLocked: false }));
  });

  it("offers no lock, eliminate or restore once the tournament is finished, and points to Correct Results (TN2-05, P2-PRODDATA-02)", async () => {
    const finished = [
      { ...registrationDto("r1", "Ann", 1), finalPosition: 1, prizeAmount: "190.00" },
      { ...registrationDto("r2", "Bob", 1), finalPosition: 2, isEliminated: true },
    ];
    mockPage(true, { overrides: { status: "completed" }, registrations: finished });
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    expect(screen.queryByTestId("prize-pool-lock-card")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Standings" }));
    expect(await screen.findByTestId("standings-note")).toHaveTextContent("use Correct Results");
    expect(screen.queryByTestId("eliminate-player-r1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("restore-player-r2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-registration-r1")).not.toBeInTheDocument();
  });

  it("lets staff raise the max players, which QR sign-ups are held to (TN2-03)", async () => {
    mockPage(true);
    let sent: unknown;
    server.use(
      http.put("/api/tournaments/t1", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(tournamentDto({ maxPlayers: 30 }));
      }),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByTestId("edit-max-players"));
    const input = screen.getByTestId("max-players-input");
    await user.clear(input);
    await user.type(input, "30");
    await user.click(screen.getByTestId("save-max-players"));

    await waitFor(() => expect(sent).toEqual({ maxPlayers: 30 }));
  });

  it("says a hand-entered tournament's prizes were not recorded instead of showing a $0 pool (P2-PRODDATA-01)", async () => {
    const handEntered = [
      { ...registrationDto("r1", "Ann", 1), finalPosition: 1 },
      { ...registrationDto("r2", "Bob", 1), finalPosition: 2, isEliminated: true },
    ];
    mockPage(true, { overrides: { status: "completed" }, registrations: handEntered });
    renderDetails();

    expect(await screen.findByTestId("prize-pool")).toHaveTextContent(/^\$190\s*\(estimated: prizes not recorded\)$/);
    expect(screen.getByTestId("no-payouts")).toHaveTextContent("what each place was paid was never recorded");
  });

  it("counts each player's entries in words, as the clock does, with the add-ons beside them (P4REV4-R3-CQ-05)", async () => {
    mockPage(true, { registrations: [registrationDto("r1", "Ann", 1), { ...registrationDto("r2", "Bob", 1), rebuys: 1, addons: 1 }] });
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    const row = async (name: string) => within(await screen.findByRole("row", { name: new RegExp(name) }));
    expect((await row("Ann")).getByRole("cell", { name: "1 entry" })).toBeInTheDocument();
    expect((await row("Bob")).getByRole("cell", { name: "2 entries · 1 add-on" })).toBeInTheDocument();
  });

  it("removes a mistaken sign-up after the TD confirms (P2REV0-02)", async () => {
    mockPage(true);
    let removed: string | undefined;
    server.use(
      http.delete("/api/registrations/:id", ({ params }) => {
        removed = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    await user.click(await screen.findByTestId("remove-registration-r3"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove entry" }));

    await waitFor(() => expect(removed).toBe("r3"));
  });

  it("lets staff correct a finalized tournament's whole finishing order, forced after a preview (MONEY-REV-05)", async () => {
    const finished = [
      { ...registrationDto("r1", "Ann", 1), finalPosition: 1, isEliminated: false },
      { ...registrationDto("r2", "Bob", 1), finalPosition: 3, isEliminated: true },
      { ...registrationDto("r3", "Cat", 1), finalPosition: 2, isEliminated: true },
    ];
    mockPage(true, { overrides: { status: "completed" }, registrations: finished });
    const previews: unknown[] = [];
    let finalized: unknown;
    server.use(
      http.post("/api/tournaments/t1/finalize/preview", async ({ request }) => {
        previews.push(await request.json());
        return HttpResponse.json(
          previewOf({
            planHash: HASH_B,
            requiresForce: true,
            warnings: ["Finalizing again replaces the stored positions, prizes and points"],
            previous: { finalizedAt: null, rows: [{ position: 1, playerName: "Ann", amountCents: 14_250 }], results: [] },
          }),
        );
      }),
      http.post("/api/tournaments/t1/finalize", async ({ request }) => {
        finalized = await request.json();
        return HttpResponse.json(finalizeResultDto());
      }),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByTestId("correct-results"));
    expect(await screen.findByTestId("previous-payouts")).toHaveTextContent("1st Ann $142.50");
    await user.click(screen.getByRole("button", { name: "Move Bob up" }));
    await waitFor(() => expect(previews).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId("confirm-correction")).toBeEnabled());
    await user.click(screen.getByTestId("confirm-correction"));

    expect(previews[0]).toEqual({ finishOrder: ["r1", "r3", "r2"], force: true });
    await waitFor(() => expect(finalized).toEqual({ finishOrder: ["r1", "r2", "r3"], force: true, expectedPlanHash: "b".repeat(32) }));
  });

  it("shows a cancelled tournament as paying nothing, as finalize and the dashboard treat it (P2REV1-MONEY-04)", async () => {
    mockPage(true, { overrides: { status: "cancelled", prizePoolLocked: true } });
    renderDetails();

    expect(await screen.findByTestId("prize-pool")).toHaveTextContent("$0");
    expect(screen.getByTestId("prize-pool")).toHaveTextContent("(cancelled: no prizes)");
    expect(screen.getByTestId("no-payouts")).toHaveTextContent("This tournament was cancelled, so no prizes are paid.");
    expect(screen.queryByTestId("payout-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("pool-cancelled")).toBeInTheDocument();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
  });

  describe("while the tournament runs (P2REV1-MONEY-01)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps the pool in step with QR sign-ups made on players' phones, without a reload", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let registrations = field;
      server.use(
        http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto())),
        http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
        http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
      );
      renderDetails();
      expect(await screen.findByTestId("prize-pool")).toHaveTextContent("$475");

      // Dee signs up from the QR page: one more $100 entry, $5 AP.
      registrations = [...field, registrationDto("r4", "Dee", 1)];
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);

      await waitFor(() => expect(screen.getByTestId("prize-pool")).toHaveTextContent("$570"));
    });

    it("stops asking once the tournament is finished", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let registrationRequests = 0;
      server.use(
        http.get("/api/tournaments/t1", () =>
          HttpResponse.json(tournamentDto({ status: "completed" })),
        ),
        http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
        http.get("/api/tournaments/t1/registrations", () => {
          registrationRequests++;
          return HttpResponse.json(field);
        }),
      );
      renderDetails();
      await screen.findByTestId("prize-pool");
      const before = registrationRequests;

      await vi.advanceTimersByTimeAsync(3 * LIVE_REFRESH_MS);

      expect(registrationRequests).toBe(before);
    });
  });
});
