import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { pointsAllocationDto, pointsSystemDto, prizePoolSnapshotDto, seasonDto } from "@test/helpers/dto";
import { clubDto, mockTournamentPages, registrationDto, tournamentDto } from "@test/helpers/f2-public";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { CENTRAL_STARS_THEME, themeVariables } from "@shared/domain/theme";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { clockDto, liveDisplayDto } from "@test/helpers/clock-dto";
import { publicSeatingDto } from "@test/helpers/seating-dto";
import { PODIUM } from "@/components/shared/podium";
import { qk } from "@/lib/api/query-keys";
import { CLOSED_REFRESH_MS, LIVE_REFRESH_MS } from "@/lib/live-refresh";
import PublicTournamentView from "./public-tournament";

/** The page's game: a $100 freezeout with $5 AP per entry, in progress, its pool locked, seen by a player. */
const tournament = (overrides: Partial<TournamentDetailDto> = {}) =>
  tournamentDto({ status: "in_progress", buyInAmount: "100.00", rakeType: "fixed", rakeAmount: "5.00", maxPlayers: 20, prizePoolLocked: true, ...overrides });

/** One entry with `buyIns` buy-ins. */
const registration = (id: string, name: string, buyIns: number, extra: Partial<PublicRegistration> = {}) => registrationDto(id, name, { buyIns, ...extra });

/** Five buy-ins at $100 with $5 AP each: a $475 pool. */
const registrations = [registration("r1", "Ann", 2), registration("r2", "Bob", 2), registration("r3", "Cat", 1)];

function mockPage(overrides: Partial<TournamentDetailDto> = {}, regs: PublicRegistration[] = registrations) {
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json(tournament(overrides))),
    http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(regs)),
  );
}

function renderView() {
  return renderWithApp(<PublicTournamentView />, { path: "/tournament/t1", route: "/tournament/:id" });
}

/** The seat finder and the clock as the page checks them: nobody seated and no clock unless a test says so. */
function mockLiveScreens({ seated = false, clock = false }: { seated?: boolean; clock?: boolean } = {}) {
  const asked = { seating: 0, display: 0 };
  server.use(
    http.get("/api/public/tournaments/t1/seating", () => {
      asked.seating += 1;
      return HttpResponse.json(
        publicSeatingDto(seated ? { tables: [{ id: "tb1", number: 1, seats: 9, seated: { 3: { id: "r1", name: "Ann" } } }] } : {}),
      );
    }),
    http.get("/api/public/tournaments/t1/display", () => {
      asked.display += 1;
      return HttpResponse.json(liveDisplayDto({ clock: clock ? clockDto() : null }));
    }),
  );
  return asked;
}

