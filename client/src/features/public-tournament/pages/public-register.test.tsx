import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { installFakeXhr } from "@test/helpers/fake-xhr";
import { clubDto, mockTournamentPages, registrationDto, tournamentDto } from "@test/helpers/f2-public";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import PublicRegisterPage from "./public-register";

const tournament = tournamentDto({ status: "registration", buyInAmount: "50.00", maxPlayers: 40 });
const club = clubDto();
const AVATAR = "/uploads/player_avatar/2d3e4f50-6a7b-4c8d-9e0f-b1c2d3e4f5a6/512.webp";
const players = [
  { id: "p1", name: "Alice Smith", imageUrl: null },
  { id: "p2", name: "Alan Jones", imageUrl: null },
  { id: "p3", name: "Bob Brown", imageUrl: null },
];

function mockTournament(overrides: Partial<TournamentDetailDto> = {}, signedUp = 0) {
  mockTournamentPages(
    { ...tournament, ...overrides },
    Array.from({ length: signedUp }, (_, i) => registrationDto(`r${i}`, `P${i}`)),
    club,
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

describe("PublicRegisterPage: where focus goes (MA-P3REV1-03)", () => {
  it("moves focus to each new step, and leaves it alone when the page first loads", async () => {
    mockTournament();
    mockSearch();
    const user = userEvent.setup();
    renderPage();

    const step = await screen.findByTestId("registration-step");
    expect(step).not.toHaveFocus();
    await user.click(screen.getByTestId("player-type-existing"));
    await user.click(screen.getByTestId("step1-next"));
    await waitFor(() => expect(screen.getByTestId("registration-step")).toHaveFocus());
    expect(screen.getByText("Find Your Name")).toBeInTheDocument();
    // The box is named by the words on screen, so "tap Find Your Name" works in Voice Control (MA-REV-08).
    expect(screen.getByRole("searchbox", { name: "Find Your Name" })).toBe(screen.getByTestId("player-search"));

    await user.type(screen.getByTestId("player-search"), "Al");
    await user.click(await screen.findByRole("button", { name: "Alan Jones" }));
    await user.click(screen.getByTestId("step2-next"));
    await waitFor(() => expect(screen.getByTestId("registration-step")).toHaveFocus());
    expect(screen.getByTestId("registering-as")).toBeInTheDocument();
  });
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
    // Said once, on the field: not above the form as well.
    expect(screen.queryByTestId("sign-up-problem")).not.toBeInTheDocument();
  });

  it("puts every refusal the server names a field for on that field, not only the first (P3REV2-CQ-06)", async () => {
    mockTournament();
    server.use(
      http.post("/api/players", () =>
        apiError(400, "VALIDATION", "Invalid player details", [
          { code: "custom", path: ["tournamentId"], message: "Unknown tournament" },
          { code: "custom", path: ["phone"], message: "Enter a New Zealand phone number" },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await fillNewPlayer(user);

    expect(await screen.findByText("Enter a New Zealand phone number")).toBeInTheDocument();
    expect(screen.getByTestId("player-phone")).toHaveAttribute("aria-invalid", "true");
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
    mockTournament({ status: "in_progress", maxPlayers: 3, viewer: { canManage: true, canOwn: false } }, 3);
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

describe("PublicRegisterPage: new player details", () => {
  async function openNewPlayer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByTestId("player-type-new"));
    await user.click(screen.getByTestId("step1-next"));
  }

  it("asks for a name and a phone number before signing anyone up", async () => {
    mockTournament();
    let posts = 0;
    server.use(
      http.post("/api/players", () => {
        posts++;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await openNewPlayer(user);
    await user.click(screen.getByTestId("step2-next"));

    expect(await screen.findByText("Phone number is required")).toBeInTheDocument();
    expect(screen.getByTestId("player-name")).toHaveAttribute("aria-invalid", "true");
    expect(posts).toBe(0);
  });

  it("uses New Zealand examples and tells the player what happens to their details, with the full notice a tab away (CC-06)", async () => {
    mockTournament();
    const user = userEvent.setup();
    renderPage();

    await openNewPlayer(user);

    expect(screen.getByTestId("player-phone")).toHaveAttribute("placeholder", "e.g. 021 123 4567");
    expect(screen.getByTestId("player-name")).not.toHaveAttribute("placeholder", "John Doe");
    expect(screen.getByTestId("privacy-notice")).toHaveTextContent("only the club's staff and the site's administrators see your phone number");
    const link = screen.getByRole("link", { name: /How we look after your details/ });
    expect(link).toHaveAttribute("href", "/privacy");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("puts the server's validation problem on the field it is about", async () => {
    mockTournament();
    server.use(
      http.post("/api/players", () => apiError(400, "VALIDATION", "Invalid player data", [{ path: ["name"], message: "That name is too long" }])),
    );
    const user = userEvent.setup();
    renderPage();

    await openNewPlayer(user);
    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));

    expect(await screen.findByText("That name is too long")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
  });

  it.each([
    ["RATE_LIMITED", 429, "Too many requests from this network just now."],
    ["TOURNAMENT_CLOSED", 409, "Registration for this tournament has closed."],
    ["NOT_FOUND", 404, "This tournament no longer exists."],
  ] as const)("explains a %s refusal of the sign-up in plain words", async (code, status, message) => {
    mockTournament();
    server.use(http.post("/api/players", () => apiError(status, code, "refused")));
    const user = userEvent.setup();
    renderPage();

    await openNewPlayer(user);
    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));

    expect(await screen.findByTestId("sign-up-problem")).toHaveTextContent(message);
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
  });

  it("does not sign the player up again after Back and Continue with the same details, and does when they change (PUB-06)", async () => {
    mockTournament();
    const created: unknown[] = [];
    server.use(
      http.post("/api/players", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({ id: `p${created.length}`, name: "Alice Smith", imageUrl: null, signUpToken: `token-${created.length}` }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await openNewPlayer(user);
    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();

    await user.click(screen.getByTestId("step3-back"));
    expect(screen.getByTestId("player-name")).toHaveValue("Alice Smith");
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(created).toHaveLength(1);

    await user.click(screen.getByTestId("step3-back"));
    await user.clear(screen.getByTestId("player-phone"));
    await user.type(screen.getByTestId("player-phone"), "021 555 0199");
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(created).toHaveLength(2);
  });
});

describe("PublicRegisterPage: photo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Continue waiting while the photo uploads, then signs up with it (PUB-22: the controls are buttons, not hover-only)", async () => {
    const sent = installFakeXhr();
    mockTournament();
    let created: unknown;
    server.use(
      http.post("/api/players", async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ id: "p9", name: "Alice Smith", imageUrl: AVATAR, signUpToken: "token-p9" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("player-type-new"));
    await user.click(screen.getByTestId("step1-next"));
    expect(screen.getByRole("button", { name: "Take Photo" })).toBeVisible();
    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(64)], "me.jpg", { type: "image/jpeg" })] } });
    await user.click(await screen.findByRole("button", { name: "Use this" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(screen.getByTestId("step2-next")).toBeDisabled();
    expect(screen.getByTestId("step2-next")).toHaveTextContent("Uploading photo...");
    act(() => sent[0].respond(201, { kind: "player_avatar", url: AVATAR, variants: {}, width: 512, height: 512, dominantColor: null }));

    await waitFor(() => expect(screen.getByTestId("step2-next")).toHaveTextContent("Continue"));
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", AVATAR);
    expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));

    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(created).toEqual({ name: "Alice Smith", phone: "021 555 0100", imageUrl: AVATAR, tournamentId: "t1" });
  });

  it("keeps the photo saved with the sign-up after Back, rather than a new one the server would drop (P3REV3-IMG-01)", async () => {
    mockTournament();
    let posts = 0;
    server.use(
      http.post("/api/players", () => {
        posts += 1;
        return HttpResponse.json({ id: "p9", name: "Alice Smith", imageUrl: null, signUpToken: "token-p9" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("player-type-new"));
    await user.click(screen.getByTestId("step1-next"));
    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();

    await user.click(screen.getByTestId("step3-back"));
    expect(screen.getByText("Saved with your sign-up. The TD can change your photo at the desk.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take Photo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(posts).toBe(1);
    expect(screen.queryByText("Welcome back!")).not.toBeInTheDocument();
  });

  it("tells a returning player their new photo was not saved, and shows the one they have (P3REV3-IMG-01)", async () => {
    const sent = installFakeXhr();
    mockTournament();
    server.use(
      http.post("/api/players", () =>
        HttpResponse.json({ id: "p1", name: "Alice Smith", imageUrl: null, existing: true, signUpToken: "token-for-p1" }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("player-type-new"));
    await user.click(screen.getByTestId("step1-next"));
    const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(64)], "me.jpg", { type: "image/jpeg" })] } });
    await user.click(await screen.findByRole("button", { name: "Use this" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    act(() => sent[0].respond(201, { kind: "player_avatar", url: AVATAR, variants: {}, width: 512, height: 512, dominantColor: null }));
    await waitFor(() => expect(screen.getByTestId("step2-next")).toHaveTextContent("Continue"));
    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));

    expect(await screen.findByText(/Your new photo was not saved: the TD can change it at the desk/)).toBeInTheDocument();
    await user.click(screen.getByTestId("step3-back"));
    expect(screen.queryByRole("img", { name: "Upload preview" })).not.toBeInTheDocument();
  });
});

describe("PublicRegisterPage: high hands and the total", () => {
  it("never asks about a high hand switched on with no price, so nobody is offered a $0.00 entry (P3REV3-CQ-03)", async () => {
    mockTournament({ enableHighHand: true, highHandAmount: null });
    mockSearch();
    const user = userEvent.setup();
    renderPage();

    await chooseExistingPlayer(user, "Bob", "Bob Brown");
    expect(screen.getByText("Total Amount").nextSibling).toHaveTextContent("$50.00");
    expect(screen.queryByText("Yes, I'm in!")).not.toBeInTheDocument();
    expect(screen.queryByText(/high hands competition/)).not.toBeInTheDocument();
  });

  it("adds the high-hand entry to what is owed, and sends the choice", async () => {
    mockTournament({ enableHighHand: true, highHandAmount: "20.00" });
    mockSearch();
    let registered: unknown;
    server.use(
      http.post("/api/tournaments/t1/registrations", async ({ request }) => {
        registered = await request.json();
        return HttpResponse.json({ id: "r1", playerId: "p3" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await chooseExistingPlayer(user, "Bob", "Bob Brown");
    expect(screen.getByText("Total Amount").nextSibling).toHaveTextContent("$50.00");
    await user.click(screen.getByText("Yes, I'm in!"));
    expect(screen.getByText("Total Amount").nextSibling).toHaveTextContent("$70.00");
    await user.click(screen.getByTestId("complete-registration"));

    expect(await screen.findByTestId("amount-due")).toHaveTextContent("$70.00");
    expect(screen.getByTestId("amount-due").nextElementSibling).toHaveTextContent("Buy-in: $50.00 + High Hands: $20.00");
    expect(registered).toEqual({ playerId: "p3", enteringHighHands: true });
  });

  it.each([
    ["HIGH_HAND_NOT_AVAILABLE", 400, "High hands isn't available for this tournament."],
    ["PLAYER_NOT_FOUND", 404, "We couldn't find that player."],
    ["RATE_LIMITED", 429, "Too many requests from this network just now."],
  ] as const)("explains a %s refusal of the registration in plain words", async (code, status, message) => {
    mockTournament();
    mockSearch();
    server.use(http.post("/api/tournaments/t1/registrations", () => apiError(status, code, "refused")));
    const user = userEvent.setup();
    renderPage();

    await chooseExistingPlayer(user, "Bob", "Bob Brown");
    await user.click(screen.getByTestId("complete-registration"));

    expect(await screen.findByTestId("registration-problem")).toHaveTextContent(message);
  });

  it("starts again for the next player on the same phone", async () => {
    mockTournament();
    mockSearch();
    server.use(http.post("/api/tournaments/t1/registrations", () => HttpResponse.json({ id: "r1", playerId: "p3" }, { status: 201 })));
    const user = userEvent.setup();
    renderPage();

    await chooseExistingPlayer(user, "Bob", "Bob Brown");
    await user.click(screen.getByTestId("complete-registration"));
    await user.click(await screen.findByTestId("register-another"));

    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("player-type-new")).not.toBeChecked();
    expect(screen.getByTestId("player-type-existing")).not.toBeChecked();
    // "Complete" is the sign-up's own success, which starting again resets (P3REV3-CQ-13): the next player signs up afresh.
    expect(screen.queryByText("Registration Complete!")).not.toBeInTheDocument();
    await chooseExistingPlayer(user, "Bob", "Bob Brown");
    await user.click(screen.getByTestId("complete-registration"));
    expect(await screen.findByText("Registration Complete!")).toBeInTheDocument();
  });
});

describe("PublicRegisterPage: the page", () => {
  it("asks the player to choose before going on", async () => {
    mockTournament();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("step1-next"));

    expect(await screen.findByText("Please choose if you're a new or existing player.")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("shows the club and keeps search engines away, as the page names players (CC-19)", async () => {
    mockTournament();
    renderPage();

    expect(await screen.findByRole("link", { name: /Central Stars/ })).toHaveAttribute("href", "/club/central-stars");
    expect(screen.getByRole("heading", { level: 1, name: "Friday Freezeout" })).toBeInTheDocument();
    expect(document.title).toBe("Register: Friday Freezeout | LovePoker.club");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  it("offers to try again when the tournament could not be loaded", async () => {
    let fail = true;
    server.use(
      http.get("/api/tournaments/t1", () => (fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json(tournament))),
      http.get("/api/clubs/c1", () => HttpResponse.json(club)),
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("player-type-new")).toBeInTheDocument();
  });
});
