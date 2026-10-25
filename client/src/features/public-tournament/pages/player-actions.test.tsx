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

const ANN_PHOTO = "/uploads/player_avatar/2d3e4f50-6a7b-4c8d-9e0f-b1c2d3e4f5a6/256.webp";
const players = [
  registrationDto("r1", "Ann Ngata", { player: { id: "p-r1", name: "Ann Ngata", imageUrl: ANN_PHOTO } }),
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

/** Taps `player` in the list that answers `question`. */
async function pick(user: ReturnType<typeof userEvent.setup>, question: string, player: string | RegExp) {
  const list = await screen.findByRole("list", { name: question });
  await user.click(within(list).getByRole("button", { name: player }));
}

const RE_BUY_FOR = "Who is the re-buy for?";
const ADD_ON_FOR = "Who is the add-on for?";
const KNOCKOUT_BY = "Who made the knockout?";
const KNOCKED_OUT = "Who was knocked out?";

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
    await pick(user, RE_BUY_FOR, /^Ann Ngata/);
    // The one chosen stands alone, photo large, with Change to pick again.
    const chosen = screen.getByTestId("chosen-player");
    expect(chosen).toHaveTextContent("Ann Ngata0 re-buys");
    expect(chosen.querySelector("img")).toHaveAttribute("src", ANN_PHOTO);
    expect(chosen.querySelector("img")).toHaveAttribute("width", "64");
    expect(screen.queryByRole("list", { name: RE_BUY_FOR })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit Re-buy" }));

    expect(await screen.findByText("Action Submitted!")).toBeInTheDocument();
    expect(screen.getByText("Re-buy for Ann Ngata")).toBeInTheDocument();
    expect(screen.getByText("Re-buy for Ann Ngata").closest("div")?.parentElement?.querySelector("img")).toHaveAttribute("src", ANN_PHOTO);
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
    const list = within(await screen.findByRole("list", { name: RE_BUY_FOR }));

    expect(list.getByRole("button", { name: "Ann Ngata 0 of 1 re-buys" })).toBeEnabled();
    expect(list.getByRole("button", { name: "Ben Hale 1 of 1 re-buys: limit reached" })).toBeDisabled();
    expect(list.getByRole("button", { name: "Cal Iti Out: buy back in" })).toBeEnabled();
  });

  it("closes the players the house rules allow no more: the add-on limit, and one re-buy OR one add-on (TDN4-HOUSE-RULES-UNSET)", async () => {
    const field = [registrationDto("r1", "Ann Ngata"), registrationDto("r2", "Ben Hale", { rebuys: 1 }), registrationDto("r4", "Dee Rua", { addons: 1 })];
    mockTournamentPages(running({ maxRebuys: 1, maxAddons: 1, rebuyOrAddon: true }), field);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Add-on/ }));
    const list = within(await screen.findByRole("list", { name: ADD_ON_FOR }));
    expect(list.getByRole("button", { name: "Ann Ngata 0 of 1 add-ons" })).toBeEnabled();
    expect(list.getByRole("button", { name: "Ben Hale Took a re-buy: not both" })).toBeDisabled();
    expect(list.getByRole("button", { name: "Dee Rua 1 of 1 add-ons: limit reached" })).toBeDisabled();
  });

  it("leaves the waiting list out: a sign-up behind a full field is not playing, so asks for nothing and is never knocked out (round 5, item 15)", async () => {
    const full = [...players, registrationDto("r4", "Dee Rua", { waitingListPosition: 1 })];
    mockTournamentPages(running({ maxPlayers: 3 }), full);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Re-buy/ }));
    const requesters = within(await screen.findByRole("list", { name: RE_BUY_FOR }));
    expect(requesters.getAllByRole("button")).toHaveLength(3);
    expect(requesters.queryByRole("button", { name: /Dee Rua/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(await screen.findByRole("button", { name: /^Register Knockout/ }));
    expect(within(await screen.findByRole("list", { name: KNOCKOUT_BY })).queryByRole("button", { name: /Dee Rua/ })).not.toBeInTheDocument();
    await pick(user, KNOCKOUT_BY, "Ben Hale");
    expect(within(await screen.findByRole("list", { name: KNOCKED_OUT })).queryByRole("button", { name: /Dee Rua/ })).not.toBeInTheDocument();
  });

  it("records a knockout claim against another player still in", async () => {
    mockTournamentPages(running(), players);
    const sent = mockRequests();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Register Knockout/ }));
    // Who went out is asked once the claimer is chosen.
    expect(screen.queryByRole("list", { name: KNOCKED_OUT })).not.toBeInTheDocument();
    await pick(user, KNOCKOUT_BY, "Ann Ngata");
    expect(screen.getByRole("button", { name: "Submit Knockout" })).toBeDisabled();
    const targets = within(await screen.findByRole("list", { name: KNOCKED_OUT }));
    // Not the claimer, and not Cal, whom Ann is already recorded as knocking out.
    expect(targets.getAllByRole("button")).toHaveLength(1);
    await user.click(targets.getByRole("button", { name: "Ben Hale" }));
    await user.click(screen.getByRole("button", { name: "Submit Knockout" }));

    expect(await screen.findByText("Knockout submitted")).toBeInTheDocument();
    expect(sent).toEqual([{ playerId: "p-r1", actionType: "knockout", targetPlayerId: "p-r2" }]);
    // Both players, with their photos (or initials), so they can see the right knockout was sent.
    expect(screen.getByTestId("knockout-by")).toHaveTextContent("Ann Ngata");
    expect(screen.getByTestId("knockout-by").querySelector("img")).toHaveAttribute("src", ANN_PHOTO);
    expect(screen.getByTestId("knockout-target")).toHaveTextContent("BHBen Hale");
    expect(screen.getByText("The tournament director will confirm it at the desk.")).toBeInTheDocument();
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
    await pick(user, RE_BUY_FOR, /^Ann Ngata/);
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
    await pick(user, KNOCKOUT_BY, "Ann Ngata");
    await pick(user, KNOCKED_OUT, "Ben Hale");
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

    expect(await screen.findByRole("list", { name: ADD_ON_FOR })).toBeInTheDocument();
  });
});