beforeEach(() => {
  mockSignedOut();
  mockLiveScreens();
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
    const snapshot = prizePoolSnapshotDto({
      paid: [
        { position: 1, registrationId: "r2", playerId: "p-r2", playerName: "Bob", basisPoints: 6000, amountCents: 28_500 },
        { position: 2, registrationId: "r1", playerId: "p-r1", playerName: "Ann", basisPoints: 4000, amountCents: 19_000 },
      ],
    });
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

  it("names a deal the players still in made, and marks the prizes it paid (round 5, item 2)", async () => {
    const snapshot = prizePoolSnapshotDto({
      paid: [
        { position: 1, registrationId: "r2", playerId: "p-r2", playerName: "Bob", basisPoints: 6000, amountCents: 24_000 },
        { position: 2, registrationId: "r1", playerId: "p-r1", playerName: "Ann", basisPoints: 4000, amountCents: 23_500 },
      ],
      deal: {
        reason: "Chip chop at 2 handed",
        totalCents: 47_500,
        players: [
          { registrationId: "r2", playerId: "p-r2", playerName: "Bob", position: 1, plannedCents: 28_500, amountCents: 24_000 },
          { registrationId: "r1", playerId: "p-r1", playerName: "Ann", position: 2, plannedCents: 19_000, amountCents: 23_500 },
        ],
      },
    });
    mockPage({ status: "completed", prizePoolLocked: false, prizePoolSnapshot: snapshot }, [
      registration("r1", "Ann", 2, { finalPosition: 2, prizeAmount: "235.00", isEliminated: true }),
      registration("r2", "Bob", 2, { finalPosition: 1, prizeAmount: "240.00" }),
      registration("r3", "Cat", 1, { finalPosition: 3, isEliminated: true }),
    ]);
    renderView();

    expect(await screen.findByTestId("prizes-deal")).toHaveTextContent("Deal: Bob $240, Ann $235 (Chip chop at 2 handed)");
    expect(screen.getAllByText("Deal", { exact: true })).toHaveLength(2);
  });

  it("says honestly where a difference between the prizes and the money available goes (round 5, item 16)", async () => {
    // $500 in, $25 AP: $475 available. A $400 pool leaves $75, which the club keeps unless the TD says otherwise.
    mockPage({ manualPrizePool: "400.00" });
    const { unmount } = renderView();
    expect(await screen.findByTestId("public-pool-summary")).toHaveTextContent("Prize pool $400· AP $25· Kept by the club $75");
    unmount();

    server.use(http.get("/api/seasons/s1", () => HttpResponse.json(seasonDto({ id: "s1", name: "Winter League" }))));
    mockPage({ manualPrizePool: "400.00", prizeDifference: "carry", seasonId: "s1" });
    const carried = renderView();
    await waitFor(() => expect(screen.getByTestId("public-pool-summary")).toHaveTextContent("Prize pool $400· AP $25· Carried over to Winter League $75"));
    carried.unmount();

    // A $600 pool is $125 more than came in for prizes: the club adds it.
    mockPage({ manualPrizePool: "600.00" });
    renderView();
    expect(await screen.findByTestId("public-pool-summary")).toHaveTextContent("Prize pool $600· AP $25· Added by the club $125");
  });

  it("says nothing more than the pool when the prizes are what is available, or before the pool is revealed", async () => {
    mockPage();
    const { unmount } = renderView();
    expect(await screen.findByText("Total prize pool: $475")).toBeInTheDocument();
    expect(screen.queryByTestId("public-pool-summary")).not.toBeInTheDocument();
    unmount();

    mockPage({ manualPrizePool: "400.00", prizePoolLocked: false });
    renderView();
    expect(await screen.findByText("Prize pool will be revealed when locked")).toBeInTheDocument();
    expect(screen.queryByTestId("public-pool-summary")).not.toBeInTheDocument();
  });

  it("says where the difference went as finalize froze it", async () => {
    const snapshot = prizePoolSnapshotDto({
      paid: [
        { position: 1, registrationId: "r2", playerId: "p-r2", playerName: "Bob", basisPoints: 6000, amountCents: 25_500 },
        { position: 2, registrationId: "r1", playerId: "p-r1", playerName: "Ann", basisPoints: 4000, amountCents: 17_000 },
      ],
    });
    const difference = {
      choice: "club" as const,
      availableCents: 47_500,
      setCents: 42_500,
      cents: 5_000,
      keptByClubCents: 5_000,
      addedToPrizesCents: 0,
      carriedOverCents: 0,
      addedByClubCents: 0,
    };
    const frozen = { ...snapshot, pool: { ...snapshot.pool, netCents: 42_500, impliedRakeCents: 7_500, difference } };
    mockPage({ status: "completed", prizePoolLocked: false, prizePoolSnapshot: frozen }, [
      registration("r1", "Ann", 2, { finalPosition: 2, prizeAmount: "170.00", isEliminated: true }),
      registration("r2", "Bob", 2, { finalPosition: 1, prizeAmount: "255.00" }),
      registration("r3", "Cat", 1, { finalPosition: 3, isEliminated: true }),
    ]);
    renderView();

    expect(await screen.findByTestId("public-pool-summary")).toHaveTextContent("Prize pool $425· AP $25· Kept by the club $50");
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
        return HttpResponse.json(tournament({ manualPrizePool }));
      }),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto({ rakeLabel: null }))),
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
      http.get("/api/points-systems/ps1", () => HttpResponse.json(pointsSystemDto({ name: "Season", participationPoints: 10 }))),
      http.get("/api/points-systems/ps1/allocations", () =>
        HttpResponse.json([
          pointsAllocationDto({ id: "a1", position: 1, points: 50 }),
          pointsAllocationDto({ id: "a2", position: 2, points: 30 }),
          pointsAllocationDto({ id: "a3", position: 3, points: 20 }),
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

describe("PublicTournamentView points, written like every other count (P3REV3-CQ-11)", () => {
  it("groups a place's points in thousands, as the season's points system and leaderboard do", async () => {
    mockPage({ trackPoints: true, pointsSystemId: "ps1", payoutStructure: "standard" });
    server.use(
      http.get("/api/points-systems/ps1", () => HttpResponse.json(pointsSystemDto({ name: "Season", participationPoints: 1000 }))),
      http.get("/api/points-systems/ps1/allocations", () => HttpResponse.json([pointsAllocationDto({ id: "a1", position: 1, points: 1250 })])),
    );
    renderView();

    await waitFor(() => expect(screen.getByTestId("points-1")).toHaveTextContent("1,250 pts"));
    expect(screen.getByTestId("points-others")).toHaveTextContent("1,000 pts");
  });
});

describe("PublicTournamentView points while the rules load (P3REV3-CQ-01)", () => {
  it("shows no points until the system and its allocations are both in, and says so when they failed", async () => {
    mockPage({ trackPoints: true, pointsSystemId: "ps1", payoutStructure: "standard" });
    let answer: () => void = () => {};
    let allocationsAsked = 0;
    server.use(
      http.get("/api/points-systems/ps1", () => HttpResponse.json(pointsSystemDto({ name: "Season", participationPoints: 10 }))),
      http.get("/api/points-systems/ps1/allocations", async () => {
        allocationsAsked += 1;
        if (allocationsAsked === 1) {
          await new Promise<void>((resolve) => (answer = resolve));
          return apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now");
        }
        return HttpResponse.json([pointsAllocationDto({ id: "a1", position: 1, points: 50 })]);
      }),
    );
    const user = userEvent.setup();
    renderView();

    // The system is in, its allocations are not: 1st shows a placeholder, never participation points or 0.
    const first = await screen.findByTestId("points-1");
    await waitFor(() => expect(allocationsAsked).toBe(1));
    expect(first).toHaveTextContent("Loading");
    expect(screen.queryByText(/\d+ pts/)).toBeNull();
    expect(screen.queryByTestId("points-others")).toBeNull();

    answer();
    expect(await screen.findByTestId("points-failed")).toHaveTextContent("could not be loaded");
    expect(screen.getByTestId("points-1")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText(/\d+ pts/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("points-1")).toHaveTextContent("50 pts"));
    expect(screen.queryByTestId("points-failed")).toBeNull();
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

describe("PublicTournamentView loading, missing and failing", () => {
  it("says the tournament is not found for a 404, with a way on", async () => {
    server.use(http.get("/api/tournaments/t1", () => apiError(404, "NOT_FOUND", "Tournament not found")));
    renderView();

    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find a club" })).toHaveAttribute("href", "/home");
  });

  it("shows the server's reason when the tournament could not be loaded, and tries again", async () => {
    let fail = true;
    server.use(
      http.get("/api/tournaments/t1", () =>
        fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json(tournamentDto({ status: "in_progress" })),
      ),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderView();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The tournament could not be loaded");
    expect(alert).toHaveTextContent("Something went wrong on our side. Please try again.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Friday Freezeout" })).toBeInTheDocument();
  });

  it("says when the players could not be loaded instead of showing an empty tournament", async () => {
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ status: "in_progress" }))),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
      http.get("/api/tournaments/t1/registrations", () => apiError(503, "SERVICE_UNAVAILABLE", "Busy")),
    );
    renderView();

    expect(await screen.findByText("The players could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText(/Total prize pool/)).not.toBeInTheDocument();
  });
});

describe("PublicTournamentView header", () => {
  it("names the club with a link to its page by slug, and keeps search engines away (PUB-12, CC-19)", async () => {
    mockTournamentPages(tournamentDto());
    renderView();

    const clubLink = await screen.findByRole("link", { name: /Central Stars/ });
    expect(clubLink).toHaveAttribute("href", "/club/central-stars");
    expect(document.title).toBe("Friday Freezeout | LovePoker.club");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  it("shows the start in the club's time zone, Auckland unless the club says otherwise (PUB-19)", async () => {
    // 07:00 UTC on 23 Oct 2026 is 8 pm in Auckland (NZDT) and 6 pm in Sydney (AEDT).
    mockTournamentPages(tournamentDto());
    const { unmount } = renderView();
    expect(await screen.findByText("Fri, 23 Oct 2026")).toBeInTheDocument();
    expect(screen.getAllByText("8:00 pm").length).toBeGreaterThan(0);
    unmount();

    mockTournamentPages(tournamentDto(), [], clubDto({ timezone: "Australia/Sydney" }));
    renderView();
    await waitFor(() => expect(screen.getAllByText("6:00 pm").length).toBeGreaterThan(0));
  });

  it("offers Register Now while sign-up is open, linking to the sign-up page", async () => {
    mockTournamentPages(tournamentDto({ status: "registration" }));
    renderView();

    expect(await screen.findByRole("link", { name: "Register Now" })).toHaveAttribute("href", "/register/t1");
    expect(screen.getByText("Registration Open")).toBeInTheDocument();
  });
});

describe("PublicTournamentView high hand (PUB-13)", () => {
  it("shows the high-hand amount as each player's entry fee, and the pot it makes once the pool is shown", async () => {
    mockTournamentPages(tournamentDto({ status: "in_progress", enableHighHand: true, highHandAmount: "20.00", prizePoolLocked: true }), [
      registrationDto("r1", "Ann", { enteringHighHands: true }),
      registrationDto("r2", "Bob", { enteringHighHands: true }),
      registrationDto("r3", "Cat"),
    ]);
    renderView();

    expect(await screen.findByText("High hand entry (optional)")).toBeInTheDocument();
    expect(await screen.findByTestId("high-hand-pot")).toHaveTextContent("High hand pot: $40");
    expect(screen.queryByText(/Additional prize/)).not.toBeInTheDocument();
  });

  it("keeps the pot hidden while the prize pool is", async () => {
    mockTournamentPages(tournamentDto({ status: "in_progress", enableHighHand: true, highHandAmount: "20.00" }), [
      registrationDto("r1", "Ann", { enteringHighHands: true }),
    ]);
    renderView();

    expect(await screen.findByText("Prize pool will be revealed when locked")).toBeInTheDocument();
    expect(screen.queryByTestId("high-hand-pot")).not.toBeInTheDocument();
  });
});

describe("PublicTournamentView standings (PUB-25)", () => {
  it("gives players still in no made-up rank, and busted players the place they finished in", async () => {
    mockTournamentPages(tournamentDto({ status: "in_progress" }), [
      registrationDto("r1", "Ann"),
      registrationDto("r2", "Bob", { isEliminated: true, eliminationTime: "2026-10-23T08:00:00.000Z" }),
      registrationDto("r3", "Cat", { isEliminated: true, eliminationTime: "2026-10-23T09:00:00.000Z" }),
    ]);
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    const rows = within(await screen.findByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => [within(row).getAllByRole("cell")[0].textContent, within(row).getAllByRole("cell")[2].textContent])).toEqual([
      ["–Still in", "Active"],
      ["2", "Eliminated"],
      ["3", "Eliminated"],
    ]);
    expect(screen.getByText("Current Standings")).toBeInTheDocument();
  });

  it("shows each finisher's place once the tournament is over, never 'Active' for the winner", async () => {
    mockTournamentPages(tournamentDto({ status: "completed" }), [
      registrationDto("r1", "Ann", { finalPosition: 1, prizeAmount: "100.00" }),
      registrationDto("r2", "Bob", { finalPosition: 2, isEliminated: true }),
    ]);
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    expect(await screen.findByText("Final Results")).toBeInTheDocument();
    const winner = screen.getByTestId("standing-player-r1").closest("tr") as HTMLElement;
    // Once in its Status column, and once under the name, where a phone shows it.
    expect(within(winner).getAllByText("1st")).toHaveLength(2);
    expect(within(winner).getByText("$100")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    // The podium's own fills, as on the TD's page and in the prize tables (P3REV3-CQ-09).
    expect(within(winner).getByTestId("place-badge")).toHaveClass(...PODIUM[1].split(" "));
    const second = screen.getByTestId("standing-player-r2").closest("tr") as HTMLElement;
    expect(within(second).getByTestId("place-badge")).toHaveClass(...PODIUM[2].split(" "));
  });

  it("ranks the season leaderboard as the server does, tied players sharing a rank", async () => {
    mockTournamentPages(tournamentDto({ status: "in_progress", seasonId: "s1" }), [registrationDto("r1", "Ann")]);
    server.use(
      http.get("/api/seasons/s1", () =>
        HttpResponse.json(seasonDto({ name: "Spring 2026" })),
      ),
      http.get("/api/seasons/s1/leaderboard", () =>
        HttpResponse.json([
          { rank: 1, player: { id: "p1", name: "Ann", imageUrl: null }, points: 1200, tournaments: 3 },
          { rank: 1, player: { id: "p2", name: "Bob", imageUrl: null }, points: 1200, tournaments: 3 },
          { rank: 3, player: { id: "p3", name: "Cat", imageUrl: null }, points: 80, tournaments: 1 },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    await user.click(await screen.findByRole("tab", { name: "Season Spring 2026" }));
    const board = within(await screen.findByRole("table"));
    const ranks = board.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(ranks).toEqual(["1", "1", "3"]);
    expect(board.getAllByText("1,200")).toHaveLength(2);
  });

  it("says nobody has registered yet when the list is empty", async () => {
    mockTournamentPages(tournamentDto({ status: "registration" }), []);
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    expect(await screen.findByText("No players registered yet")).toBeInTheDocument();
  });
});

describe("PublicTournamentView waiting list (round 5, item 15)", () => {
  /** A field of three, full, and two sign-ups behind it, numbered by the server (sign-up order: Eve first). */
  const fullField = [
    registration("r1", "Ann", 1, { waitingListPosition: null }),
    registration("r2", "Bob", 1, { waitingListPosition: null }),
    registration("r3", "Cat", 1, { waitingListPosition: null, isEliminated: true, eliminationTime: "2026-10-23T08:00:00.000Z" }),
    registration("r4", "Dee", 1, { waitingListPosition: 2 }),
    registration("r5", "Eve", 1, { waitingListPosition: 1 }),
  ];

  it("counts only the field against Max players, and the waiting list apart (390 px)", async () => {
    screenWidth(390);
    mockPage({ maxPlayers: 3 }, fullField);
    renderView();

    expect(await screen.findByTestId("waiting-list-count")).toHaveTextContent("+2 on the waiting list");
    expect(screen.getByText("Players").parentElement).toHaveTextContent(/^Players3\/3\+2 on the waiting list$/);
    expect(screen.getByText("Active").parentElement).toHaveTextContent(/^Active2$/);
    // The pool is the field's: three $100 buy-ins less $5 AP each, nobody on the list (shared/domain poolEntries).
    expect(await screen.findByText("Total prize pool: $285")).toBeInTheDocument();
  });

  it("numbers the waiting list under the standings, next in first, and leaves its players out of the standings", async () => {
    screenWidth(390);
    mockPage({ maxPlayers: 3 }, fullField);
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    const standings = await screen.findByRole("table");
    expect(within(standings).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual([
      expect.stringContaining("Ann"),
      expect.stringContaining("Bob"),
      expect.stringContaining("Cat"),
    ]);
    expect(within(standings).queryByText("Dee")).not.toBeInTheDocument();
    const list = within(screen.getByTestId("waiting-list"));
    expect(list.getByRole("heading", { name: "Waiting list" })).toBeInTheDocument();
    expect(list.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["#1Number 1EEve", "#2Number 2DDee"]);
  });

  it("shows no waiting list once the tournament is over: its players never played", async () => {
    mockPage({ maxPlayers: 3, status: "completed" }, fullField);
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    expect(await screen.findByText("Final Results")).toBeInTheDocument();
    expect(screen.queryByTestId("waiting-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("waiting-list-count")).not.toBeInTheDocument();
    expect(screen.getByText("Players").parentElement).toHaveTextContent(/^Players3\/3$/);
  });
});

describe("PublicTournamentView polling (PUB-11)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops asking again once the tournament is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked = mockTournamentPages(tournamentDto({ status: "completed" }), [registrationDto("r1", "Ann", { finalPosition: 1 })]);
    renderView();
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    await waitFor(() => expect(asked.registrations()).toBe(1));

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3);

    expect(asked.detail()).toBe(1);
    expect(asked.registrations()).toBe(1);
  });

  it("fetches the results once more when the tournament it follows is finalized, even after a poll that missed them (P3REV0-PARITY-01)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const finalizedAt = new Date().toISOString();
    let finalized = false;
    let registrationRequests = 0;
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(finalized ? tournamentDto({ status: "completed", finalizedAt }) : tournamentDto({ status: "in_progress" }))),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
      http.get("/api/tournaments/t1/registrations", () => {
        registrationRequests += 1;
        return HttpResponse.json(
          finalized
            ? [
                registrationDto("r1", "Ann", { finalPosition: 1, prizeAmount: "70.00" }),
                registrationDto("r2", "Bob", { finalPosition: 2, prizeAmount: "30.00", isEliminated: true }),
              ]
            : [registrationDto("r1", "Ann"), registrationDto("r2", "Bob")],
        );
      }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { queryClient } = renderView();
    expect(await screen.findByText("In Progress")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);
    const polled = registrationRequests;

    // The TD finalizes just after the registrations' last poll, and the tournament's poll is the first to see it.
    finalized = true;
    await act(() => queryClient.refetchQueries({ queryKey: qk.tournaments.detail("t1"), exact: true }));
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Standings" }));

    const results = within(await screen.findByRole("region", { name: "Final results" }));
    await waitFor(() => expect(results.getByText("$70")).toBeInTheDocument());
    expect(results.getByText("$30")).toBeInTheDocument();
    expect(registrationRequests).toBe(polled + 1);
  });

  it("keeps a finished tournament on a slow poll for a while, so a Correct Results reaches a screen left open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked = mockTournamentPages(tournamentDto({ status: "completed", finalizedAt: new Date().toISOString() }), [
      registrationDto("r1", "Ann", { finalPosition: 1 }),
    ]);
    renderView();
    expect(await screen.findByText("Completed")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(CLOSED_REFRESH_MS + 100);

    expect(asked.detail()).toBe(2);
  });
});

describe("PublicTournamentView after the game (P3REV0-PARITY-02, P3REV4-PERF-D)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never claims the final results are out of date while a finished tournament is followed slowly", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const asked = mockTournamentPages(tournamentDto({ status: "completed", finalizedAt: new Date().toISOString() }), [
      registrationDto("r1", "Ann", { finalPosition: 1, prizeAmount: "100.00" }),
    ]);
    renderView();
    expect(await screen.findByText("Completed")).toBeInTheDocument();

    // The tournament is asked again every minute; its registrations are not polled once it is over.
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(asked.detail()).toBeGreaterThan(4);
    expect(asked.registrations()).toBe(1);
    expect(screen.queryByText(/Not updated since/)).not.toBeInTheDocument();
  });

  it("says the tournament is gone, and stops asking, once it was deleted while the page was open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let deleted = false;
    let detailRequests = 0;
    server.use(
      http.get("/api/tournaments/t1", () => {
        detailRequests += 1;
        return deleted ? apiError(404, "NOT_FOUND", "Tournament not found") : HttpResponse.json(tournamentDto({ status: "in_progress" }));
      }),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
      http.get("/api/tournaments/t1/registrations", () =>
        deleted ? apiError(404, "NOT_FOUND", "Tournament not found") : HttpResponse.json([registrationDto("r1", "Ann")]),
      ),
    );
    renderView();
    expect(await screen.findByText("In Progress")).toBeInTheDocument();

    deleted = true;
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);
    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
    const asked = detailRequests;

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 4);
    expect(detailRequests).toBe(asked);
  });
});

