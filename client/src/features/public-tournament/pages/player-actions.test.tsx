import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { server } from "@test/msw/server";
import { mockTournamentPages, registrationDto, tournamentDto } from "@test/helpers/f2-public";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import PlayerActionsPage from "./player-actions";

const running = (overrides: Partial<TournamentDetailDto> = {}) =>
  tournamentDto({ status: "in_progress", rebuyAmount: "25.00", addonAmount: "20.00", ...overrides });

const players = [
  registrationDto("r1", "Ann Ngata"),
  registrationDto("r2", "Ben Hale", { rebuys: 1 }),
  registrationDto("r3", "Cal Iti", { isEliminated: true, eliminatedBy: "p-r1", eliminationTime: "2026-10-23T08:00:00.000Z" }),
];

function renderPage() {
  return renderWithApp(<PlayerActionsPage />, { path: "/tournaments/t1/actions", route: "/tournaments/:tournamentId/actions" });
}

/** Records each request body sent to the pending-actions endpoint. */
function mockRequests(answer: () => Response = () => HttpResponse.json({ id: "a1" }, { status: 201 })): unknown[] {
  const sent: unknown[] = [];
  server.use(
    http.post("/api/tournaments/t1/pending-actions", async ({ request }) => {
      sent.push(await request.json());
      return answer();
    }),
  );
  return sent;
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string | RegExp) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  mockSignedOut();
});

describe("PlayerActionsPage: where focus goes (MA-P3REV1-03)", () => {
  it("moves focus to the chosen action's form, and back to the menu's title on Back", async () => {
    mockTournamentPages(running(), players);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Re-buy \$25\.00/ }));
    const title = screen.getByTestId("player-actions-title");
    await waitFor(() => expect(title).toHaveFocus());
    expect(within(title).getByRole("heading", { name: "Re-buy" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByTestId("player-actions-title")).toHaveFocus());
    expect(screen.getByRole("button", { name: /^Re-buy \$25\.00/ })).toBeInTheDocument();
  });
});

describe("PlayerActionsPage: the menu", () => {
  it("offers what the tournament sells, at its prices, and names the club with a link by slug (PUB-12)", async () => {
    mockTournamentPages(running(), players);
    renderPage();

    expect(await screen.findByRole("button", { name: /^Re-buy \$25\.00/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Add-on \$20\.00/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Register Knockout/ })).toBeEnabled();
    expect(await screen.findByRole("link", { name: /Central Stars/ })).toHaveAttribute("href", "/club/central-stars");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  it("links the club by its slug on the request screen too, not by its id (PUB-12)", async () => {
    mockTournamentPages(running(), players);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Register Knockout/ }));

    expect(await screen.findByRole("link", { name: /Central Stars/ })).toHaveAttribute("href", "/club/central-stars");
  });

  it("leaves out what the tournament does not sell", async () => {
    mockTournamentPages(tournamentDto({ status: "in_progress" }), players);
    renderPage();

    expect(await screen.findByRole("button", { name: /^Register Knockout/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Re-buy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add-on/ })).not.toBeInTheDocument();
  });

  it("shows re-buys and add-ons closed once the pool is locked (PUB-14)", async () => {
    mockTournamentPages(running({ prizePoolLocked: true }), players);
    renderPage();

    expect(await screen.findByRole("button", { name: /^Re-buy/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Add-on/ })).toBeDisabled();
    expect(screen.getByTestId("requests-locked")).toHaveTextContent("Prize pool is locked.");
    expect(screen.getByRole("button", { name: /^Register Knockout/ })).toBeEnabled();
  });

  it.each([
    ["completed", "This tournament has finished, so it takes no more requests."],
    ["cancelled", "This tournament was cancelled, so it takes no more requests."],
  ] as const)("takes no requests once the tournament is %s (PUB-14)", async (status, message) => {
    mockTournamentPages(running({ status }), players);
    renderPage();

    expect(await screen.findByTestId("requests-closed")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: /^Register Knockout/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Tournament" })).toHaveAttribute("href", "/tournament/t1");
  });

  it("says the tournament is not found for a 404", async () => {
    server.use(http.get("/api/tournaments/t1", () => apiError(404, "NOT_FOUND", "Tournament not found")));
    renderPage();

    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
  });
});

