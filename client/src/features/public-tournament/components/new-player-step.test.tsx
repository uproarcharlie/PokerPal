/**
 * The QR sign-up's new player (round 7, item 9): the mobile number is optional, and the club's players
 * with the same name are offered first ("Already played here? That's me"), with or without a number
 * (R7FREV1-02), so a returning player signs up as themselves rather than as a second player. The
 * server finds them by the whole name (match=exact, R7FREV1-01).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import type { AutoSeatResultDto } from "@shared/api/seating";
import { clubDto, mockTournamentPages, tournamentDto } from "@test/helpers/f2-public";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import PublicRegisterPage from "../pages/public-register";

const NO_TABLES: AutoSeatResultDto = { status: "waiting", reason: "no_tables" };
const AVATAR = "/avatars/shark.svg";
const ALICE = { id: "p1", name: "Alice Smith", imageUrl: "/uploads/players/alice-512.webp" };
const known = [ALICE, { id: "p2", name: "Alice Smithers", imageUrl: null }, { id: "p3", name: "Bob Brown", imageUrl: null }];

interface Search {
  q: string;
  match: string | null;
}

interface Sent {
  searches: Search[];
  created: unknown[];
  registered: unknown[];
}

/** The "That's me" lookup the page asks: the players called exactly `q`. */
const exact = (q: string): Search => ({ q, match: "exact" });
const tidied = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The club's search (by part of a name, or a whole one), sign-up and registration, recording what each was sent. */
function mockSignUp(players = known): Sent {
  const sent: Sent = { searches: [], created: [], registered: [] };
  mockTournamentPages(tournamentDto({ status: "registration", buyInAmount: "50.00" }), [], clubDto());
  server.use(
    http.get("/api/public/tournaments/t1/players", ({ request }) => {
      const params = new URL(request.url).searchParams;
      const q = params.get("q") ?? "";
      const match = params.get("match");
      sent.searches.push({ q, match });
      const found = match === "exact" ? players.filter((player) => tidied(player.name) === tidied(q)) : players.filter((player) => player.name.toLowerCase().includes(q.toLowerCase()));
      return HttpResponse.json(found);
    }),
    http.post("/api/players", async ({ request }) => {
      sent.created.push(await request.json());
      return HttpResponse.json({ id: "p9", name: "Alice Smith", imageUrl: null, signUpToken: "token-for-p9" }, { status: 201 });
    }),
    http.post("/api/tournaments/t1/registrations", async ({ request }) => {
      const body = (await request.json()) as { playerId: string };
      sent.registered.push(body);
      return HttpResponse.json({ id: "r1", playerId: body.playerId, seating: NO_TABLES }, { status: 201 });
    }),
  );
  return sent;
}

async function openDetails(user: ReturnType<typeof userEvent.setup>, { avatar = false } = {}) {
  renderWithApp(<PublicRegisterPage />, { path: "/register/t1", route: "/register/:tournamentId" });
  await user.click(await screen.findByTestId("player-type-new"));
  await user.click(screen.getByTestId("step1-next"));
  if (avatar) {
    await user.click(screen.getByRole("button", { name: "Pick an avatar" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Pick an avatar" })).getByRole("button", { name: "Shark" }));
    await user.click(screen.getByTestId("photo-next"));
  } else {
    await user.click(screen.getByTestId("photo-skip"));
  }
}

beforeEach(() => {
  mockSignedOut();
});

describe("NewPlayerStep: the mobile number is optional (round 7, item 9)", () => {
  it("labels the number optional, says it is kept only if given, and signs up a new player without one", async () => {
    const sent = mockSignUp([]);
    const user = userEvent.setup();
    await openDetails(user);

    expect(screen.getByLabelText("Mobile (optional)")).toBe(screen.getByTestId("player-phone"));
    expect(screen.getByTestId("privacy-notice")).toHaveTextContent("your photo and, if you give it, your phone number");
    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.click(screen.getByTestId("step2-next"));

    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(sent.searches).toEqual([exact("Alice Smith")]);
    expect(sent.created).toEqual([{ name: "Alice Smith", phone: null, tournamentId: "t1" }]);
    await user.click(screen.getByTestId("complete-registration"));
    expect(await screen.findByText("Registration Complete!")).toBeInTheDocument();
    expect(sent.registered).toEqual([{ playerId: "p9", enteringHighHands: false, signUpToken: "token-for-p9" }]);
  });

  it("still asks for a name, and refuses a number with no digits in it", async () => {
    const sent = mockSignUp();
    const user = userEvent.setup();
    await openDetails(user);

    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(screen.getByTestId("player-name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("player-phone")).not.toHaveAttribute("aria-invalid", "true");

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "n/a");
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByText("Enter a mobile number, or leave it blank")).toBeInTheDocument();
    expect(sent).toEqual({ searches: [], created: [], registered: [] });
  });

  it("goes on with the number when nobody at the club has the name, matched by it as before", async () => {
    const sent = mockSignUp([]);
    const user = userEvent.setup();
    await openDetails(user);

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));

    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.queryByTestId("same-name-suggestion")).not.toBeInTheDocument();
    expect(sent.searches).toEqual([exact("Alice Smith")]);
    expect(sent.created).toEqual([{ name: "Alice Smith", phone: "021 555 0100", tournamentId: "t1" }]);
  });

  it("offers the players with the name when a number is typed too: one who signed up without a number has none to be found by (R7FREV1-02)", async () => {
    const sent = mockSignUp();
    const user = userEvent.setup();
    await openDetails(user);

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));

    const suggestion = await screen.findByTestId("same-name-suggestion");
    expect(within(suggestion).getAllByRole("button")).toHaveLength(1);
    expect(sent.created).toEqual([]);
    // Not them: signed up with the number, which the server matches as before.
    await user.click(screen.getByTestId("same-name-new"));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(sent.created).toEqual([{ name: "Alice Smith", phone: "021 555 0100", tournamentId: "t1" }]);
  });

  it("signs the player chosen up as themselves when a number is typed too, sending no number", async () => {
    const sent = mockSignUp();
    const user = userEvent.setup();
    await openDetails(user);

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.type(screen.getByTestId("player-phone"), "021 555 0100");
    await user.click(screen.getByTestId("step2-next"));
    await user.click(await screen.findByTestId("same-name-p1"));
    await user.click(await screen.findByTestId("complete-registration"));

    expect(await screen.findByText("Registration Complete!")).toBeInTheDocument();
    expect(sent.created).toEqual([]);
    expect(sent.registered).toEqual([{ playerId: "p1", enteringHighHands: false }]);
  });
});