describe("PublicTournamentView on a phone that is unlocked again (P3REV4-PERF-06)", () => {
  afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
  });

  it("asks again for the tournament, not for its club, season or points rules, which rarely change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const lookups: string[] = [];
    let detailRequests = 0;
    server.use(
      http.get("/api/tournaments/t1", () => {
        detailRequests += 1;
        return HttpResponse.json(tournamentDto({ status: "completed", seasonId: "s1", pointsSystemId: "ps1", trackPoints: true }));
      }),
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([registrationDto("r1", "Ann", { finalPosition: 1 })])),
      http.get("/api/clubs/c1", () => {
        lookups.push("club");
        return HttpResponse.json(clubDto());
      }),
      http.get("/api/seasons/s1", () => {
        lookups.push("season");
        return HttpResponse.json(seasonDto({ name: "Summer" }));
      }),
      http.get("/api/points-systems/ps1", () => {
        lookups.push("points");
        return HttpResponse.json(pointsSystemDto({ name: "Season", participationPoints: 5 }));
      }),
      http.get("/api/points-systems/ps1/allocations", () => {
        lookups.push("allocations");
        return HttpResponse.json([]);
      }),
    );
    renderView();
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    await waitFor(() => expect(lookups).toHaveLength(4));

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(detailRequests).toBe(2));
    expect(lookups).toHaveLength(4);
  });
});

