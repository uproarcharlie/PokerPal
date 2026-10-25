import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, mockDeskLiveReads, phoneLayout, recordBodies, registrationDto, screenWidth, tournamentDto } from "@test/helpers/f1-tournaments";
import type { PublicRegistration } from "@shared/api/public";
import type { SeatMoveDto, TableAdviceDto } from "@shared/api/seating";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { PODIUM } from "@/components/shared/podium";
import { qk } from "@/lib/api/query-keys";
import { LIVE_REFRESH_MS } from "@/lib/live-refresh";
import { pausedClock, serveDisplay } from "@test/helpers/clock-dto";
import { prizePoolDto } from "@test/helpers/ap-dto";
import { seasonDto } from "@test/helpers/dto";
import { mockSeating, recordWrite, seatingDto, seatingMutation, seatMove, seatRef } from "@test/helpers/seating-dto";
import { SEATING_BADGE_REFRESH_MS } from "@/features/seating/staff-hooks";
import TournamentDetailsPage from "./tournament-details";

const field = [registrationDto("r1", "Ann", 2), registrationDto("r2", "Bob", 2), registrationDto("r3", "Cat", 1)];

/** The table advisor's "balance them" for these moves (SeatingDto.advisor, round 5). */
const balanceAdvice = (moves: SeatMoveDto[]): TableAdviceDto => ({
  kind: "balance",
  message: `Tables are uneven: balance them (${moves.length} move)`,
  tableId: null,
  tableNumber: null,
  moves,
  players: 2,
});

function mockDesk(tournament: Partial<TournamentDetailDto> = {}, registrations: PublicRegistration[] = field) {
  mockDeskLiveReads(tournamentDto(tournament), registrations);
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto(tournament))),
    http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
    http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([])),
  );
}

/** Records the bodies sent to PUT `path`, answering with the tournament or registration as it was. */
function mockPut(path: string, answer: () => Response = () => HttpResponse.json(tournamentDto())) {
  const sent = recordBodies();
  server.use(
    http.put(path, async ({ request }) => {
      await sent.record(request);
      return answer();
    }),
  );
  return sent.bodies;
}

