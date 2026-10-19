import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { PublicRegisterPage } from "./public-register-page";

const tournament = {
  id: "t1",
  name: "Friday Freezeout",
  clubId: "c1",
  status: "registration",
  buyInAmount: "50.00",
  enableHighHand: false,
  highHandAmount: null,
  prizePoolLocked: false,
  maxPlayers: 40,
  viewer: { canManage: false },
};
const club = { id: "c1", name: "Central Stars", slug: "central-stars", imageUrl: null, viewer: { canManage: false } };
const players = [
  { id: "p1", name: "Alice Smith", imageUrl: null },
  { id: "p2", name: "Alan Jones", imageUrl: null },
  { id: "p3", name: "Bob Brown", imageUrl: null },
];

function mockTournament(overrides: Partial<typeof tournament> = {}, signedUp = 0) {
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json({ ...tournament, ...overrides })),
    http.get("/api/clubs/c1", () => HttpResponse.json(club)),
    http.get("/api/tournaments/t1/registrations", () =>
      HttpResponse.json(Array.from({ length: signedUp }, (_, i) => ({ id: `r${i}`, player: { id: `p${i}`, name: `P${i}`, imageUrl: null } }))),
    ),
  );
}

/** Answers the club-scoped search and records every `q` it was asked for. */
function mockSearch(): string[] {
  const asked: string[] = [];
  server.use(
    http.get("/api/public/tournaments/t1/players", ({ request }) => {
      const q = new URL(request.url).searchParams.get("q") ?? "";
      asked.push(q);
      return HttpResponse.json(players.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())));
    }),
  );
  return asked;
}

function renderPage() {
  return renderWithApp(<PublicRegisterPage />, { path: "/register/t1", route: "/register/:tournamentId" });
}

async function chooseExistingPlayer(user: ReturnType<typeof userEvent.setup>, search: string, name: string) {
  await user.click(await screen.findByTestId("player-type-existing"));
  await user.click(screen.getByTestId("step1-next"));
  await user.type(screen.getByTestId("player-search"), search);
  await user.click(await screen.findByRole("button", { name })); // the result row
  await user.click(screen.getByTestId("step2-next"));
}

beforeEach(() => {
  mockSignedOut();
});