describe("PublicTournamentView tabs (P3REV5-CQ-03)", () => {
  it("draws its tabs, and the standings' own, through the app's one tab host: 40 px each", async () => {
    mockPage({}, registrations);
    const user = userEvent.setup();
    renderView();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Details", "Standings", "Activity"]);
    for (const tab of tabs) expect(tab).toHaveClass("min-h-10");
    await user.click(screen.getByRole("tab", { name: "Standings" }));
    expect(await screen.findByRole("tab", { name: "Tournament" })).toHaveClass("min-h-10");
  });

  it("names the standings' own tabs in a word each, so both fit a phone, the season's name said with its tab", async () => {
    mockTournamentPages(tournamentDto({ status: "in_progress", seasonId: "s1" }), [registrationDto("r1", "Ann")]);
    server.use(
      http.get("/api/seasons/s1", () => HttpResponse.json(seasonDto({ name: "Central Stars Winter Series 2026" }))),
      http.get("/api/seasons/s1/leaderboard", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    const season = await screen.findByRole("tab", { name: "Season Central Stars Winter Series 2026" });
    const inner = within(season.parentElement as HTMLElement).getAllByRole("tab");
    expect(inner.map((tab) => tab.textContent)).toEqual(["Tournament", "Season Central Stars Winter Series 2026"]);
    expect(within(season).getByText("Central Stars Winter Series 2026")).toHaveClass("sr-only");
  });
});

describe("PublicTournamentView outline (MA-06)", () => {
  it("gives each section a heading under the tournament's, so a screen reader can move between them", async () => {
    mockTournamentPages(tournamentDto({ status: "registration", description: "Deep stacks", enableHighHand: true, highHandAmount: "10.00" }));
    renderView();

    expect(await screen.findByRole("heading", { level: 1, name: "Friday Freezeout" })).toBeInTheDocument();
    for (const section of ["About This Tournament", "Entry Details", "High Hand"]) {
      expect(screen.getByRole("heading", { level: 2, name: section })).toBeInTheDocument();
    }
  });
});

describe("PublicTournamentView participation points row (PUB-25)", () => {
  it("labels everyone after the last listed place by where it starts, not by the tournament's player cap", async () => {
    mockTournamentPages(
      tournamentDto({ status: "registration", trackPoints: true, pointsSystemId: "ps1", maxPlayers: 50 }),
      [registrationDto("r1", "Ann"), registrationDto("r2", "Bob"), registrationDto("r3", "Cat")],
    );
    server.use(
      http.get("/api/points-systems/ps1", () => HttpResponse.json(pointsSystemDto({ name: "Season", participationPoints: 5 }))),
      http.get("/api/points-systems/ps1/allocations", () => HttpResponse.json([pointsAllocationDto({ id: "a1", position: 1, points: 50 })])),
    );
    renderView();

    expect(await screen.findByText("4th place and below")).toBeInTheDocument();
    expect(screen.getByTestId("points-others")).toHaveTextContent("5 pts");
  });
});

describe("PublicTournamentView on patchy venue Wi-Fi", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps showing the tournament when a later poll fails, and catches up when the next one works", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: "ok" | "fail" = "ok";
    let entrants = [registrationDto("r1", "Ann")];
    server.use(
      http.get("/api/tournaments/t1", () => (answer === "ok" ? HttpResponse.json(tournamentDto({ status: "in_progress" })) : apiError(503, "SERVICE_UNAVAILABLE", "Busy"))),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
      http.get("/api/tournaments/t1/registrations", () => (answer === "ok" ? HttpResponse.json(entrants) : apiError(503, "SERVICE_UNAVAILABLE", "Busy"))),
    );
    renderView();
    expect(await screen.findByText("1/40")).toBeInTheDocument();

    answer = "fail";
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);
    expect(screen.getByRole("heading", { level: 1, name: "Friday Freezeout" })).toBeInTheDocument();
    expect(screen.getByText("1/40")).toBeInTheDocument();
    expect(screen.queryByText("The players could not be loaded")).not.toBeInTheDocument();
    // ...but says the figures may be out of date (P3REV4-PERF-03).
    expect(await screen.findByText(/Not updated since/)).toBeInTheDocument();

    answer = "ok";
    entrants = [registrationDto("r1", "Ann"), registrationDto("r2", "Bob")];
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100);
    await waitFor(() => expect(screen.getByText("2/40")).toBeInTheDocument());
    expect(screen.queryByText(/Not updated since/)).not.toBeInTheDocument();
  });
});

