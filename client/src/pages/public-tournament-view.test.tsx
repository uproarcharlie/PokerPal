import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { LIVE_REFRESH_MS } from "@/lib/live-refresh";
import PublicTournamentView from "./public-tournament-view";

const tournament = {
  id: "t1",
  name: "Friday Freezeout",
  clubId: "c1",
  seasonId: null,
  pointsSystemId: null,
  startDateTime: "2026-10-23T07:00:00.000Z",
  status: "in_progress",
  buyInAmount: "100.00",
  rebuyAmount: null,
  addonAmount: null,
  maxPlayers: 20,
  enableHighHand: false,
  highHandAmount: null,
  payoutStructure: "standard",
  customPayouts: null,
  rakeType: "fixed",
  rakeAmount: "5.00",
  manualPrizePool: null,
  rakeOverride: null,
  trackPoints: false,
  prizePoolLocked: true,
  prizePoolSnapshot: null,
  viewer: { canManage: false },
};

const registration = (id: string, name: string, buyIns: number, extra: Record<string, unknown> = {}) => ({
  id,
  tournamentId: "t1",
  playerId: `p-${id}`,
  buyIns,
  rebuys: 0,
  addons: 0,
  isEliminated: false,
  eliminationTime: null,
  knockouts: 0,
  enteringHighHands: false,
  finalPosition: null,
  prizeAmount: null,
  player: { id: `p-${id}`, name, imageUrl: null },
  ...extra,
});

/** Five buy-ins at $100 with $5 AP each: a $475 pool. */
const registrations = [registration("r1", "Ann", 2), registration("r2", "Bob", 2), registration("r3", "Cat", 1)];

function mockPage(overrides: Record<string, unknown> = {}, regs: unknown[] = registrations) {
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json({ ...tournament, ...overrides })),
    http.get("/api/clubs/c1", () => HttpResponse.json({ id: "c1", name: "Central Stars", slug: "central-stars", rakeLabel: "AP" })),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(regs)),
  );
}

function renderView() {
  return renderWithApp(<PublicTournamentView />, { path: "/tournament/t1", route: "/tournament/:id" });
}

beforeEach(() => {
  mockSignedOut();
});

describe("PublicTournamentView prize pool", () => {
  it("shows the v2 payouts finalize will pay once the pool is locked", async () => {
    mockPage();
    renderView();

    expect(await screen.findByText("Total prize pool: $475")).toBeInTheDocument();
    // Floor per place, remainder to 1st: $238 + $142 + $95 = $475 (legacy rounding showed $143 for 2nd).
    expect(screen.getByText("$238")).toBeInTheDocument();
    expect(screen.getByText("$142")).toBeInTheDocument();
    expect(screen.getByText("$95")).toBeInTheDocument();
  });

  it("pays from the manual prize pool, as the admin page and finalize do", async () => {
    mockPage({ manualPrizePool: "600.00" });
    renderView();

    expect(await screen.findByText("Total prize pool: $600")).toBeInTheDocument();
    expect(screen.getByText("$300")).toBeInTheDocument();
  });

  it("lists only the places finalize would pay, and says what the rest of the pool waits for (MONEY-REV-01)", async () => {
    mockPage({}, [registration("r1", "Ann", 1), registration("r2", "Bob", 1)]);
    renderView();

    expect(await screen.findByTestId("undistributed")).toHaveTextContent("Only 2 players: $38 of the pool is not paid out unless more players enter.");
    expect(screen.getByText("$95")).toBeInTheDocument();
    expect(screen.getByText("$57")).toBeInTheDocument();
    expect(screen.queryByText("3rd Place")).not.toBeInTheDocument();
  });

  it("keeps the amounts hidden until the pool is locked", async () => {
    mockPage({ prizePoolLocked: false });
    renderView();

    expect(await screen.findByText("Prize pool will be revealed when locked")).toBeInTheDocument();
    expect(screen.getAllByText("TBD")).toHaveLength(3);
  });

  it("shows what was paid once completed, from the snapshot", async () => {
    const snapshot = {
      pool: { netCents: 47_500 },
      paid: [
        { position: 1, registrationId: "r2", playerId: "p-r2", playerName: "Bob", basisPoints: 6000, amountCents: 28_500 },
        { position: 2, registrationId: "r1", playerId: "p-r1", playerName: "Ann", basisPoints: 4000, amountCents: 19_000 },
      ],
    };
    mockPage({ status: "completed", prizePoolLocked: false, prizePoolSnapshot: snapshot }, [
      registration("r1", "Ann", 2, { finalPosition: 2, prizeAmount: "190.00", isEliminated: true }),
      registration("r2", "Bob", 2, { finalPosition: 1, prizeAmount: "285.00" }),
      registration("r3", "Cat", 1, { finalPosition: 3, isEliminated: true }),
    ]);
    renderView();

    expect(await screen.findByText("Total prize pool: $475")).toBeInTheDocument();
    expect(screen.getByText("$285")).toBeInTheDocument();
    expect(screen.getByText("$190")).toBeInTheDocument();
    expect(screen.queryByText("TBD")).not.toBeInTheDocument();
  });
});