describe("PublicRegisterPage: existing player", () => {
  it("finds the player with the club-scoped search and registers them", async () => {
    mockTournament();
    const asked = mockSearch();
    let registered: unknown;
    server.use(
      http.post("/api/tournaments/t1/registrations", async ({ request }) => {
        registered = await request.json();
        return HttpResponse.json({ id: "r1", playerId: "p2", player: players[1] }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await chooseExistingPlayer(user, "Al", "Alan Jones");
    expect(screen.getByTestId("registering-as")).toHaveTextContent("Alan Jones");
    await user.click(screen.getByTestId("complete-registration"));

    expect(await screen.findByText("Registration Complete!")).toBeInTheDocument();
    expect(screen.getByTestId("amount-due")).toHaveTextContent("$50.00");
    expect(registered).toEqual({ playerId: "p2", enteringHighHands: false });
    // Debounced: one search for what was typed, never a request for the whole player list.
    expect(asked).toEqual(["Al"]);
  });

  it("waits for two letters before searching, and says when nobody matches", async () => {
    mockTournament();
    const asked = mockSearch();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("player-type-existing"));
    await user.click(screen.getByTestId("step1-next"));
    await user.type(screen.getByTestId("player-search"), "Z");
    expect(screen.getByText("Type at least 2 letters of your name.")).toBeInTheDocument();
    await user.type(screen.getByTestId("player-search"), "z");

    expect(await screen.findByTestId("player-search-empty")).toBeInTheDocument();
    expect(asked).toEqual(["Zz"]);
  });

  it.each([
    ["ALREADY_REGISTERED", "You're already registered for this tournament. See you at the table!"],
    ["TOURNAMENT_FULL", "Sorry, this tournament is full. Please speak to the tournament director, who can seat extra players."],
    ["HIGH_HAND_AWARDED", 'Every high-hand prize has already been won tonight. Choose "No thanks" and try again.'],
    ["TOURNAMENT_CLOSED", "Registration for this tournament has closed."],
    ["PRIZE_POOL_LOCKED", "Registration has closed: the prize pool is locked. Please speak to the tournament director."],
  ] as const)("explains a %s refusal in plain words", async (code, message) => {
    mockTournament();
    mockSearch();
    server.use(http.post("/api/tournaments/t1/registrations", () => apiError(409, code, "refused")));
    const user = userEvent.setup();
    renderPage();

    await chooseExistingPlayer(user, "Bob", "Bob Brown");
    await user.click(screen.getByTestId("complete-registration"));

    expect(await screen.findByTestId("registration-problem")).toHaveTextContent(message);
    expect(screen.queryByText("Registration Complete!")).not.toBeInTheDocument();
  });
});

describe("PublicRegisterPage: new player", () => {
  async function fillNewPlayer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByTestId("player-type-new"));
    await user.click(screen.getByTestId("step1-next"));
    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));
  }

  it("shows the server's sentence by the phone field when the number belongs to someone else", async () => {
    mockTournament();
    const sentence = 'That phone number is already registered to another player. Choose "Existing player" instead, or check the number.';
    server.use(http.post("/api/players", () => apiError(409, "PHONE_TAKEN", sentence)));
    const user = userEvent.setup();
    renderPage();

    await fillNewPlayer(user);

    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
  });

  it("carries on as the existing player when the name and phone match one", async () => {
    mockTournament();
    let created: unknown;
    server.use(
      http.post("/api/players", async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ id: "p1", name: "Alice Smith", imageUrl: null, existing: true, signUpToken: "token-for-p1" });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillNewPlayer(user);

    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("registering-as")).toHaveTextContent("Alice Smith");
    expect(await screen.findByText("Welcome back!")).toBeInTheDocument();
    // The tournament is named, so its club becomes a new player's home club (P2REV0-SEC-03).
    expect(created).toEqual({ name: "Alice Smith", phone: "021 555 0100", tournamentId: "t1" });
  });

  it("signs the new player up with the token POST /api/players gave, so a visitor from another club can register (P2REV0-02)", async () => {
    mockTournament();
    let registered: unknown;
    server.use(
      http.post("/api/players", () => HttpResponse.json({ id: "p9", name: "Alice Smith", imageUrl: null, signUpToken: "token-for-p9" }, { status: 201 })),
      http.post("/api/tournaments/t1/registrations", async ({ request }) => {
        registered = await request.json();
        return HttpResponse.json({ id: "r9", playerId: "p9" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillNewPlayer(user);
    await user.click(await screen.findByTestId("complete-registration"));

    expect(await screen.findByText("Registration Complete!")).toBeInTheDocument();
    expect(registered).toEqual({ playerId: "p9", enteringHighHands: false, signUpToken: "token-for-p9" });
  });
});

describe("PublicRegisterPage: closed tournaments", () => {
  it.each([
    [{ status: "completed" }, "Registration for this tournament has closed."],
    [{ status: "cancelled" }, "Registration for this tournament has closed."],
    [{ prizePoolLocked: true }, "Registration has closed: the prize pool is locked. Please speak to the tournament director."],
  ])("says registration is closed for %o instead of showing the form", async (overrides, message) => {
    mockTournament(overrides);
    renderPage();

    expect(await screen.findByTestId("registration-closed")).toHaveTextContent(message);
    expect(screen.queryByTestId("player-type-new")).not.toBeInTheDocument();
  });

  it("says a full tournament is full before anyone types their details or uploads a photo (TN-03)", async () => {
    mockTournament({ maxPlayers: 3 }, 3);
    renderPage();

    expect(await screen.findByTestId("registration-closed")).toHaveTextContent("Sorry, this tournament is full.");
    expect(screen.queryByTestId("player-type-new")).not.toBeInTheDocument();
  });

  it("keeps the form open while the game is in progress, and for the tournament's staff at a full table", async () => {
    mockTournament({ status: "in_progress", maxPlayers: 3, viewer: { canManage: true } }, 3);
    renderPage();

    expect(await screen.findByTestId("player-type-new")).toBeInTheDocument();
    expect(screen.queryByTestId("registration-closed")).not.toBeInTheDocument();
  });

  it("still loads when the tournament is missing", async () => {
    server.use(
      http.get("/api/tournaments/t1", () => apiError(404, "NOT_FOUND", "Tournament not found")),
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([])),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("Tournament not found")).toBeInTheDocument());
  });
});