describe("PublicTournamentView links to the night's other screens", () => {
  it("offers nothing before seats are drawn or the clock is set up, in a game outside any season", async () => {
    mockPage();
    renderView();

    expect(await screen.findByText("Total prize pool: $475")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Tournament screens" })).not.toBeInTheDocument();
  });

  it("offers Find your seat once anyone is seated, the live clock once it is set up, and the season's leaderboard", async () => {
    mockPage({ seasonId: "s1" });
    server.use(http.get("/api/seasons/s1", () => HttpResponse.json(seasonDto({ id: "s1" }))));
    mockLiveScreens({ seated: true, clock: true });
    renderView();

    const links = await screen.findByRole("navigation", { name: "Tournament screens" });
    expect(await within(links).findByRole("link", { name: "Find your seat" })).toHaveAttribute("href", "/tournament/t1/seats");
    expect(await within(links).findByRole("link", { name: "Live clock" })).toHaveAttribute("href", "/clock/t1");
    expect(within(links).getByRole("link", { name: "Season leaderboard" })).toHaveAttribute("href", "/season/s1");
  });

  it("checks again while the game is open, so the seat finder appears once seats are drawn", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockPage();
      const asked = mockLiveScreens();
      renderView();
      expect(await screen.findByText("Total prize pool: $475")).toBeInTheDocument();
      await waitFor(() => expect(asked.seating).toBe(1));

      mockLiveScreens({ seated: true });
      await vi.advanceTimersByTimeAsync(60_000 + 100);

      expect(await screen.findByRole("link", { name: "Find your seat" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops checking for a screen once it is there, and checks a game only scheduled once (P4REV3-LOAD-03)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockPage();
      const asked = mockLiveScreens({ seated: true, clock: true });
      const { unmount } = renderView();
      expect(await screen.findByRole("link", { name: "Live clock" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Find your seat" })).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(asked).toEqual({ seating: 1, display: 1 });
      unmount();

      mockPage({ status: "scheduled" });
      const scheduled = mockLiveScreens();
      renderView();
      await waitFor(() => expect(scheduled).toEqual({ seating: 1, display: 1 }));
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      expect(scheduled).toEqual({ seating: 1, display: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for neither once the tournament is over", async () => {
    mockPage({ status: "completed" });
    const asked = mockLiveScreens({ seated: true, clock: true });
    renderView();

    expect(await screen.findByRole("heading", { name: "Friday Freezeout", level: 1 })).toBeInTheDocument();
    expect(asked).toEqual({ seating: 0, display: 0 });
    expect(screen.queryByRole("link", { name: "Find your seat" })).not.toBeInTheDocument();
  });
});

describe("PublicTournamentView in the club's colours (round 5, item 13)", () => {
  // <html> outlives each test's app: start every test from no colours set on it.
  beforeEach(() => document.documentElement.removeAttribute("style"));

  it("wears the club's theme, worked out for the light public page", async () => {
    mockTournamentPages(tournamentDto(), [], clubDto({ theme: CENTRAL_STARS_THEME }));
    renderView();

    await screen.findByRole("link", { name: /Central Stars/ });
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--primary")).toBe(themeVariables(CENTRAL_STARS_THEME, "light")["--primary"]));
  });

  it("keeps the LovePoker look for a club without a theme", async () => {
    mockTournamentPages(tournamentDto(), [], clubDto({ theme: null }));
    renderView();

    await screen.findByRole("link", { name: /Central Stars/ });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
  });
});