describe("PublicTournamentView stays in step with the TD (MONEY-P2REV-02)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks up a manual prize pool the TD sets after the page opened, without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let manualPrizePool: string | null = null;
    let detailRequests = 0;
    server.use(
      http.get("/api/tournaments/t1", () => {
        detailRequests++;
        return HttpResponse.json({ ...tournament, manualPrizePool });
      }),
      http.get("/api/clubs/c1", () => HttpResponse.json({ id: "c1", name: "Central Stars", slug: "central-stars" })),
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
    );
    renderView();
    expect(await screen.findByText("Total prize pool: $475")).toBeInTheDocument();

    manualPrizePool = "300.00";
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);

    await waitFor(() => expect(screen.getByText("Total prize pool: $300")).toBeInTheDocument());
    expect(detailRequests).toBeGreaterThan(1);
  });
});

describe("PublicTournamentView for a tournament whose results were entered by hand (P2-PRODDATA-01)", () => {
  it("says the prizes were not recorded, never 'Total prize pool: $0.00'", async () => {
    mockPage({ status: "completed", prizePoolLocked: false }, [
      registration("r1", "Ann", 2, { finalPosition: 1 }),
      registration("r2", "Bob", 2, { finalPosition: 2, isEliminated: true }),
      registration("r3", "Cat", 1, { finalPosition: 3, isEliminated: true }),
    ]);
    renderView();

    expect(await screen.findByTestId("prizes-unrecorded")).toHaveTextContent("Prizes were not recorded for this tournament");
    expect(screen.queryByText(/Total prize pool/)).not.toBeInTheDocument();
  });
});

describe("PublicTournamentView points column (MONEY-P2REV-06)", () => {
  it("shows the points finalize awards: participation points for paid places with no allocation, not 0", async () => {
    // Top 9 paid, allocations for 1st to 3rd only, 10 participation points for everyone else.
    mockPage({ trackPoints: true, pointsSystemId: "ps1", payoutStructure: "top9" }, Array.from({ length: 10 }, (_, i) => registration(`r${i}`, `P${i}`, 1)));
    server.use(
      http.get("/api/points-systems/ps1", () => HttpResponse.json({ id: "ps1", name: "Season", participationPoints: 10, knockoutPoints: 0 })),
      http.get("/api/points-systems/ps1/allocations", () =>
        HttpResponse.json([
          { id: "a1", position: 1, positionEnd: null, points: 50 },
          { id: "a2", position: 2, positionEnd: null, points: 30 },
          { id: "a3", position: 3, positionEnd: null, points: 20 },
        ]),
      ),
    );
    renderView();

    await waitFor(() => expect(screen.getByTestId("points-1")).toHaveTextContent("50 pts"));
    expect(screen.getByTestId("points-4")).toHaveTextContent("10 pts");
    expect(screen.getByTestId("points-9")).toHaveTextContent("10 pts");
    expect(screen.getByTestId("points-others")).toHaveTextContent("10 pts");
  });
});

describe("PublicTournamentView for a cancelled tournament (P2REV1-MONEY-04)", () => {
  it("says no prizes are paid, even when the pool was locked before the cancel", async () => {
    mockPage({ status: "cancelled", prizePoolLocked: true });
    renderView();

    expect(await screen.findByTestId("prizes-cancelled")).toHaveTextContent("Cancelled: no prizes are paid");
    expect(screen.queryByText(/Total prize pool/)).not.toBeInTheDocument();
    expect(screen.queryByText("$285")).not.toBeInTheDocument();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
  });
});