describe("PlayerActionsPage: requests", () => {
  it("asks for a re-buy for the chosen player, checking who is in first, and says what to pay", async () => {
    const asked = mockTournamentPages(running(), players);
    const sent = mockRequests();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Re-buy/ }));
    await waitFor(() => expect(asked.registrations()).toBe(2));
    expect(screen.getByRole("button", { name: "Submit Re-buy" })).toBeDisabled();
    await choose(user, "Select Player", /^Ann Ngata/);
    await user.click(screen.getByRole("button", { name: "Submit Re-buy" }));

    expect(await screen.findByText("Action Submitted!")).toBeInTheDocument();
    expect(screen.getByText("Re-buy for Ann Ngata")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(sent).toEqual([{ playerId: "p-r1", actionType: "rebuy", targetPlayerId: null }]);

    await user.click(screen.getByRole("button", { name: "Back to Actions" }));
    expect(screen.getByText("Select an action")).toBeInTheDocument();
  });

  it("lists every player for a re-buy with their count against the limit, and closes the ones at it (PUB-14)", async () => {
    mockTournamentPages(running({ maxRebuys: 1 }), players);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Re-buy/ }));
    await user.click(await screen.findByRole("combobox", { name: "Select Player" }));

    expect(await screen.findByRole("option", { name: "Ann Ngata (0 of 1 re-buys)" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("option", { name: "Ben Hale (1 of 1 re-buys: limit reached)" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "Cal Iti (out: buy back in)" })).toBeInTheDocument();
  });

  it("records a knockout claim against another player still in", async () => {
    mockTournamentPages(running(), players);
    const sent = mockRequests();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Register Knockout/ }));
    await choose(user, "Player Who Made Knockout", "Ann Ngata");
    expect(screen.getByRole("button", { name: "Submit Knockout" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Player Who Was Knocked Out" }));
    const targets = within(await screen.findByRole("listbox"));
    // Not the claimer, and not Cal, whom Ann is already recorded as knocking out.
    expect(targets.getAllByRole("option")).toHaveLength(1);
    expect(targets.getByRole("option", { name: "Ben Hale" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Ben Hale" }));
    await user.click(screen.getByRole("button", { name: "Submit Knockout" }));

    expect(await screen.findByText("Knockout submitted")).toBeInTheDocument();
    expect(sent).toEqual([{ playerId: "p-r1", actionType: "knockout", targetPlayerId: "p-r2" }]);
  });

  it.each([
    ["DUPLICATE_PENDING_ACTION", 409, "That request is already waiting for the tournament director", "already waiting for the tournament director, who will confirm it at the desk."],
    ["PRIZE_POOL_LOCKED", 409, "Prize pool is locked. No rebuys or addons allowed.", "Re-buys and add-ons have closed: the prize pool is locked."],
    ["PLAYER_NOT_REGISTERED", 409, "That player is not registered for this tournament", "That player isn't registered for this tournament."],
    ["MAX_REBUYS_REACHED", 409, "This tournament allows at most 1 re-buy per player", "This tournament allows at most 1 re-buy per player"],
  ] as const)("explains a %s refusal and keeps the request on screen", async (code, status, sentence, shown) => {
    mockTournamentPages(running(), players);
    mockRequests(() => apiError(status, code, sentence));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Re-buy/ }));
    await choose(user, "Select Player", /^Ann Ngata/);
    await user.click(screen.getByRole("button", { name: "Submit Re-buy" }));

    expect(await screen.findByTestId("request-problem")).toHaveTextContent(shown);
    expect(screen.queryByText("Action Submitted!")).not.toBeInTheDocument();
  });

  it("names who already got a knocked-out player, as the server says", async () => {
    mockTournamentPages(running(), players);
    mockRequests(() => apiError(409, "ALREADY_ELIMINATED", "Ben Hale is already out, knocked out by Ann Ngata"));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Register Knockout/ }));
    await choose(user, "Player Who Made Knockout", "Ann Ngata");
    await choose(user, "Player Who Was Knocked Out", "Ben Hale");
    await user.click(screen.getByRole("button", { name: "Submit Knockout" }));

    expect(await screen.findByTestId("request-problem")).toHaveTextContent("Ben Hale is already out, knocked out by Ann Ngata");
  });

  it("says when the players could not be loaded, and tries again", async () => {
    mockTournamentPages(running(), players);
    let fail = true;
    const regs: PublicRegistration[] = players;
    server.use(http.get("/api/tournaments/t1/registrations", () => (fail ? apiError(503, "SERVICE_UNAVAILABLE", "Busy right now") : HttpResponse.json(regs))));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Add-on/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The players could not be loaded");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("combobox", { name: "Select Player" })).toBeInTheDocument();
  });
});
