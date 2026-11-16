/**
 * The Register player sheet's new player (round 7, item 9): a name and, if they give one, a mobile
 * number; the players with that name are offered first ("That's them"), with or without a number
 * (R7FREV1-02), found by the server by the whole name (match=exact, R7FREV1-01), so a returning player
 * is not added twice. At a phone's width, as the TD uses it.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import type { AutoSeatResultDto } from "@shared/api/seating";
import type { Cents } from "@shared/domain/money";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { RegisterPlayerDialog } from "./register-player-dialog";

const SEATED: AutoSeatResultDto = { status: "seated", seat: { tableId: "tb1", tableNumber: 1, tableName: "Table 1", seatNumber: 4 } };
const SAM = { id: "p-sam", name: "Sam Taylor", imageUrl: "/uploads/players/sam-512.webp" };
const known = [SAM, { id: "p-sammy", name: "Sam Taylorson", imageUrl: null }];

interface Search {
  q: string;
  match: string | null;
}

interface Sent {
  searches: Search[];
  created: unknown[];
  registered: unknown[];
}

/** The "That's them" lookup the sheet asks: the players called exactly `q`. */
const exact = (q: string): Search => ({ q, match: "exact" });
const tidied = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The search (by part of a name, or a whole one), the new player and the registration, recording what each was sent. */
function mockDesk(): Sent {
  const sent: Sent = { searches: [], created: [], registered: [] };
  server.use(
    http.get("/api/public/tournaments/t1/players", ({ request }) => {
      const params = new URL(request.url).searchParams;
      const q = params.get("q") ?? "";
      const match = params.get("match");
      sent.searches.push({ q, match });
      const found = match === "exact" ? known.filter((player) => tidied(player.name) === tidied(q)) : known.filter((player) => player.name.toLowerCase().includes(q.toLowerCase()));
      return HttpResponse.json(found);
    }),
    http.post("/api/players", async ({ request }) => {
      const body = (await request.json()) as { name: string };
      sent.created.push(body);
      return HttpResponse.json(
        { id: "p-new", name: body.name, email: null, phone: null, imageUrl: null, createdAt: "2026-11-16T00:00:00.000Z", signUpToken: "t" },
        { status: 201 },
      );
    }),
    http.post("/api/tournaments/t1/registrations", async ({ request }) => {
      const body = (await request.json()) as { playerId: string };
      sent.registered.push(body);
      const player = body.playerId === SAM.id ? SAM : { id: body.playerId, name: "Walk In", imageUrl: null };
      return HttpResponse.json({ id: "r9", playerId: body.playerId, player, paymentConfirmed: false, seating: SEATED }, { status: 201 });
    }),
  );
  return sent;
}

function renderSheet() {
  const user = userEvent.setup();
  renderWithApp(<RegisterPlayerDialog open onOpenChange={() => {}} tournamentId="t1" buyInCents={5000 as Cents} rakeLabel="AP" />);
  return user;
}

async function addNewPlayer(user: ReturnType<typeof userEvent.setup>, name: string, phone = "") {
  await user.click(screen.getByTestId("add-new-player"));
  await user.type(screen.getByTestId("new-player-name"), name);
  if (phone) await user.type(screen.getByTestId("new-player-phone"), phone);
  await user.click(screen.getByTestId("new-player-add"));
}