describe("PlayerActionsPage: choosing a player by their photo (round 5, items 6 and 14)", () => {
  const field = (count: number) => Array.from({ length: count }, (_, index) => registrationDto(`f${index}`, index === 3 ? "Aroha Ngata" : `Player ${index}`));

  it("lists each player as a 56 px row with their 40 px photo, or their initials", async () => {
    mockTournamentPages(running(), players);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Re-buy/ }));
    const list = await screen.findByRole("list", { name: RE_BUY_FOR });

    const ann = within(list).getByRole("button", { name: /^Ann Ngata/ });
    expect(ann).toHaveClass("min-h-14", "w-full");
    expect(ann.querySelector("img")).toHaveAttribute("width", "40");
    expect(ann.querySelector("img")).toHaveAttribute("alt", "");
    expect(within(list).getByRole("button", { name: /^Ben Hale/ })).toHaveTextContent(/^BHBen Hale/);
  });

  it("moves focus to Change once a player is chosen, and back to the list from Change, keeping the choice marked", async () => {
    mockTournamentPages(running(), players);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^Re-buy/ }));

    await pick(user, RE_BUY_FOR, /^Ben Hale/);
    const change = screen.getByRole("button", { name: "Change" });
    await waitFor(() => expect(change).toHaveFocus());
    expect(change).toHaveAccessibleDescription(RE_BUY_FOR);

    await user.click(change);
    const list = screen.getByRole("list", { name: RE_BUY_FOR });
    await waitFor(() => expect(list).toHaveFocus());
    expect(within(list).getByRole("button", { name: /^Ben Hale/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(list).getByRole("button", { name: /^Ann Ngata/ }));
    expect(screen.getByTestId("chosen-player")).toHaveTextContent("Ann Ngata");
  });

  it("offers a box to find a name in a big field, by the start of any word", async () => {
    mockTournamentPages(running(), field(12));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^Re-buy/ }));
    const list = await screen.findByRole("list", { name: RE_BUY_FOR });
    expect(within(list).getAllByRole("button")).toHaveLength(12);

    await user.type(screen.getByRole("searchbox", { name: `Find a name: ${RE_BUY_FOR}` }), "nga");
    expect(within(screen.getByRole("list", { name: RE_BUY_FOR })).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "ANAroha Ngata 0 re-buys",
    ]);
    await user.clear(screen.getByRole("searchbox", { name: `Find a name: ${RE_BUY_FOR}` }));
    await user.type(screen.getByRole("searchbox", { name: `Find a name: ${RE_BUY_FOR}` }), "zz");
    expect(screen.getByRole("status")).toHaveTextContent("Nobody here is called “zz”.");
  });

  it("has no box to search in a small field", async () => {
    mockTournamentPages(running(), field(8));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^Re-buy/ }));

    expect(await screen.findByRole("list", { name: RE_BUY_FOR })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("drops the knocked-out player when the claimer is changed to them", async () => {
    mockTournamentPages(running(), players);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^Register Knockout/ }));
    await pick(user, KNOCKOUT_BY, "Ann Ngata");
    await pick(user, KNOCKED_OUT, "Ben Hale");

    await user.click(within(screen.getByTestId("requester-picker")).getByRole("button", { name: "Change" }));
    await pick(user, KNOCKOUT_BY, "Ben Hale");

    expect(within(screen.getByTestId("requester-picker")).getByTestId("chosen-player")).toHaveTextContent("Ben Hale");
    const targets = within(screen.getByRole("list", { name: KNOCKED_OUT }));
    expect(targets.queryByRole("button", { name: "Ben Hale" })).not.toBeInTheDocument();
    expect(targets.getByRole("button", { name: "Ann Ngata" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Submit Knockout" })).toBeDisabled();
  });
});