function renderDesk(path = "/admin/tournaments/t1") {
  const user = userEvent.setup();
  const view = renderWithApp(<TournamentDetailsPage />, { path, route: "/admin/tournaments/:id" });
  return { user, ...view };
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("TournamentDetailsPage: loading and errors", () => {
  it("says a tournament that does not exist was not found, with a way back", async () => {
    server.use(
      http.get("/api/tournaments/t1", () => apiError(404, "NOT_FOUND", "Tournament not found")),
      http.get("/api/tournaments/t1/registrations", () => apiError(404, "NOT_FOUND", "Tournament not found")),
    );
    renderDesk();

    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Tournaments" })).toHaveAttribute("href", "/tournaments");
  });

  it("asks once for a tournament that does not exist, and never polls it (P3REV2-CQ-01)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let asked = 0;
    server.use(
      http.get("/api/tournaments/t1", () => {
        asked += 1;
        return apiError(404, "NOT_FOUND", "Tournament not found");
      }),
      http.get("/api/tournaments/t1/registrations", () => apiError(404, "NOT_FOUND", "Tournament not found")),
    );
    renderDesk();
    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 4);

    expect(asked).toBe(1);
    expect(screen.getByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("asks for the players alongside the tournament, not after it (P3REV4-PERF-07)", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const tournamentAnswered = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/tournaments/t1", async () => {
        order.push("tournament");
        await tournamentAnswered;
        return HttpResponse.json(tournamentDto());
      }),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
      http.get("/api/tournaments/t1/registrations", () => {
        order.push("registrations");
        return HttpResponse.json(field);
      }),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([])),
    );
    renderDesk();

    await waitFor(() => expect(order).toEqual(["tournament", "registrations"]));
    release();
    expect(await screen.findByRole("heading", { name: "Friday Freezeout" })).toBeInTheDocument();
  });

  it("says the tournament could not be loaded, rather than that it does not exist, and tries again", async () => {
    let fail = true;
    server.use(
      http.get("/api/tournaments/t1", () => (fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json(tournamentDto()))),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(field)),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([])),
    );
    const { user } = renderDesk();

    expect(await screen.findByRole("alert")).toHaveTextContent("The tournament could not be loaded");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Friday Freezeout" })).toBeInTheDocument();
  });

  it("shows no pool until the players are in, and says when they could not be loaded", async () => {
    mockDesk();
    server.use(http.get("/api/tournaments/t1/registrations", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
    renderDesk();

    expect(await screen.findByRole("alert")).toHaveTextContent("The players could not be loaded");
    expect(screen.queryByTestId("prize-pool")).not.toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: the tournament's image", () => {
  it("leaves no empty box behind when the stored image cannot be loaded (IMG-P3-04)", async () => {
    mockDesk({ imageUrl: "/uploads/tournament_banner/2d3e4f50-6a7b-4c8d-9e0f-b1c2d3e4f5a6/800.webp" });
    renderDesk();

    const card = (await screen.findByRole("heading", { name: "Tournament Info" })).closest(".rounded-lg") as HTMLElement;
    const image = card.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image as HTMLImageElement);

    await waitFor(() => expect(card.querySelector("img")).toBeNull());
    expect(card.querySelector(".aspect-video")).toBeNull();
  });
});

describe("TournamentDetailsPage: on a phone", () => {
  it("types the max players into a 16 px box, so iOS does not zoom the page (MA-07), behind a 44 px Edit (MA-08, round5-contracts §8.1)", async () => {
    phoneLayout();
    mockDesk();
    const { user } = renderDesk("/admin/tournaments/t1?tab=money");

    const edit = await screen.findByTestId("edit-max-players");
    expect(edit).toHaveClass("h-11", "md:h-10");
    await user.click(edit);

    const box = screen.getByTestId("max-players-input").className.split(/\s+/);
    expect(box).toContain("text-base");
    expect(box).toContain("h-11");
    expect(box).not.toContain("text-sm");
  });
});

describe("TournamentDetailsPage: status", () => {
  it("names a cancelled tournament Cancelled, never Scheduled", async () => {
    mockDesk({ status: "cancelled" });
    renderDesk();

    await screen.findByTestId("prize-pool");
    expect(screen.getAllByText("Cancelled", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Scheduled", { exact: true })).not.toBeInTheDocument();
  });

  it("starts a tournament once enough players are in", async () => {
    mockDesk({ status: "registration", minPlayers: 3 });
    const sent = mockPut("/api/tournaments/t1");
    const { user } = renderDesk();

    await user.click(await screen.findByTestId("start-tournament"));
    await waitFor(() => expect(sent).toEqual([{ status: "in_progress" }]));
    expect(await screen.findByText("Tournament status updated successfully")).toBeInTheDocument();
  });

  it("does not offer Start until the minimum number of players is in", async () => {
    mockDesk({ status: "registration", minPlayers: 8 });
    renderDesk();

    await screen.findByTestId("prize-pool");
    expect(screen.queryByTestId("start-tournament")).not.toBeInTheDocument();
  });

  it("offers Start only once the players are in, even for a tournament with no minimum (P3REV3-CQ-05)", async () => {
    mockDesk({ status: "registration", minPlayers: 0 });
    let answer: () => void = () => {};
    server.use(
      http.get("/api/tournaments/t1/registrations", async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return HttpResponse.json(field);
      }),
    );
    renderDesk();

    expect(await screen.findByTestId("register-player")).toBeInTheDocument();
    expect(screen.queryByTestId("start-tournament")).not.toBeInTheDocument();
    answer();
    expect(await screen.findByTestId("start-tournament")).toBeInTheDocument();
  });

  it("shows the server's sentence when a status change is refused", async () => {
    mockDesk();
    mockPut("/api/tournaments/t1", () => apiError(400, "INVALID_STATUS_TRANSITION", "Reopen a cancelled tournament before starting it"));
    const { user } = renderDesk();

    await user.click(await screen.findByTestId("pause-tournament"));

    expect(await screen.findByText("Reopen a cancelled tournament before starting it")).toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: after finalize", () => {
  const finished = [
    registrationDto("r2", "Bob", 1, { finalPosition: 1, prizeAmount: "142.50", pointsAwarded: 100 }),
    registrationDto("r1", "Ann", 1, { finalPosition: 2, prizeAmount: "47.50", pointsAwarded: 70 }),
    registrationDto("r3", "Cat", 1, { finalPosition: 3, isEliminated: true, pointsAwarded: 50 }),
  ];

  it("shows each player's place, not Active, under Final Standings", async () => {
    mockDesk({ status: "completed" }, finished);
    const { user } = renderDesk();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    expect(screen.getByText("Final Standings")).toBeInTheDocument();
    expect(screen.queryByText("Current Standings")).not.toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.getByTestId("player-row-r2")).toHaveTextContent("1st");
    expect(screen.getByTestId("player-row-r1")).toHaveTextContent("2nd");
    expect(screen.getByTestId("player-row-r3")).toHaveTextContent("3rd");
    expect(screen.getByTestId("player-row-r2")).toHaveTextContent("$142.50");
  });

  it("shows the places on a second staff device once another device finalizes (P3REV0-PARITY-01)", async () => {
    let finalized = false;
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto(finalized ? { status: "completed", finalizedAt: "2026-10-23T10:00:00.000Z" } : { status: "in_progress" }))),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(finalized ? finished : field)),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([])),
    );
    const { user, queryClient } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    expect(await screen.findByText("Current Standings")).toBeInTheDocument();

    finalized = true;
    await act(() => queryClient.refetchQueries({ queryKey: qk.tournaments.detail("t1"), exact: true }));

    expect(await screen.findByText("Final Standings")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("player-row-r2")).toHaveTextContent("1st"));
    expect(screen.getByTestId("player-row-r2")).toHaveTextContent("$142.50");
  });
});