describe("NewPlayerStep: Already played here? That's me (round 7, item 9)", () => {
  it("offers the club's players with exactly that name, picture and name only, and signs the one chosen up as themselves", async () => {
    const sent = mockSignUp();
    const user = userEvent.setup();
    await openDetails(user);

    await user.type(screen.getByTestId("player-name"), "  alice   SMITH ");
    await user.click(screen.getByTestId("step2-next"));

    const suggestion = await screen.findByTestId("same-name-suggestion");
    expect(suggestion).toHaveFocus();
    expect(within(suggestion).getByText("Already played here?")).toBeInTheDocument();
    // "Alice Smithers" contains the name but is someone else.
    expect(within(suggestion).getAllByRole("button")).toHaveLength(1);
    expect(sent.searches).toEqual([exact("alice SMITH")]);
    expect(sent.created).toEqual([]);
    expect(screen.queryByTestId("step2-next")).not.toBeInTheDocument();

    await user.click(within(suggestion).getByRole("button", { name: "Alice Smith That's me" }));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByTestId("registering-as")).toHaveTextContent("Alice Smith");
    expect(await screen.findByText("Welcome back!")).toBeInTheDocument();
    await user.click(screen.getByTestId("complete-registration"));

    expect(await screen.findByText("Registration Complete!")).toBeInTheDocument();
    // Found by the club's own search: no new player, and no token.
    expect(sent.created).toEqual([]);
    expect(sent.registered).toEqual([{ playerId: "p1", enteringHighHands: false }]);
  });

  it("makes a new player after all on No, I'm new here", async () => {
    const sent = mockSignUp();
    const user = userEvent.setup();
    await openDetails(user, { avatar: true });

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.click(screen.getByTestId("step2-next"));
    await user.click(await screen.findByTestId("same-name-new"));

    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(sent.created).toEqual([{ name: "Alice Smith", phone: null, imageUrl: AVATAR, tournamentId: "t1" }]);
    await user.click(screen.getByTestId("complete-registration"));
    expect(await screen.findByText("Registration Complete!")).toBeInTheDocument();
    expect(sent.registered).toEqual([{ playerId: "p9", enteringHighHands: false, signUpToken: "token-for-p9" }]);
  });

  it("says a new picture is not saved over the one the chosen player has", async () => {
    mockSignUp();
    const user = userEvent.setup();
    await openDetails(user, { avatar: true });

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.click(screen.getByTestId("step2-next"));
    await user.click(await screen.findByTestId("same-name-p1"));

    expect(await screen.findByText(/Your new photo was not saved/)).toBeInTheDocument();
  });

  it("takes the suggestion away once the name or the number changes, and asks again for a new name", async () => {
    const sent = mockSignUp();
    const user = userEvent.setup();
    await openDetails(user);

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByTestId("same-name-suggestion")).toBeInTheDocument();

    await user.type(screen.getByTestId("player-phone"), "021");
    expect(screen.queryByTestId("same-name-suggestion")).not.toBeInTheDocument();
    await user.clear(screen.getByTestId("player-phone"));
    expect(screen.getByTestId("same-name-suggestion")).toBeInTheDocument();

    await user.type(screen.getByTestId("player-name"), "s");
    expect(screen.queryByTestId("same-name-suggestion")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(sent.searches).toEqual([exact("Alice Smith"), exact("Alice Smiths")]);
    expect(sent.created).toEqual([{ name: "Alice Smiths", phone: null, tournamentId: "t1" }]);
  });

  it("goes back to the details from the player chosen, and offers them again", async () => {
    const sent = mockSignUp();
    const user = userEvent.setup();
    await openDetails(user);

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.click(screen.getByTestId("step2-next"));
    await user.click(await screen.findByTestId("same-name-p1"));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();

    await user.click(screen.getByTestId("step3-back"));
    expect(screen.getByTestId("player-name")).toHaveValue("Alice Smith");
    await user.click(screen.getByTestId("step2-next"));
    expect(await screen.findByTestId("same-name-suggestion")).toBeInTheDocument();
    expect(sent.created).toEqual([]);
  });

  it("goes on with a new player when the search cannot be asked", async () => {
    const sent = mockSignUp();
    server.use(http.get("/api/public/tournaments/t1/players", () => HttpResponse.json({ error: "Busy", code: "RATE_LIMITED" }, { status: 429 })));
    const user = userEvent.setup();
    await openDetails(user);

    await user.type(screen.getByTestId("player-name"), "Alice Smith");
    await user.click(screen.getByTestId("step2-next"));

    await waitFor(() => expect(sent.created).toEqual([{ name: "Alice Smith", phone: null, tournamentId: "t1" }]));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
  });
});
