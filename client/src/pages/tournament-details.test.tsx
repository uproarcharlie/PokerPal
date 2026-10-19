import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { LIVE_REFRESH_MS } from "@/lib/live-refresh";
import TournamentDetails from "./tournament-details";

const tournament = {
  id: "t1",
  name: "Friday Freezeout",
  clubId: "c1",
  seasonId: null,
  startDateTime: "2026-10-23T07:00:00.000Z",
  status: "in_progress",
  buyInAmount: "100.00",
  rebuyAmount: null,
  addonAmount: null,
  rakeType: "fixed",
  rakeAmount: "5.00",
  rebuyRakeType: "none",
  rebuyRakeAmount: "0.00",
  addonRakeType: "none",
  addonRakeAmount: "0.00",
  payoutStructure: "standard",
  customPayouts: null,
  enableHighHand: false,
  enableLateRegistration: false,
  trackPoints: false,
  minPlayers: 2,
  maxPlayers: 20,
  prizePoolLocked: false,
  manualPrizePool: null,
  rakeOverride: null,
  prizePoolSnapshot: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

const registration = (id: string, name: string, buyIns: number) => ({
  id,
  tournamentId: "t1",
  playerId: `p-${id}`,
  buyIns,
  rebuys: 0,
  addons: 0,
  isEliminated: false,
  enteringHighHands: false,
  player: { id: `p-${id}`, name, imageUrl: null },
});

const field = [registration("r1", "Ann", 2), registration("r2", "Bob", 2), registration("r3", "Cat", 1)];

function mockPage(
  canManage: boolean,
  { canOwn = canManage, overrides = {}, registrations = field }: { canOwn?: boolean; overrides?: object; registrations?: object[] } = {},
) {
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json({ ...tournament, ...overrides, viewer: { canManage, canOwn } })),
    http.get("/api/clubs/c1", () => HttpResponse.json({ id: "c1", name: "Central Stars", rakeLabel: "AP" })),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
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
        HttpResponse.json({
          ok: true,
          planHash: "a".repeat(32),
          requiresForce: false,
          prizePool: { rakeLabel: "AP", breakdown: { net: 47_500, rake: { applied: 2_500 } } },
          rows: [],
          activePlayers: [],
          warnings: [],
          previous: null,
        }),
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

  it("hides the staff controls from someone who does not run the club", async () => {
    mockPage(false);
    renderDetails();

    expect(await screen.findByTestId("prize-pool")).toHaveTextContent("$475");
    expect(screen.queryByTestId("end-tournament")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
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
    mockPage(true, { registrations: [registration("r1", "Ann", 1), registration("r2", "Bob", 1)] });
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
        return HttpResponse.json({ id: "r9", player: { id: "p-dee", name: "Dee Visitor", imageUrl: null } }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderDetails();

    await user.click(await screen.findByTestId("register-player"));
    await user.type(screen.getByLabelText("Search for a player"), "Dee");
    await user.click(await screen.findByTestId("player-option-p-dee"));
    await user.click(screen.getByTestId("register-player-final"));

    expect(await screen.findByText("Dee Visitor is in.")).toBeInTheDocument();
    expect(registered).toEqual({ playerId: "p-dee", buyIns: 1, rebuys: 0, addons: 0 });
  });

  it("locks the prize pool only after the TD confirms, and offers to unlock it again (TN2-01)", async () => {
    mockPage(true);
    const sent: unknown[] = [];
    server.use(
      http.put("/api/tournaments/t1", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ...tournament, prizePoolLocked: true, viewer: { canManage: true, canOwn: true } });
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

  it("unlocks a locked pool from the same card", async () => {
    mockPage(true, { overrides: { prizePoolLocked: true } });
    let sent: unknown;
    server.use(
      http.put("/api/tournaments/t1", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...tournament, viewer: { canManage: true, canOwn: true } });
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
      { ...registration("r1", "Ann", 1), finalPosition: 1, prizeAmount: "190.00" },
      { ...registration("r2", "Bob", 1), finalPosition: 2, isEliminated: true },
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
        return HttpResponse.json({ ...tournament, maxPlayers: 30, viewer: { canManage: true, canOwn: true } });
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
      { ...registration("r1", "Ann", 1), finalPosition: 1 },
      { ...registration("r2", "Bob", 1), finalPosition: 2, isEliminated: true },
    ];
    mockPage(true, { overrides: { status: "completed" }, registrations: handEntered });
    renderDetails();

    expect(await screen.findByTestId("prize-pool")).toHaveTextContent(/^\$190\s*\(estimated: prizes not recorded\)$/);
    expect(screen.getByTestId("no-payouts")).toHaveTextContent("what each place was paid was never recorded");
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
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Delete/ }));

    await waitFor(() => expect(removed).toBe("r3"));
  });

  it("lets staff correct a finalized tournament's whole finishing order, forced after a preview (MONEY-REV-05)", async () => {
    const finished = [
      { ...registration("r1", "Ann", 1), finalPosition: 1, isEliminated: false },
      { ...registration("r2", "Bob", 1), finalPosition: 3, isEliminated: true },
      { ...registration("r3", "Cat", 1), finalPosition: 2, isEliminated: true },
    ];
    mockPage(true, { overrides: { status: "completed" }, registrations: finished });
    const previews: unknown[] = [];
    let finalized: unknown;
    server.use(
      http.post("/api/tournaments/t1/finalize/preview", async ({ request }) => {
        previews.push(await request.json());
        return HttpResponse.json({
          ok: true,
          planHash: "b".repeat(32),
          requiresForce: true,
          prizePool: { rakeLabel: "AP", breakdown: { net: 28_500, rake: { applied: 1_500 } } },
          rows: [],
          activePlayers: [],
          warnings: ["Finalizing again replaces the stored positions, prizes and points"],
          previous: { finalizedAt: null, rows: [{ position: 1, playerName: "Ann", amountCents: 14_250 }] },
        });
      }),
      http.post("/api/tournaments/t1/finalize", async ({ request }) => {
        finalized = await request.json();
        return HttpResponse.json({ success: true, message: "Tournament finalized successfully", snapshot: null });
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
        http.get("/api/tournaments/t1", () => HttpResponse.json({ ...tournament, viewer: { canManage: true, canOwn: true } })),
        http.get("/api/clubs/c1", () => HttpResponse.json({ id: "c1", name: "Central Stars", rakeLabel: "AP" })),
        http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
      );
      renderDetails();
      expect(await screen.findByTestId("prize-pool")).toHaveTextContent("$475");

      // Dee signs up from the QR page: one more $100 entry, $5 AP.
      registrations = [...field, registration("r4", "Dee", 1)];
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);

      await waitFor(() => expect(screen.getByTestId("prize-pool")).toHaveTextContent("$570"));
    });

    it("stops asking once the tournament is finished", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let registrationRequests = 0;
      server.use(
        http.get("/api/tournaments/t1", () =>
          HttpResponse.json({ ...tournament, status: "completed", viewer: { canManage: true, canOwn: true } }),
        ),
        http.get("/api/clubs/c1", () => HttpResponse.json({ id: "c1", name: "Central Stars", rakeLabel: "AP" })),
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