beforeEach(() => {
  screenWidth(390);
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("Register player: a new player (round 7, item 9)", () => {
  it("adds a player with only a name for this tournament's club, then registers them", async () => {
    const sent = mockDesk();
    const user = renderSheet();

    expect(screen.getByTestId("register-player-final")).toBeDisabled();
    await user.click(screen.getByTestId("add-new-player"));
    const fields = screen.getByRole("group", { name: "Player" });
    expect(within(fields).getByLabelText("Mobile (optional)")).toBe(screen.getByTestId("new-player-phone"));
    await user.type(within(fields).getByRole("textbox", { name: "Name" }), "Walk In");
    await user.click(screen.getByTestId("new-player-add"));

    expect(await screen.findByTestId("new-player-added")).toHaveTextContent("New player added");
    expect(sent.searches).toEqual([exact("Walk In")]);
    expect(sent.created).toEqual([{ name: "Walk In", phone: null, tournamentId: "t1" }]);
    await user.click(screen.getByTestId("register-player-final"));

    expect(await screen.findByText("Walk In is in. Seated at Table 1, Seat 4.")).toBeInTheDocument();
    expect(sent.registered).toEqual([{ playerId: "p-new", buyIns: 1, rebuys: 0, addons: 0 }]);
  });

  it("offers the player with that name first, and registers them instead of adding a second one", async () => {
    const sent = mockDesk();
    const user = renderSheet();

    await addNewPlayer(user, "sam taylor");

    const suggestion = await screen.findByTestId("same-name-suggestion");
    expect(within(suggestion).getByText("Played before?")).toBeInTheDocument();
    // Sam Taylorson's name contains the one typed, but is someone else's.
    expect(within(suggestion).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByTestId("register-player-final")).toBeDisabled();
    await user.click(within(suggestion).getByRole("button", { name: "Sam Taylor That's them" }));

    expect(screen.getByTestId("new-player-added")).toHaveTextContent("Has played before");
    await user.click(screen.getByTestId("register-player-final"));
    expect(await screen.findByText("Sam Taylor is in. Seated at Table 1, Seat 4.")).toBeInTheDocument();
    expect(sent.created).toEqual([]);
    expect(sent.registered).toEqual([{ playerId: "p-sam", buyIns: 1, rebuys: 0, addons: 0 }]);
  });

  it("adds a new player after all on No, add a new player", async () => {
    const sent = mockDesk();
    const user = renderSheet();

    await addNewPlayer(user, "Sam Taylor");
    await user.click(await screen.findByTestId("same-name-new"));

    expect(await screen.findByTestId("new-player-added")).toHaveTextContent("New player added");
    expect(sent.created).toEqual([{ name: "Sam Taylor", phone: null, tournamentId: "t1" }]);
  });

  it("offers the player with that name when a number is given too, then sends the number and says a stored player was found by it (R7FREV1-02)", async () => {
    const sent = mockDesk();
    server.use(
      http.post("/api/players", async ({ request }) => {
        sent.created.push(await request.json());
        return HttpResponse.json({ ...SAM, existing: true, signUpToken: "t" });
      }),
    );
    const user = renderSheet();

    await addNewPlayer(user, "Sam Taylor", "021 555 0100");
    // A player added by name only has no number stored to be found by: the name is asked about first.
    expect(within(await screen.findByTestId("same-name-suggestion")).getAllByRole("button")).toHaveLength(1);
    expect(sent.searches).toEqual([exact("Sam Taylor")]);
    expect(sent.created).toEqual([]);
    // Typing another number takes the suggestion away; the number it was found with brings it back.
    await user.type(screen.getByTestId("new-player-phone"), "9");
    expect(screen.queryByTestId("same-name-suggestion")).not.toBeInTheDocument();
    await user.type(screen.getByTestId("new-player-phone"), "{Backspace}");
    await user.click(await screen.findByTestId("same-name-new"));

    expect(await screen.findByTestId("new-player-added")).toHaveTextContent("found by their mobile number");
    expect(sent.created).toEqual([{ name: "Sam Taylor", phone: "021 555 0100", tournamentId: "t1" }]);
  });

  it("sends a number at once when nobody has the name", async () => {
    const sent = mockDesk();
    const user = renderSheet();

    await addNewPlayer(user, "Walk In", "021 555 0100");

    expect(await screen.findByTestId("new-player-added")).toHaveTextContent("New player added");
    expect(sent.searches).toEqual([exact("Walk In")]);
    expect(sent.created).toEqual([{ name: "Walk In", phone: "021 555 0100", tournamentId: "t1" }]);
  });

  it("puts a number that is someone else's under the mobile box", async () => {
    mockDesk();
    server.use(http.post("/api/players", () => apiError(409, "PHONE_TAKEN", "That phone number is already registered to another player.")));
    const user = renderSheet();

    await addNewPlayer(user, "Walk In", "021 555 0100");

    expect(await screen.findByText("That phone number is already registered to another player.")).toBeInTheDocument();
    expect(screen.getByTestId("new-player-phone")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("register-player-final")).toBeDisabled();
  });

  it("needs a name, refuses a number with no digits, and adds on Enter rather than registering nobody", async () => {
    const sent = mockDesk();
    const user = renderSheet();

    await user.click(screen.getByTestId("add-new-player"));
    await user.click(screen.getByTestId("new-player-add"));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    await user.type(screen.getByTestId("new-player-name"), "Walk In");
    await user.type(screen.getByTestId("new-player-phone"), "none{Enter}");
    expect(await screen.findByText("Enter a mobile number, or leave it blank")).toBeInTheDocument();
    expect(sent).toEqual({ searches: [], created: [], registered: [] });

    await user.clear(screen.getByTestId("new-player-phone"));
    await user.type(screen.getByTestId("new-player-name"), "{Enter}");
    expect(await screen.findByTestId("new-player-added")).toBeInTheDocument();
    expect(sent.registered).toEqual([]);
  });

  it("goes back to the search, and lets the TD change who was added", async () => {
    mockDesk();
    const user = renderSheet();

    await addNewPlayer(user, "Walk In");
    await user.click(await screen.findByTestId("new-player-change"));
    expect(screen.getByTestId("new-player-name")).toHaveValue("Walk In");
    expect(screen.getByTestId("register-player-final")).toBeDisabled();

    await user.click(screen.getByTestId("new-player-search"));
    expect(screen.getByRole("searchbox", { name: "Player" })).toBeInTheDocument();
    expect(screen.getByTestId("register-player-final")).toBeDisabled();
  });
});