describe("TournamentDetailsPage: Delete", () => {
  it("deletes the tournament once the owner confirms, and returns to the list", async () => {
    mockDesk();
    let deleted = false;
    server.use(
      http.delete("/api/tournaments/t1", () => {
        deleted = true;
        return HttpResponse.json({ success: true, message: "Tournament deleted" });
      }),
      http.get("/api/tournaments", () => HttpResponse.json([])),
    );
    const { user, location, queryClient } = renderDesk();
    // A leaderboard the deleted tournament's points counted towards, cached by another screen.
    queryClient.setQueryData(qk.seasons.leaderboard("s1"), []);

    await user.click(await screen.findByTestId("delete-tournament"));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Tournament" });
    expect(deleted).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Delete tournament" }));

    await waitFor(() => expect(location()).toBe("/tournaments"));
    expect(deleted).toBe(true);
    expect(await screen.findByText("Tournament deleted successfully")).toBeInTheDocument();
    // The delete hook drops everything cached under the deleted tournament once the page is left (P3REV2-CQ-12).
    expect(queryClient.getQueryCache().findAll({ queryKey: qk.tournaments.detail("t1") })).toEqual([]);
    // Its results went with it, so the leaderboard is asked for afresh (P3REV-PARITY-DEL-01).
    expect(queryClient.getQueryState(qk.seasons.leaderboard("s1"))?.isInvalidated).toBe(true);
  });

  it("offers Delete on a phone too, in the More tab (round5-contracts §8.1)", async () => {
    phoneLayout();
    mockDesk();
    const { user } = renderDesk();

    await user.click(await screen.findByRole("tab", { name: "More" }));
    const remove = await screen.findByRole("button", { name: "Delete tournament" });
    // In its own colour, readable (the menu's gold or amethyst highlight was not: MA-09).
    expect(remove).toHaveClass("text-destructive");
    await user.click(remove);

    expect(await screen.findByRole("alertdialog", { name: "Delete Tournament" })).toBeInTheDocument();
  });

  it("keeps the dialog open with the server's sentence when the delete is refused", async () => {
    mockDesk();
    server.use(http.delete("/api/tournaments/t1", () => apiError(403, "FORBIDDEN", "Only the club's owner or an admin can do that")));
    const { user, location } = renderDesk();

    await user.click(await screen.findByTestId("delete-tournament"));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Tournament" });
    await user.click(within(dialog).getByRole("button", { name: "Delete tournament" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Only the club's owner or an admin can do that");
    expect(location()).toBe("/admin/tournaments/t1");
  });
});

describe("TournamentDetailsPage: standings", () => {
  async function eliminate(user: ReturnType<typeof userEvent.setup>, registrationId: string) {
    await user.click(await screen.findByTestId(`eliminate-player-${registrationId}`));
    return screen.findByRole("dialog", { name: "Eliminate Player" });
  }

  it("puts each player's Eliminate on their own card on a phone, not off the side of a wide table (MA-02)", async () => {
    phoneLayout();
    mockDesk();
    renderDesk();
    // The phone opens on its Players tab: the standings.
    expect(await screen.findByRole("tab", { name: "Players" })).toHaveAttribute("aria-selected", "true");

    const standings = await screen.findByRole("list", { name: "Standings" });
    const card = within(standings).getByTestId("player-row-r1");
    expect(card).toHaveTextContent("Ann");
    expect(within(card).getByTestId("eliminate-player-r1")).toBeInTheDocument();
    expect(within(standings).getAllByTestId("eliminate-player-r1")).toHaveLength(1);
    expect(screen.queryByRole("table", { name: "Standings" })).not.toBeInTheDocument();
  });

  it("eliminates a player, crediting the knockout to another player still in", async () => {
    mockDesk();
    const sent = mockPut("/api/registrations/:id", () => HttpResponse.json(field[2]));
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    const dialog = await eliminate(user, "r3");
    await user.click(within(dialog).getByRole("combobox", { name: "Knocked out by (optional)" }));
    expect(screen.queryByRole("option", { name: "Cat" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    await user.click(within(dialog).getByRole("button", { name: "Eliminate Player" }));

    await waitFor(() => expect(sent).toEqual([{ isEliminated: true, eliminatedBy: "p-r2" }]));
    expect(await screen.findByText("Player eliminated successfully")).toBeInTheDocument();
  });

  it("never sends a knockout chosen for a player whose elimination was dismissed (CA-08)", async () => {
    mockDesk();
    const sent = mockPut("/api/registrations/:id", () => HttpResponse.json(field[2]));
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    const first = await eliminate(user, "r1");
    await user.click(within(first).getByRole("combobox", { name: "Knocked out by (optional)" }));
    await user.click(await screen.findByRole("option", { name: "Cat" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Eliminate Player" })).not.toBeInTheDocument());

    const second = await eliminate(user, "r3");
    expect(within(second).getByRole("combobox", { name: "Knocked out by (optional)" })).toHaveTextContent("Select player (optional)");
    await user.click(within(second).getByRole("button", { name: "Eliminate Player" }));

    await waitFor(() => expect(sent).toEqual([{ isEliminated: true, eliminatedBy: null }]));
  });

  it("restores a player who was knocked out by mistake", async () => {
    mockDesk({}, [field[0], field[1], registrationDto("r3", "Cat", 1, { isEliminated: true, eliminationTime: "2026-10-23T09:00:00.000Z" })]);
    const sent = mockPut("/api/registrations/:id", () => HttpResponse.json(field[2]));
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    await user.click(await screen.findByTestId("restore-player-r3"));

    await waitFor(() => expect(sent).toEqual([{ isEliminated: false }]));
    expect(await screen.findByText("Player restored successfully")).toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: the waiting list on a laptop (round 5, item 15)", () => {
  /** A field of three, full (nobody has paid yet), and Dee behind it. */
  const signUps: PublicRegistration[] = [
    ...field.map((registration) => ({ ...registration, waitingListPosition: null })),
    registrationDto("r4", "Dee", 1, { waitingListPosition: 1 }),
  ];

  it("counts the field against Max players, the waiting list apart, and leaves its players out of the pool, the standings and the eliminator list", async () => {
    mockDesk({ maxPlayers: 3 }, signUps);
    const { user } = renderDesk();

    expect(await screen.findByTestId("players-count")).toHaveTextContent("3/3");
    expect(screen.getByTestId("waiting-list-count")).toHaveTextContent("+1 on the waiting list");
    // Five buy-ins at $100 less $5 AP each: Dee's buy-in is not in it (shared/domain poolEntries).
    expect(screen.getByTestId("prize-pool")).toHaveTextContent("$475");

    await user.click(screen.getByRole("tab", { name: "Standings" }));
    const standings = await screen.findByRole("table", { name: "Standings" });
    expect(within(standings).queryByText("Dee")).not.toBeInTheDocument();
    const list = within(screen.getByTestId("waiting-list"));
    expect(list.getByTestId("waiting-r4")).toHaveTextContent("#1");
    expect(list.getByTestId("waiting-r4")).toHaveTextContent("Dee");
    // Nobody has paid: there is still room to accept, so no "full" line.
    expect(list.queryByTestId("waiting-list-full")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("eliminate-player-r3"));
    const dialog = await screen.findByRole("dialog", { name: "Eliminate Player" });
    await user.click(within(dialog).getByRole("combobox", { name: "Knocked out by (optional)" }));
    expect(await screen.findByRole("option", { name: "Bob" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Dee" })).not.toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: the server's answer shows at once (P3REV-PERF-STANDINGS-STALE-AFTER-ACTION)", () => {
  /** The players as first loaded; every later refresh stalls, as on slow venue Wi-Fi. */
  function mockStalledRefresh(registrations: PublicRegistration[]) {
    let asked = 0;
    mockDesk({ status: "in_progress" }, registrations);
    server.use(
      http.get("/api/tournaments/t1/registrations", async () => {
        asked += 1;
        if (asked > 1) await delay("infinite");
        return HttpResponse.json(registrations);
      }),
    );
  }

  it("turns an eliminated player's Eliminate into Restore before the refresh arrives", async () => {
    mockStalledRefresh(field);
    server.use(http.put("/api/registrations/r3", () => HttpResponse.json({ ...field[2], isEliminated: true, eliminationTime: "2026-10-23T09:00:00.000Z" })));
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    await user.click(await screen.findByRole("button", { name: "Eliminate Cat" }));
    const dialog = await screen.findByRole("dialog", { name: "Eliminate Player" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminate Player" }));

    const restore = await screen.findByRole("button", { name: "Restore Cat" });
    expect(screen.queryByRole("button", { name: "Eliminate Cat" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("player-row-r3")).getByText("Eliminated")).toBeInTheDocument();
    // Focus stays with the player, whichever lands first: the dialog closing or the row changing.
    await waitFor(() => expect(restore).toHaveFocus());
  });

  it("offers Eliminate again to a restored player before the refresh arrives", async () => {
    const out = registrationDto("r3", "Cat", 1, { isEliminated: true, eliminationTime: "2026-10-23T09:00:00.000Z" });
    mockStalledRefresh([field[0], field[1], out]);
    server.use(http.put("/api/registrations/r3", () => HttpResponse.json({ ...out, isEliminated: false, eliminationTime: null })));
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    await user.click(await screen.findByRole("button", { name: "Restore Cat" }));

    const eliminateCat = await screen.findByRole("button", { name: "Eliminate Cat" });
    expect(screen.queryByRole("button", { name: "Restore Cat" })).not.toBeInTheDocument();
    await waitFor(() => expect(eliminateCat).toHaveFocus());
  });

  it("takes a removed entry off the standings before the refresh arrives", async () => {
    mockStalledRefresh(field);
    server.use(http.delete("/api/registrations/r3", () => new HttpResponse(null, { status: 204 })));
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    await user.click(await screen.findByRole("button", { name: "Remove Cat's entry" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove entry" }));

    await waitFor(() => expect(screen.queryByTestId("player-row-r3")).not.toBeInTheDocument());
    expect(screen.getByTestId("player-row-r1")).toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: the pool", () => {
  it("names the season money left over is carried over to, as the server does (round 5, item 16)", async () => {
    // $500 in, $25 AP: $475 available; the prizes are fixed at $400 and the $75 left is carried over.
    const carried = { manualPrizePool: "400.00", prizeDifference: "carry" } satisfies Partial<TournamentDetailDto>;
    mockDesk(carried);
    server.use(http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(tournamentDto(carried), field, { carryTarget: "Winter League" }))));
    renderDesk();

    await waitFor(() => expect(screen.getByTestId("difference-carried-over")).toHaveTextContent("Carried over to Winter League−$75"));
  });

  it("sets the prize pool by hand, and back to the calculated pool when cleared", async () => {
    mockDesk();
    const sent = mockPut("/api/tournaments/t1");
    const { user } = renderDesk();

    await user.click(await screen.findByTestId("edit-prize-pool"));
    expect(screen.getByTestId("manual-pool-input")).toHaveAttribute("placeholder", "475.00");
    await user.type(screen.getByTestId("manual-pool-input"), "300");
    await user.click(screen.getByTestId("save-manual-pool"));
    await waitFor(() => expect(sent).toEqual([{ manualPrizePool: "300.00" }]));

    await user.click(await screen.findByTestId("edit-prize-pool"));
    await user.click(screen.getByTestId("save-manual-pool"));
    await waitFor(() => expect(sent).toEqual([{ manualPrizePool: "300.00" }, { manualPrizePool: null }]));
  });

  it("sets the pool through the AP dialog while an AP total is fixed, which says the pool replaces it (MONEY-AP-04)", async () => {
    mockDesk({ rakeOverride: "10.00", prizePoolAdjustmentReason: "Low turnout", prizePoolAdjustedAt: "2026-10-23T08:04:00.000Z" });
    const sent = recordBodies();
    server.use(
      http.put("/api/tournaments/t1/prize-pool/adjustment", async ({ request }) => {
        await sent.record(request);
        return HttpResponse.json({});
      }),
    );
    const { user } = renderDesk();

    await user.click(await screen.findByTestId("edit-prize-pool"));
    // No box that would silently replace the fixed AP total, or save a blank that changes nothing.
    expect(screen.queryByTestId("manual-pool-input")).not.toBeInTheDocument();
    const dialog = await screen.findByRole("dialog", { name: "Adjust AP" });
    expect(within(dialog).getByRole("radio", { name: "Set prize pool" })).toBeChecked();
    expect(within(dialog).getByText("A fixed pool, e.g. a guarantee: it replaces the fixed AP total ($10).")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("edit-prize-pool")).toHaveFocus();
    expect(sent.bodies).toEqual([]);
  });

  it("draws the manual pool box as every money box is, with its $ (P3REV5-CQ-11)", async () => {
    mockDesk();
    const { user } = renderDesk();

    await user.click(await screen.findByTestId("edit-prize-pool"));

    const box = screen.getByRole("textbox", { name: "Prize pool (blank for the calculated pool)" });
    expect(box).toHaveAttribute("inputmode", "decimal");
    expect(box.parentElement).toHaveTextContent("$");
  });

  it("refuses an amount that is not money before sending it", async () => {
    mockDesk();
    const sent = mockPut("/api/tournaments/t1");
    const { user } = renderDesk();

    await user.click(await screen.findByTestId("edit-prize-pool"));
    await user.type(screen.getByTestId("manual-pool-input"), "-5");
    await user.click(screen.getByTestId("save-manual-pool"));

    expect(await screen.findByText("Enter an amount of 0 or more, with at most 2 decimal places")).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("offers no pool edit once the pool is locked", async () => {
    mockDesk({ prizePoolLocked: true });
    renderDesk();

    await screen.findByTestId("prize-pool");
    expect(screen.queryByTestId("edit-prize-pool")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-max-players")).toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: the Actions tab", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("awards a high hand from its card, with the next prize worked out from the pot", async () => {
    const entrants = field.map((registration) => ({ ...registration, enteringHighHands: true }));
    mockDesk({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: 2 }, entrants);
    const { user } = renderDesk();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await user.click(screen.getByTestId("award-high-hand-card"));

    const dialog = await screen.findByRole("dialog", { name: "Assign High Hand Winner" });
    // Three $10 entries, two prizes: the first winner gets $15, once the pot as it is now is in.
    await waitFor(() => expect(within(dialog).getByTestId("high-hand-amount")).toHaveValue("15.00"));
    expect(within(dialog).getByTestId("assign-high-hand")).not.toHaveAttribute("aria-disabled", "true");
  });

  it("fetches the pot before showing the award as current, and says when it could not (P3REV-PERF-HIGHHAND-STALE-AMOUNT)", async () => {
    const entrants = field.map((registration) => ({ ...registration, enteringHighHands: true }));
    mockDesk({ enableHighHand: true, highHandAmount: "10.00", highHandPayouts: 2 }, entrants);
    let asked = 0;
    let answer: () => Response | Promise<Response> = () => HttpResponse.json(entrants);
    server.use(
      http.get("/api/tournaments/t1/registrations", () => {
        asked += 1;
        return answer();
      }),
    );
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await screen.findByTestId("award-high-hand-card");
    const before = asked;

    // The refresh the dialog asks for is held, then fails.
    const held: (() => void)[] = [];
    const release = () => held.forEach((fail) => fail());
    answer = () =>
      new Promise<Response>((resolve) => {
        held.push(() => resolve(apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")));
      });
    await user.click(screen.getByTestId("award-high-hand-card"));
    const dialog = await screen.findByRole("dialog", { name: "Assign High Hand Winner" });

    await waitFor(() => expect(asked).toBeGreaterThan(before));
    expect(within(dialog).getByTestId("high-hand-amount")).toHaveValue("");
    expect(within(dialog).getByText("Checking the pot as it is now…")).toBeInTheDocument();
    expect(within(dialog).getByTestId("assign-high-hand")).toHaveAttribute("aria-disabled", "true");

    release();
    expect(await within(dialog).findByText(/may be out of date/)).toBeInTheDocument();
    expect(within(dialog).getByTestId("high-hand-amount")).toHaveValue("15.00");

    answer = () => HttpResponse.json(entrants);
    await user.click(within(dialog).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(within(dialog).queryByText(/may be out of date/)).not.toBeInTheDocument());
    expect(within(dialog).getByTestId("assign-high-hand")).not.toHaveAttribute("aria-disabled", "true");
  });

  it("never says the player link was copied when the browser refused", async () => {
    mockDesk();
    const { user } = renderDesk();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) },
    });

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await user.click(screen.getByTestId("copy-player-link"));

    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument();
    expect(screen.queryByText("Link copied")).not.toBeInTheDocument();
  });

  it("says the player link was copied in the words every copied link uses (P3REV3-CQ-08)", async () => {
    mockDesk();
    const { user } = renderDesk();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    await user.click(screen.getByTestId("copy-player-link"));

    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(screen.getByText("Player actions link copied to the clipboard")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/tournaments/t1/actions`);
  });

  it("links to the request and payment desks", async () => {
    mockDesk();
    const { user } = renderDesk();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));

    expect(screen.getByRole("link", { name: "Confirm Actions" })).toHaveAttribute("href", "/admin/actions/t1");
    expect(screen.getByRole("link", { name: "Manage Registrations" })).toHaveAttribute("href", "/admin/registrations/t1");
    expect(screen.getByRole("link", { name: "Player Actions" })).toHaveAttribute("href", "/tournaments/t1/actions");
  });
});

describe("TournamentDetailsPage: for someone who does not run the club", () => {
  it("shows the tournament without any staff control", async () => {
    mockDesk({ viewer: { canManage: false, canOwn: false } });
    const { user } = renderDesk();

    await screen.findByTestId("prize-pool");
    for (const testId of ["register-player", "edit-tournament", "delete-tournament", "end-tournament", "pause-tournament", "edit-max-players"]) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    expect(screen.queryByTestId("prize-pool-lock-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("award-high-hand-card")).not.toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: the header on a laptop (lead's visual review, item 3)", () => {
  it("keeps the TD's own actions on one row at 1280 px: the other screens and the settings are in the More menu", async () => {
    screenWidth(1280);
    mockDesk({ status: "in_progress" });
    const { user } = renderDesk();

    const more = await screen.findByRole("button", { name: "More actions" });
    for (const testId of ["register-player", "pause-tournament", "end-tournament"]) expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Public View" })).not.toBeInTheDocument();
    // A laptop still gets the wide tables; only the header's extras move.
    await user.click(screen.getByRole("tab", { name: "Standings" }));
    expect(await screen.findByRole("table", { name: "Standings" })).toBeInTheDocument();

    await user.click(more);
    const menu = await screen.findByRole("menu");
    for (const name of ["Registrations", "Public View", "TV clock", "Edit", "Delete"]) expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
  });

  it("shows them as buttons on a screen wide enough for one row", async () => {
    screenWidth(2048);
    mockDesk({ status: "in_progress" });
    renderDesk();

    expect(await screen.findByRole("link", { name: "Public View" })).toHaveAttribute("href", "/tournament/t1");
    expect(screen.getByTestId("edit-tournament")).toHaveRole("button");
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: Edit", () => {
  it("opens the tournament's settings from the header", async () => {
    mockDesk();
    server.use(http.get("/api/seasons", () => HttpResponse.json([])));
    const { user } = renderDesk();

    await user.click(await screen.findByTestId("edit-tournament"));

    expect(await screen.findByRole("dialog", { name: "Edit Tournament" })).toBeInTheDocument();
    expect(screen.getByLabelText("Club")).toHaveValue("Central Stars");
  });
});

describe("TournamentDetailsPage: the same places as the players' phones (P3REV5-CQ-01)", () => {
  it("gives players still in no place and no leader's colour, and busted players the place they finished in", async () => {
    mockDesk({ status: "in_progress" }, [
      registrationDto("r1", "Ann", 1),
      registrationDto("r2", "Bob", 1),
      registrationDto("r3", "Cat", 1, { isEliminated: true, eliminationTime: "2026-10-23T09:00:00.000Z" }),
    ]);
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    const ann = await screen.findByTestId("player-row-r1");
    expect(ann).toHaveTextContent("Still in");
    expect(ann).not.toHaveTextContent(/^1/);
    expect(within(screen.getByTestId("player-row-r2")).getByText("Still in")).toBeInTheDocument();
    expect(within(screen.getByTestId("player-row-r3")).getByText("3")).toBeInTheDocument();
    // In the colours the players' phones use, the app's one podium style (P3REV3-CQ-09).
    expect(within(ann).getByTestId("place-badge")).toHaveClass("bg-status-live");
    expect(within(screen.getByTestId("player-row-r3")).getByTestId("place-badge")).toHaveClass(...PODIUM[3].split(" "));
  });

  it("names a sign-up whose player is missing as every staff screen does (P3REV6-CQ-04)", async () => {
    mockDesk({ status: "in_progress" }, [registrationDto("r1", "Ann", 1), registrationDto("r2", "", 1, { player: null })]);
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    expect(await screen.findByTestId("player-row-r2")).toHaveTextContent("Unknown player");
    expect(screen.getByRole("button", { name: "Eliminate Unknown player" })).toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: where focus goes (MA-P3REV1-02, -04, -07)", () => {
  it("names each player's Eliminate and Restore, and keeps focus on that player once they are out and their row has moved", async () => {
    let field = [registrationDto("r1", "Ann", 1), registrationDto("r2", "Bob", 1), registrationDto("r3", "Cat", 1)];
    mockDesk({ status: "in_progress" }, field);
    server.use(
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(field)),
      http.put("/api/registrations/r1", () => {
        field = [field[1], field[2], { ...field[0], isEliminated: true, eliminationTime: "2026-10-23T09:00:00.000Z" }];
        return HttpResponse.json(field[2]);
      }),
    );
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    await user.click(await screen.findByRole("button", { name: "Eliminate Ann" }));
    const dialog = await screen.findByRole("dialog", { name: "Eliminate Player" });
    await user.click(within(dialog).getByRole("button", { name: "Eliminate Player" }));

    const restore = await screen.findByRole("button", { name: "Restore Ann" });
    await waitFor(() => expect(restore).toHaveFocus());
  });

  it("gives focus back to the More menu after a dialog chosen from it closes, on a laptop", async () => {
    screenWidth(1280);
    mockDesk();
    const { user } = renderDesk();

    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await screen.findByRole("alertdialog", { name: "Delete Tournament" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus());
  });

  it("gives focus back to the button that opened a dialog", async () => {
    mockDesk();
    const { user } = renderDesk();

    const remove = await screen.findByTestId("delete-tournament");
    await user.click(remove);
    await screen.findByRole("alertdialog", { name: "Delete Tournament" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(remove).toHaveFocus());
  });

  it("puts focus back on Edit once the max players are saved", async () => {
    mockDesk();
    mockPut("/api/tournaments/t1");
    const { user } = renderDesk();

    await user.click(await screen.findByTestId("edit-max-players"));
    await user.clear(screen.getByTestId("max-players-input"));
    await user.type(screen.getByTestId("max-players-input"), "30{Enter}");

    await waitFor(() => expect(screen.queryByTestId("max-players-input")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Edit max players" })).toHaveFocus();
  });
});


describe("TournamentDetailsPage: a part priced at $0 (P3REV5-CQ-02)", () => {
  it("lists no re-buy, add-on or high hand the players are never offered", async () => {
    mockDesk({ rebuyAmount: "0.00", addonAmount: "0.00", enableHighHand: true, highHandAmount: "0.00" });
    renderDesk();

    expect(await screen.findByText("Max Players")).toBeInTheDocument();
    expect(screen.queryByText("Re-buy")).not.toBeInTheDocument();
    expect(screen.queryByText("Add-on")).not.toBeInTheDocument();
    expect(screen.queryByText("High Hand Entry Fee")).not.toBeInTheDocument();
  });

  it("offers no Award High Hand on the Actions tab for a high hand with no price (P3REV3-CQ-03)", async () => {
    mockDesk({ enableHighHand: true, highHandAmount: null });
    const { user } = renderDesk();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    expect(await screen.findByText("Confirm Actions")).toBeInTheDocument();
    expect(screen.queryByTestId("award-high-hand-card")).not.toBeInTheDocument();
  });
});

describe("TournamentDetailsPage: tables, the clock and the AP (Phase 4)", () => {
  it("puts the tables and the clock between the overview and the standings, and the AP beside the pool", async () => {
    mockDesk({ status: "in_progress" });
    renderDesk();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Tables & Seating", "Clock", "Standings", "Activity", "Actions"]);
    expect(await screen.findByTestId("ap-panel")).toBeInTheDocument();
    expect(await within(screen.getByTestId("ap-panel")).findByRole("heading", { name: "AP", level: 2 })).toBeInTheDocument();
  });

  it("shows the clock in the header once it is set up, and opens the Clock tab from it", async () => {
    mockDesk({ status: "in_progress" });
    serveDisplay({ clock: pausedClock({ levelIndex: 1, remainingMs: 9 * 60_000 }) });
    const { user } = renderDesk();

    const chip = await screen.findByTestId("clock-status-chip");
    expect(chip).toHaveTextContent("L2 · 9:00 · 300/600");
    await user.click(chip);

    expect(screen.getByRole("tab", { name: "Clock" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("link", { name: "Open TV display" })).toHaveAttribute("href", "/clock/t1?screen=tv");
    const resume = await screen.findByRole("button", { name: "Resume" });
    // A mouse's click moves no focus: Space or Enter would then pause the room's clock unseen (TDN2-CHIP-FOCUS-SPACE).
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(resume).not.toHaveFocus();
    // From the keyboard (or a finger on a phone) the chip puts focus on Start / Pause (P4REV0-PHONE-PAUSE-FOLD).
    chip.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(resume).toHaveFocus());
  });

  it("keeps the open tab in the address, so a reload or a phone bringing the page back reopens it (P4REV0-TAB-RESET)", async () => {
    mockDesk({ status: "in_progress" });
    const first = renderDesk();
    await first.user.click(await screen.findByRole("tab", { name: "Clock" }));
    expect(first.location()).toBe("/admin/tournaments/t1?tab=clock");
    await first.user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(first.location()).toBe("/admin/tournaments/t1");
    first.unmount();

    renderDesk("/admin/tournaments/t1?tab=seating");
    expect(await screen.findByRole("tab", { name: "Tables & Seating" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the Overview for a tab the address names that the page does not have", async () => {
    mockDesk({ status: "in_progress" });
    renderDesk("/admin/tournaments/t1?tab=nonsense");
    expect(await screen.findByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("says on the Tables & Seating tab, from the standings, that a bust left the tables uneven (P4REV0-BUST-FROM-SEAT)", async () => {
    mockDesk({ status: "in_progress" });
    const balance = [
      { registrationId: "r1", playerName: "Ann", from: { tableId: "tb1", tableNumber: 1, tableName: "Table 1", seatNumber: 4 }, to: { tableId: "tb2", tableNumber: 2, tableName: "Table 2", seatNumber: 1 }, reason: "balance" as const },
    ];
    // The advice as round 5's table advisor gives it, beside Phase 4's suggestion (round5-contracts §8.2).
    mockSeating(
      seatingDto({
        tables: [{ id: "tb1", number: 1, seats: 9, seated: { 4: { id: "r1", name: "Ann" }, 5: { id: "r2", name: "Bob" } } }, { id: "tb2", number: 2, seats: 9 }],
        suggestions: { balance },
        advisor: { advice: [balanceAdvice(balance)] },
      }),
    );
    const { user } = renderDesk();
    expect(screen.queryByTestId("seating-tab-alert")).not.toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    // The Standings' Seat column reads the seating: the tab's name says what it found.
    expect(await screen.findByTestId("seating-tab-alert", {}, { timeout: 3000 })).toHaveTextContent("Uneven");
    expect(screen.getByRole("tab", { name: /^Tables & Seating\s*, Uneven$/ })).toBeInTheDocument();
  });

  it("follows the seating on the tab's badge from the other tabs: a bust or a move on another phone shows (TDN3-BADGE-STALE-OTHER-DEVICE)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockDesk({ status: "in_progress" });
      const tables = [
        { id: "tb1", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Ann" }, 2: { id: "r2", name: "Bob" } } },
        { id: "tb2", number: 2, seats: 9, seated: { 1: { id: "r3", name: "Cat" } } },
      ];
      const balance = [
        { registrationId: "r2", playerName: "Bob", from: seatRef("tb1", 1, 2), to: seatRef("tb2", 2, 2), reason: "balance" as const },
      ];
      mockSeating(seatingDto({ tables }));
      renderDesk();
      await screen.findByTestId("prize-pool");
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(screen.queryByTestId("seating-tab-alert")).not.toBeInTheDocument();

      // The floor busts Cat on another phone: the page's registrations show it, and the badge asks the seating again.
      server.use(http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([field[0], field[1], { ...field[2], isEliminated: true }])));
      mockSeating(seatingDto({ tables: [tables[0], { ...tables[1], seated: {} }], suggestions: { balance }, advisor: { advice: [balanceAdvice(balance)] } }));
      await act(() => vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 100));
      await waitFor(() => expect(screen.getByTestId("seating-tab-alert")).toHaveTextContent("Uneven"));

      // Another phone balances the tables: no one came or went, and the badge's own poll clears it.
      mockSeating(seatingDto({ tables: [{ ...tables[0], seated: { 1: { id: "r1", name: "Ann" } } }, { ...tables[1], seated: { 2: { id: "r2", name: "Bob" } } }] }));
      await act(() => vi.advanceTimersByTimeAsync(SEATING_BADGE_REFRESH_MS + 100));
      await waitFor(() => expect(screen.queryByTestId("seating-tab-alert")).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no clock in the header before one is set up", async () => {
    mockDesk({ status: "in_progress" });
    renderDesk();

    await screen.findByTestId("prize-pool");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Clock" })).toBeInTheDocument());
    expect(screen.queryByTestId("clock-status-chip")).not.toBeInTheDocument();
  });

  it("calls the header's Pause what it does: Reopen registration", async () => {
    mockDesk({ status: "in_progress" });
    renderDesk();

    expect(await screen.findByTestId("pause-tournament")).toHaveAccessibleName("Reopen registration");
  });

  it("lists each player's seat in the standings once seats are drawn", async () => {
    mockDesk({ status: "in_progress" });
    mockSeating(seatingDto({ tables: [{ id: "tb1", number: 2, seats: 9, seated: { 4: { id: "r1", name: "Ann" } } }], unseated: [{ id: "r2", name: "Bob" }] }));
    const { user } = renderDesk();

    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    const table = await screen.findByRole("table", { name: "Standings" });
    expect(await within(table).findByRole("columnheader", { name: "Seat" })).toBeInTheDocument();
    expect(within(screen.getByTestId("player-row-r1")).getByTestId("standings-seat")).toHaveTextContent("Table 2, seat 4");
    // Still in with no seat while the tables are in play: waiting, not the dash of a player who is out.
    expect(within(screen.getByTestId("player-row-r2")).getByTestId("standings-seat")).toHaveTextContent("Waiting for a seat");
    expect(within(screen.getByTestId("player-row-r3")).getByTestId("standings-seat")).toHaveTextContent("No seat");
  });

  it("says a restored player whose seat was taken is waiting, on the tab and in a toast that seats them (TDN2-WAITING-NOT-FLAGGED)", async () => {
    const out = registrationDto("r3", "Cat", 1, { isEliminated: true, eliminationTime: "2026-10-23T09:00:00.000Z" });
    mockDesk({ status: "in_progress" }, [field[0], field[1], out]);
    const tables = [{ id: "tb1", number: 1, seats: 9, seated: { 4: { id: "r1", name: "Ann" }, 5: { id: "r2", name: "Bob" } } }];
    let restored = false;
    server.use(
      http.put("/api/registrations/r3", () => {
        restored = true;
        return HttpResponse.json({ ...out, isEliminated: false, eliminationTime: null });
      }),
      http.get("/api/tournaments/t1/seating", () => HttpResponse.json(seatingDto({ tables, unseated: restored ? [{ id: "r3", name: "Cat" }] : [] }))),
    );
    const seated = seatingDto({ tables: [{ ...tables[0], seated: { ...tables[0].seated, 6: { id: "r3", name: "Cat" } } }] });
    const draws = recordWrite("post", "/api/tournaments/t1/seating/draw", () => HttpResponse.json(seatingMutation(seated, [seatMove("r3", "Cat", null, seatRef("tb1", 1, 6), "draw")])));
    const { user } = renderDesk();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));

    await user.click(await screen.findByRole("button", { name: "Restore Cat" }));
    const toast = within(screen.getByTestId("notifications"));
    expect(await toast.findByText("Cat is back in, waiting for a seat: their old one was not free.")).toBeInTheDocument();
    expect(screen.getByTestId("seating-tab-alert")).toHaveTextContent("1 waiting");

    await user.click(toast.getByRole("button", { name: "Seat now" }));
    await waitFor(() => expect(draws).toEqual([{ scope: "unseated", registrationIds: ["r3"], includeUnconfirmed: true }]));
    expect(await toast.findByText("Cat: Table 1, Seat 6.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("seating-tab-alert")).not.toBeInTheDocument());
  });

  it("offers the TV clock, the seat finder's link and the season's leaderboard on the Actions tab", async () => {
    mockDesk({ status: "in_progress", seasonId: "s1" });
    server.use(http.get("/api/seasons/s1", () => HttpResponse.json(seasonDto())));
    const { user } = renderDesk();

    await user.click(await screen.findByRole("tab", { name: "Actions" }));

    expect(screen.getByTestId("tv-clock-card")).toHaveAttribute("href", "/clock/t1?screen=tv");
    expect(screen.getByTestId("tv-clock-card")).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("season-leaderboard-card")).toHaveAttribute("href", "/season/s1");
    expect(screen.getByTestId("copy-seat-finder-link")).toHaveTextContent("Copy Seat Finder Link");
  });
});
