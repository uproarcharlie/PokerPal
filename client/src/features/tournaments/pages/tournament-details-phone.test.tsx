/**
 * The TD's tournament page on a phone, 390 px wide (round5-contracts §8.1, next-round item 10): the
 * sticky header with the live clock, the bottom tab bar, the quick actions and their sheets, and the
 * bust in three taps. The wide layout's own tests are in tournament-details(-desk).test.tsx.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, mockDeskLiveReads, pendingActionDto, recordBodies, registrationDto, screenWidth, tournamentDto } from "@test/helpers/f1-tournaments";
import { liveDisplayDto, pausedClock, recordClockActions, runningClock, serveDisplay } from "@test/helpers/clock-dto";
import { mockSeating, seatingDto, seatRef } from "@test/helpers/seating-dto";
import type { PendingActionDto } from "@shared/api/pending-actions";
import type { PublicRegistration } from "@shared/api/public";
import type { ConfirmedRegistrationDto, ManagedRegistration, PaymentConfirmedDto, PendingRegistrationDto, RegistrationCreatedDto } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { playerName } from "../player-name";
import TournamentDetailsPage from "./tournament-details";

/** Ann signed up first and Cat last: the bust sheet lists the newest first. All paid: only paid players are in the pool (round 6). */
const field: ManagedRegistration[] = [
  registrationDto("r1", "Ann", 2, { registrationTime: "2026-10-23T06:00:00.000Z" }),
  registrationDto("r2", "Bob", 2, { registrationTime: "2026-10-23T06:10:00.000Z" }),
  registrationDto("r3", "Cat", 1, { registrationTime: "2026-10-23T06:20:00.000Z" }),
].map((registration) => ({ ...registration, paymentConfirmed: true }));

function mockDesk({
  tournament = {},
  registrations = field,
  requests = [],
}: { tournament?: Partial<TournamentDetailDto>; registrations?: PublicRegistration[]; requests?: PendingActionDto[] } = {}) {
  mockDeskLiveReads(tournamentDto(tournament), registrations);
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto(tournament))),
    http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
    http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json(requests)),
  );
}

function renderPhone(path = "/admin/tournaments/t1") {
  screenWidth(390);
  const user = userEvent.setup();
  const view = renderWithApp(<TournamentDetailsPage />, { path, route: "/admin/tournaments/:id" });
  return { user, ...view };
}

/** Opens the quick-action button's menu and chooses `item`. */
async function quickAction(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(await screen.findByRole("button", { name: "Quick actions" }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

const notifications = () => within(screen.getByTestId("notifications"));

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("TournamentDetailsPage on a phone: the header", () => {
  it("keeps the name, the live clock with its Resume and the waiting requests in a sticky header", async () => {
    mockDesk({ requests: [pendingActionDto("pa1", "rebuy"), pendingActionDto("pa2", "addon")] });
    serveDisplay({ clock: pausedClock({ levelIndex: 1, remainingMs: 9 * 60_000 }), viewer: { canControl: true } });
    const sent = recordClockActions(() => liveDisplayDto({ clock: runningClock(Date.now(), { levelIndex: 1, remainingMs: 9 * 60_000 }), viewer: { canControl: true } }));
    const { user } = renderPhone();

    const header = await screen.findByTestId("mobile-header");
    expect(header).toHaveClass("sticky", "top-0");
    expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent("Friday Freezeout");
    expect(within(header).getByRole("link", { name: "Back to Tournaments" })).toHaveAttribute("href", "/tournaments");
    const clock = await within(header).findByTestId("mobile-clock");
    expect(clock).toHaveTextContent("Clock, paused:L29:00300/600");
    expect(await within(header).findByRole("button", { name: "2 player requests waiting" })).toHaveTextContent("2");

    const resume = within(header).getByRole("button", { name: "Resume the clock" });
    await user.click(resume);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ action: "toggle", expectedStatus: "paused" });
    expect(await within(header).findByRole("button", { name: "Pause the clock" })).toBeInTheDocument();
  });

  it("shows no clock in the header before the clock is set up", async () => {
    mockDesk();
    renderPhone();

    expect(await screen.findByTestId("mobile-header")).toBeInTheDocument();
    expect(await screen.findByTestId("field-summary")).toHaveTextContent("3 players · 3 still in · max 20");
    expect(screen.queryByTestId("mobile-clock")).not.toBeInTheDocument();
  });

  it("opens the Clock tab from the header's clock", async () => {
    mockDesk();
    serveDisplay({ clock: pausedClock({ levelIndex: 1, remainingMs: 9 * 60_000 }) });
    const { user, location } = renderPhone();

    await user.click(await screen.findByTestId("mobile-clock"));

    expect(screen.getByRole("tab", { name: "Clock" })).toHaveAttribute("aria-selected", "true");
    expect(location()).toBe("/admin/tournaments/t1?tab=clock");
  });

  it("opens the request desk from the header's badge, and confirms a request there", async () => {
    let requests = [pendingActionDto("pa1", "rebuy")];
    mockDesk({ tournament: { rebuyAmount: "25.00" } });
    server.use(
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json(requests)),
      http.post("/api/pending-actions/pa1/confirm", () => {
        requests = [];
        return HttpResponse.json({ success: true, registration: { ...field[0], paymentConfirmed: true }, reentered: false, target: null });
      }),
    );
    const { user } = renderPhone();

    await user.click(await screen.findByRole("button", { name: "1 player request waiting" }));
    const sheet = await screen.findByRole("dialog", { name: "Player requests" });
    expect(within(sheet).getByRole("link", { name: "Open the request desk" })).toHaveAttribute("href", "/admin/actions/t1");
    await user.click(await within(sheet).findByRole("button", { name: "Confirm" }));

    expect(await notifications().findByText("Player action has been confirmed.")).toBeInTheDocument();
    expect(await within(sheet).findByText("No pending actions")).toBeInTheDocument();
  });
});

describe("TournamentDetailsPage on a phone: the tab bar", () => {
  it("puts Players, Seats, Clock, Money and More in a bottom bar instead of the row of tabs, opening on Players", async () => {
    mockDesk();
    renderPhone();

    const bar = await screen.findByRole("tablist", { name: "Tournament sections" });
    expect(bar).toHaveClass("fixed", "bottom-0");
    expect(within(bar).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Players", "Seats", "Clock", "Money", "More"]);
    expect(within(bar).getByRole("tab", { name: "Players" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    // The standings are cards on a phone, never a table that scrolls sideways, and short: no points or
    // prizes before the finalize, the entries under the name.
    const card = within(await screen.findByRole("list", { name: "Standings" })).getByTestId("player-row-r1");
    expect(card).toHaveTextContent("Buy-in: 2");
    for (const gone of ["Points", "Prize", "Entry"]) expect(within(card).queryByText(gone)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps the tab in the address, and opens a wide screen's tab in the phone tab that holds it", async () => {
    mockDesk();
    const first = renderPhone();
    await first.user.click(await screen.findByRole("tab", { name: "Money" }));
    expect(first.location()).toBe("/admin/tournaments/t1?tab=money");
    expect(await screen.findByTestId("prize-pool")).toHaveTextContent("$475");
    await first.user.click(screen.getByRole("tab", { name: "Players" }));
    expect(first.location()).toBe("/admin/tournaments/t1");
    first.unmount();

    for (const [wide, phone] of [
      ["overview", "Money"],
      ["standings", "Players"],
      ["activity", "More"],
      ["seating", "Seats"],
    ]) {
      const view = renderPhone(`/admin/tournaments/t1?tab=${wide}`);
      expect(await screen.findByRole("tab", { name: phone })).toHaveAttribute("aria-selected", "true");
      view.unmount();
    }
  });

  it("opens each tab at its top, not part-way down where the last one was left", async () => {
    mockDesk();
    screenWidth(390);
    const user = userEvent.setup();
    renderWithApp(
      <main id="main">
        <TournamentDetailsPage />
      </main>,
      { path: "/admin/tournaments/t1", route: "/admin/tournaments/:id" },
    );
    await screen.findByRole("list", { name: "Standings" });
    const page = screen.getByRole("main");
    page.scrollTop = 600;

    await user.click(screen.getByRole("tab", { name: "Money" }));

    expect(page.scrollTop).toBe(0);
  });

  it("flags the seating that needs the TD on the Seats tab", async () => {
    mockDesk();
    mockSeating(seatingDto({ tables: [{ id: "tb1", number: 1, seated: { 1: { id: "r1", name: "Ann" }, 2: { id: "r2", name: "Bob" } } }], unseated: [{ id: "r3", name: "Cat" }] }));
    renderPhone();

    // Said to a screen reader in words; a dot on screen.
    const seats = await screen.findByRole("tab", { name: /^Seats\W+1 waiting$/ });
    expect(within(seats).getByTestId("seats-tab-alert")).toBeInTheDocument();
  });

  it("keeps the wide layout from tablet width", async () => {
    mockDesk();
    screenWidth(768);
    renderWithApp(<TournamentDetailsPage />, { path: "/admin/tournaments/t1", route: "/admin/tournaments/:id" });

    expect(await screen.findByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tablist", { name: "Tournament sections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick actions" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("mobile-header")).not.toBeInTheDocument();
  });

  it("puts the status, End Tournament, Edit and Delete in the More tab, a whole-width row each", async () => {
    mockDesk({ tournament: { status: "in_progress" } });
    server.use(http.get("/api/tournaments/t1/activity", () => HttpResponse.json([])));
    const { user } = renderPhone();

    await user.click(await screen.findByRole("tab", { name: "More" }));

    for (const testId of ["pause-tournament", "end-tournament", "edit-tournament", "delete-tournament"]) {
      expect(await screen.findByTestId(testId)).toHaveClass("w-full");
    }
    // Register is the quick-action button's, not repeated here.
    expect(screen.queryByTestId("register-player")).not.toBeInTheDocument();
    expect(screen.getByTestId("tv-clock-card")).toHaveAttribute("href", "/clock/t1?screen=tv");
    await user.click(screen.getByTestId("end-tournament"));
    expect(await screen.findByRole("dialog", { name: "End Tournament" })).toBeInTheDocument();
  });
});

describe("TournamentDetailsPage on a phone: the quick actions", () => {
  it("offers the quick actions in thumb reach, re-buy and add-on only where the tournament sells them", async () => {
    mockDesk({ tournament: { rebuyAmount: "25.00", addonAmount: "20.00" }, requests: [pendingActionDto("pa1", "rebuy")] });
    const { user } = renderPhone();

    const button = await screen.findByRole("button", { name: "Quick actions" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveClass("fixed");
    await user.click(button);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Register player",
      "Bust a player",
      "Re-buy",
      "Add-on",
      "Take payment",
      "Approve requests1 waiting",
    ]);
  });

  it("leaves out re-buys and add-ons a freezeout does not sell, and the button on a finished game", async () => {
    mockDesk();
    const { user, unmount } = renderPhone();
    await user.click(await screen.findByRole("button", { name: "Quick actions" }));
    expect(within(await screen.findByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Register player",
      "Bust a player",
      "Take payment",
      "Approve requests",
    ]);
    unmount();

    mockDesk({ tournament: { status: "completed" } });
    renderPhone();
    expect(await screen.findByRole("tab", { name: "Players" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick actions" })).not.toBeInTheDocument();
  });

  it("registers a player and says where automatic seating put them", async () => {
    mockDesk();
    server.use(
      http.get("/api/public/tournaments/t1/players", () => HttpResponse.json([{ id: "p-dee", name: "Dee Visitor", imageUrl: null }])),
      http.post("/api/tournaments/t1/registrations", () =>
        HttpResponse.json(
          {
            ...registrationDto("r9", "Dee Visitor"),
            paymentConfirmed: false,
            seating: { status: "seated", seat: seatRef("tb2", 2, 7) },
          } satisfies RegistrationCreatedDto,
          { status: 201 },
        ),
      ),
    );
    const { user } = renderPhone();

    await quickAction(user, "Register player");
    await user.type(await screen.findByRole("searchbox", { name: "Player" }), "Dee");
    await user.click(await screen.findByTestId("player-option-p-dee"));
    const register = screen.getByTestId("register-player-final");
    await user.click(register);

    expect(await notifications().findByText("Dee Visitor is in. Seated at Table 2, Seat 7.")).toBeInTheDocument();
  });

  it("says a new player waits when every table is full, with the seating a tap away", async () => {
    mockDesk();
    server.use(
      http.get("/api/public/tournaments/t1/players", () => HttpResponse.json([{ id: "p-dee", name: "Dee Visitor", imageUrl: null }])),
      http.post("/api/tournaments/t1/registrations", () =>
        HttpResponse.json(
          { ...registrationDto("r9", "Dee Visitor"), paymentConfirmed: false, seating: { status: "waiting", reason: "tables_full" } } satisfies RegistrationCreatedDto,
          { status: 201 },
        ),
      ),
    );
    const { user, location } = renderPhone();

    await quickAction(user, "Register player");
    await user.type(await screen.findByRole("searchbox", { name: "Player" }), "Dee");
    await user.click(await screen.findByTestId("player-option-p-dee"));
    await user.click(screen.getByTestId("register-player-final"));

    expect(await notifications().findByText("Dee Visitor is in. Waiting: every table is full — open a table.")).toBeInTheDocument();
    await user.click(notifications().getByRole("button", { name: "Open seating" }));
    expect(location()).toBe("/admin/tournaments/t1?tab=seating");
    expect(screen.getByRole("tab", { name: /^Seats/ })).toHaveAttribute("aria-selected", "true");
  });

  it("gives focus back to the quick-action button when a sheet chosen from it closes", async () => {
    mockDesk();
    const { user } = renderPhone();

    await quickAction(user, "Bust a player");
    const sheet = await screen.findByRole("dialog", { name: "Bust a player" });
    // The heading, not the search box: a focused box would pull the keyboard over the list.
    await waitFor(() => expect(within(sheet).getByRole("heading", { name: "Bust a player" })).toHaveFocus());
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Quick actions" })).toHaveFocus());
  });
});

describe("TournamentDetailsPage on a phone: a bust in three taps", () => {
  /**
   * Records each PUT /api/registrations/:id body, answering with that player's row as the server then
   * has it, which the registrations' next read returns too.
   */
  function mockEliminations() {
    const sent = recordBodies();
    let rows = field;
    server.use(
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(rows)),
      http.put("/api/registrations/:id", async ({ params, request }) => {
        const body = (await sent.record(request)) as { isEliminated: boolean; eliminatedBy?: string | null };
        rows = rows.map((row) => (row.id === params.id ? { ...row, isEliminated: body.isEliminated, eliminatedBy: body.eliminatedBy ?? null } : row));
        return HttpResponse.json({ ...rows.find((row) => row.id === params.id), paymentConfirmed: true });
      }),
    );
    return sent.bodies;
  }

  it("picks who is out (newest first, with photos), then who knocked them out, and offers Undo", async () => {
    mockDesk();
    const sent = mockEliminations();
    const { user } = renderPhone();

    await quickAction(user, "Bust a player");
    const sheet = await screen.findByRole("dialog", { name: "Bust a player" });
    const picker = within(sheet).getByTestId("bust-pick");
    expect(within(picker).getAllByRole("button").map((row) => row.textContent)).toEqual(["CCat", "BBob", "AAnn"]);
    // Tap 1 of 3 was the menu's "Bust a player"; tap 2: Cat is out.
    await user.click(within(picker).getByTestId("bust-pick-r3"));

    const by = await screen.findByRole("dialog", { name: "Knocked out by" });
    expect(within(by).getByTestId("bust-going-out")).toHaveTextContent("Cat");
    expect(within(by).queryByTestId("bust-by-r3")).not.toBeInTheDocument();
    // Tap 3: Bob knocked them out.
    await user.click(within(by).getByTestId("bust-by-r2"));

    await waitFor(() => expect(sent).toEqual([{ isEliminated: true, eliminatedBy: "p-r2" }]));
    expect(await notifications().findByText("Cat, knocked out by Bob.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(notifications().getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(sent).toEqual([{ isEliminated: true, eliminatedBy: "p-r2" }, { isEliminated: false }]));
  });

  it("records a bust whose knockout nobody saw as Not recorded", async () => {
    mockDesk();
    const sent = mockEliminations();
    const { user } = renderPhone();

    await quickAction(user, "Bust a player");
    await user.click(await screen.findByTestId("bust-pick-r1"));
    await user.click(await screen.findByTestId("bust-not-recorded"));

    await waitFor(() => expect(sent).toEqual([{ isEliminated: true, eliminatedBy: null }]));
    expect(await notifications().findByText("Ann is out.")).toBeInTheDocument();
  });

  it("finds a player in a big field by name, and goes back to choose someone else", async () => {
    mockDesk();
    const { user } = renderPhone();

    await quickAction(user, "Bust a player");
    const sheet = await screen.findByRole("dialog", { name: "Bust a player" });
    await user.type(within(sheet).getByRole("searchbox", { name: "Search players" }), "bo");
    expect(within(within(sheet).getByTestId("bust-pick")).getAllByRole("listitem")).toHaveLength(1);
    await user.type(within(sheet).getByRole("searchbox", { name: "Search players" }), "x");
    expect(within(sheet).getByRole("status")).toHaveTextContent("Nobody called “box”.");
    await user.clear(within(sheet).getByRole("searchbox", { name: "Search players" }));

    await user.click(within(sheet).getByTestId("bust-pick-r2"));
    const by = await screen.findByRole("dialog", { name: "Knocked out by" });
    await user.click(within(by).getByRole("button", { name: "Change" }));
    expect(await screen.findByRole("dialog", { name: "Bust a player" })).toBeInTheDocument();
  });

  it("finds names as every other 'find a name' box does: from a word's start, ignoring accents (R5REV3-CQ-03)", async () => {
    mockDesk({
      registrations: [registrationDto("r1", "Zoë Clarke", 1), registrationDto("r2", "Mark Arnold", 1), registrationDto("r3", "Clara Bow", 1)],
    });
    const { user } = renderPhone();

    await quickAction(user, "Bust a player");
    const sheet = await screen.findByRole("dialog", { name: "Bust a player" });
    const search = within(sheet).getByRole("searchbox", { name: "Search players" });
    const names = () => within(within(sheet).getByTestId("bust-pick")).getAllByRole("listitem").map((row) => row.textContent);
    await user.type(search, "zoe");
    expect(names()).toEqual([expect.stringContaining("Zoë Clarke")]);
    // "ar" starts Arnold, not the middle of Clara or Clarke.
    await user.clear(search);
    await user.type(search, "ar");
    expect(names()).toEqual([expect.stringContaining("Mark Arnold")]);
  });

  it("starts at Knocked out by from a player's row, with their table's players first", async () => {
    mockDesk();
    mockSeating(
      seatingDto({
        tables: [
          { id: "tb1", number: 1, seated: { 3: { id: "r1", name: "Ann" }, 5: { id: "r2", name: "Bob" } } },
          { id: "tb2", number: 2, seated: { 1: { id: "r3", name: "Cat" } } },
        ],
      }),
    );
    const sent = mockEliminations();
    const { user } = renderPhone();

    const eliminate = await screen.findByRole("button", { name: "Eliminate Ann" });
    await user.click(eliminate);

    const by = await screen.findByRole("dialog", { name: "Knocked out by" });
    expect(within(by).getByTestId("bust-going-out")).toHaveTextContent("AnnGoing out · Table 1 · Seat 3");
    expect(within(by).queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    expect(within(by).getByRole("heading", { name: "At Table 1" })).toBeInTheDocument();
    expect(within(by).getByRole("heading", { name: "Everyone else" })).toBeInTheDocument();
    expect(within(by).getAllByRole("listitem").map((row) => row.textContent)).toEqual(["BBob Table 1 · Seat 5", "CCat Table 2 · Seat 1"]);
    await user.click(within(by).getByTestId("bust-by-r2"));

    await waitFor(() => expect(sent).toEqual([{ isEliminated: true, eliminatedBy: "p-r2" }]));
    // Their row offers Restore at once, as quick as the bust.
    expect(await screen.findByRole("button", { name: "Restore Ann" })).toBeInTheDocument();
  });

  it("says why a bust was refused, and keeps the sheet open to try again", async () => {
    mockDesk();
    server.use(http.put("/api/registrations/:id", () => apiError(409, "ALREADY_ELIMINATED", "Cat is already out")));
    const { user } = renderPhone();

    await quickAction(user, "Bust a player");
    await user.click(await screen.findByTestId("bust-pick-r3"));
    await user.click(await screen.findByTestId("bust-by-r1"));

    expect(await notifications().findByText("Cat is already out")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Knocked out by" })).toBeInTheDocument();
    expect(screen.getByTestId("bust-by-r1")).not.toHaveAttribute("aria-disabled");
  });
});

describe("TournamentDetailsPage on a phone: re-buys and add-ons at the desk", () => {
  const rebuys = { rebuyAmount: "25.00", addonAmount: "20.00", maxRebuys: 1, maxAddons: 1, rebuyOrAddon: true } as const;

  it("sells a re-buy: the player, the price, then Record", async () => {
    mockDesk({ tournament: rebuys });
    const sent = recordBodies();
    server.use(
      http.post("/api/registrations/r2/counts", async ({ request }) => {
        await sent.record(request);
        return HttpResponse.json({ ...field[1], rebuys: 1, paymentConfirmed: true });
      }),
    );
    const { user } = renderPhone();

    await quickAction(user, "Re-buy");
    const sheet = await screen.findByRole("dialog", { name: "Re-buy · $25" });
    expect(within(sheet).getByTestId("rebuy-pick-r2")).toHaveTextContent("Bob 0 of 1 re-buy");
    await user.click(within(sheet).getByTestId("rebuy-pick-r2"));

    const confirm = await screen.findByRole("dialog", { name: "Re-buy for Bob" });
    const record = within(confirm).getByRole("button", { name: "Record re-buy ($25)" });
    await user.click(record);

    await waitFor(() => expect(sent.bodies).toEqual([{ rebuys: 1 }]));
    expect(await notifications().findByText("Bob: 1st re-buy ($25).")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("marks a player who has not paid: their re-buy joins the prize pool once their payment is, which the sheet confirms (R6REV1-PHONE-04)", async () => {
    mockDesk({ tournament: rebuys, registrations: [field[0], { ...field[1], paymentConfirmed: false }, field[2]] });
    const confirmed: string[] = [];
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", ({ params }) => {
        confirmed.push(String(params.id));
        return HttpResponse.json({ ...field[1], paymentConfirmed: true, seating: null, highHandUnawardedCents: 0 } satisfies PaymentConfirmedDto);
      }),
      http.post("/api/registrations/r2/counts", () => HttpResponse.json({ ...field[1], rebuys: 1, paymentConfirmed: false })),
    );
    const { user } = renderPhone();

    await quickAction(user, "Re-buy");
    const sheet = await screen.findByRole("dialog", { name: "Re-buy · $25" });
    expect(within(sheet).getByTestId("rebuy-pick-r2")).toHaveTextContent("Bob 0 of 1 re-buy · Not paid yet");
    expect(within(sheet).getByTestId("rebuy-pick-r1")).not.toHaveTextContent("Not paid yet");
    await user.click(within(sheet).getByTestId("rebuy-pick-r2"));

    const confirm = await screen.findByRole("dialog", { name: "Re-buy for Bob" });
    expect(within(confirm).getByTestId("top-up-unpaid")).toHaveTextContent("Bob's buy-in is not confirmed: this re-buy joins the prize pool once their payment is.");
    await user.click(within(confirm).getByRole("button", { name: "Record re-buy ($25)" }));
    expect(await notifications().findByText("Bob: 1st re-buy ($25). It joins the prize pool once their payment is confirmed.")).toBeInTheDocument();

    // Next time the TD takes Bob's payment from the same step first.
    await quickAction(user, "Re-buy");
    await user.click(within(await screen.findByRole("dialog", { name: "Re-buy · $25" })).getByTestId("rebuy-pick-r2"));
    const again = await screen.findByRole("dialog", { name: "Re-buy for Bob" });
    await user.click(within(again).getByRole("button", { name: "Confirm payment" }));
    expect(await notifications().findByText("Bob has paid: their entries are in the prize pool.")).toBeInTheDocument();
    expect(confirmed).toEqual(["r2"]);
    expect(within(again).queryByTestId("top-up-unpaid")).not.toBeInTheDocument();
  });

  it("greys out a player the house rules allow no more: one re-buy OR one add-on", async () => {
    mockDesk({
      tournament: rebuys,
      registrations: [registrationDto("r1", "Ann", 1, { addons: 1 }), registrationDto("r2", "Bob", 1, { rebuys: 1 }), registrationDto("r3", "Cat", 1)],
    });
    const { user } = renderPhone();

    await quickAction(user, "Re-buy");
    const sheet = await screen.findByRole("dialog", { name: "Re-buy · $25" });
    expect(within(sheet).getByTestId("rebuy-pick-r1")).toBeDisabled();
    expect(within(sheet).getByTestId("rebuy-pick-r1")).toHaveTextContent("Took an add-on: not both");
    expect(within(sheet).getByTestId("rebuy-pick-r2")).toHaveTextContent("1 of 1 re-buy: limit reached");
    expect(within(sheet).getByTestId("rebuy-pick-r3")).toBeEnabled();
  });

  it("offers a player who is out a re-buy back in, and says they are back", async () => {
    const out = registrationDto("r3", "Cat", 1, { isEliminated: true, eliminationTime: "2026-10-23T08:00:00.000Z" });
    mockDesk({ tournament: { rebuyAmount: "25.00" }, registrations: [field[0], field[1], out] });
    server.use(http.post("/api/registrations/r3/counts", () => HttpResponse.json({ ...out, isEliminated: false, rebuys: 1, paymentConfirmed: true })));
    const { user } = renderPhone();

    await quickAction(user, "Re-buy");
    await user.click(await screen.findByTestId("rebuy-pick-r3"));
    const confirm = await screen.findByRole("dialog", { name: "Re-buy for Cat" });
    expect(confirm).toHaveTextContent("This re-buy puts them back in.");
    await user.click(within(confirm).getByTestId("confirm-top-up"));

    expect(await notifications().findByText("Cat is back in with the re-buy.")).toBeInTheDocument();
  });

  it("says where a player bought back in sits when the server could not give back their old seat (R5REV-HOST-04)", async () => {
    const out = registrationDto("r3", "Cat", 1, { isEliminated: true, eliminationTime: "2026-10-23T08:00:00.000Z" });
    mockDesk({ tournament: { rebuyAmount: "25.00" }, registrations: [field[0], field[1], out] });
    let back = false;
    server.use(
      http.post("/api/registrations/r3/counts", () => {
        back = true;
        return HttpResponse.json({ ...out, isEliminated: false, rebuys: 1, paymentConfirmed: true });
      }),
      // Her old seat was taken: auto-seat sat her at Table 2, Seat 4.
      http.get("/api/tournaments/t1/seating", () =>
        HttpResponse.json(
          seatingDto({ tables: [{ id: "tA", number: 1, seated: { 1: { id: "r1", name: "Ann" } } }, { id: "tB", number: 2, seated: { 2: { id: "r2", name: "Bob" }, ...(back ? { 4: { id: "r3", name: "Cat" } } : {}) } }] }),
        ),
      ),
      http.get("/api/tournaments/t1/activity", () =>
        HttpResponse.json([
          {
            id: "a9",
            tournamentId: "t1",
            playerId: "p-r3",
            eventType: "seat_assigned",
            eventData: JSON.stringify({ registrationId: "r3", from: null, to: { tableNumber: 2, seatNumber: 4 }, auto: true }),
            description: "Cat is back in, seated at Table 2, Seat 4",
            timestamp: "2026-10-23T08:30:00.000Z",
            player: null,
          },
        ]),
      ),
    );
    const { user } = renderPhone();

    await quickAction(user, "Re-buy");
    await user.click(await screen.findByTestId("rebuy-pick-r3"));
    await user.click(within(await screen.findByRole("dialog", { name: "Re-buy for Cat" })).getByTestId("confirm-top-up"));

    expect(await notifications().findByText("Cat is back in with the re-buy at a new seat: Table 2, Seat 4.")).toBeInTheDocument();
  });

  it("keeps the sheet open with the server's reason when the add-on is refused", async () => {
    mockDesk({ tournament: rebuys });
    server.use(http.post("/api/registrations/r1/counts", () => apiError(409, "PRIZE_POOL_LOCKED", "Prize pool is locked. No rebuys or addons allowed.")));
    const { user } = renderPhone();

    await quickAction(user, "Add-on");
    await user.click(await screen.findByTestId("addon-pick-r1"));
    await user.click(await screen.findByTestId("confirm-top-up"));

    expect(await screen.findByTestId("top-up-refusal")).toHaveTextContent("Prize pool is locked. No rebuys or addons allowed.");
    expect(screen.getByRole("dialog", { name: "Add-on for Ann" })).toBeInTheDocument();
  });

  it("says the pool is locked and offers nobody while it is", async () => {
    mockDesk({ tournament: { ...rebuys, prizePoolLocked: true } });
    const { user } = renderPhone();

    await quickAction(user, "Add-on");
    const sheet = await screen.findByRole("dialog", { name: "Add-on · $20" });
    expect(sheet).toHaveTextContent("Prize pool is locked. No rebuys or addons allowed.");
    for (const id of ["r1", "r2", "r3"]) expect(within(sheet).getByTestId(`addon-pick-${id}`)).toBeDisabled();
  });
});

describe("TournamentDetailsPage on a phone: the Money tab", () => {
  const staffPlayer = (id: string, name: string) => ({ id, name, email: null, phone: null, imageUrl: null, createdAt: null, canEdit: true }) as const;

  it("shows the pool, the AP and the payment desk, and says where a player sits once they have paid", async () => {
    mockDesk();
    const cat: PendingRegistrationDto = { ...field[2], paymentConfirmed: false, player: staffPlayer("p-r3", "Cat"), amountOwed: 100 };
    const ann: ConfirmedRegistrationDto = { ...field[0], paymentConfirmed: true, player: staffPlayer("p-r1", "Ann"), amountPaid: 200 };
    server.use(
      http.get("/api/tournaments/t1/pending-registrations", () => HttpResponse.json([cat])),
      http.get("/api/tournaments/t1/confirmed-registrations", () => HttpResponse.json([ann])),
      http.patch("/api/registrations/r3/confirm-payment", () =>
        HttpResponse.json({ ...field[2], paymentConfirmed: true, seating: { status: "seated", seat: seatRef("tb1", 1, 4) }, highHandUnawardedCents: 0 } satisfies PaymentConfirmedDto),
      ),
    );
    const { user } = renderPhone("/admin/tournaments/t1?tab=money");

    expect(await screen.findByTestId("prize-pool")).toHaveTextContent("$475");
    expect(await screen.findByText("AP (buy-ins $5 per entry)")).toBeInTheDocument();
    const confirm = await screen.findByTestId("confirm-payment-r3");
    await user.click(confirm);

    expect(await notifications().findByText("Cat has paid. Seated at Table 1, Seat 4.")).toBeInTheDocument();
  });

  it("takes a payment from the quick actions, saying how many wait to pay before they are seated (R5REV-HOST-09)", async () => {
    mockDesk({ registrations: [field[0], field[1], { ...field[2], paymentConfirmed: false }] });
    const cat: PendingRegistrationDto = { ...field[2], paymentConfirmed: false, player: staffPlayer("p-r3", "Cat"), amountOwed: 100 };
    // "Once they've paid": Cat signed up late and waits at the desk to pay before she is seated.
    mockSeating(seatingDto({ tables: [{ id: "tb1", number: 1, seated: { 1: { id: "r1", name: "Ann" }, 2: { id: "r2", name: "Bob" } } }], settings: { autoSeat: "once_paid" }, advisor: { notArrived: 1 } }));
    let pendingReads = 0;
    server.use(
      http.get("/api/tournaments/t1/pending-registrations", () => {
        pendingReads += 1;
        return HttpResponse.json([cat]);
      }),
      http.patch("/api/registrations/r3/confirm-payment", () =>
        HttpResponse.json({ ...field[2], paymentConfirmed: true, seating: { status: "seated", seat: seatRef("tb1", 1, 4) }, highHandUnawardedCents: 0 } satisfies PaymentConfirmedDto),
      ),
    );
    const { user } = renderPhone();

    await user.click(await screen.findByRole("button", { name: "Quick actions" }));
    const item = await screen.findByRole("menuitem", { name: /Take payment/ });
    await waitFor(() => expect(item).toHaveTextContent("Take payment1 waiting to pay"));
    // The list is asked for only once the sheet opens.
    expect(pendingReads).toBe(0);
    await user.click(item);

    const sheet = await screen.findByRole("dialog", { name: "Take payment" });
    await user.click(await within(sheet).findByTestId("confirm-payment-r3"));
    expect(await notifications().findByText("Cat has paid. Seated at Table 1, Seat 4.")).toBeInTheDocument();
  });
});

describe("TournamentDetailsPage on a phone: taking payments without leaving the desk (R6REV1-PHONE-02)", () => {
  const staffPlayer = (id: string, name: string) => ({ id, name, email: null, phone: null, imageUrl: null, createdAt: null, canEdit: true }) as const;
  const unpaidCat = { ...field[2], paymentConfirmed: false };

  it("opens the Take payment sheet from the Money tab's note, and keeps the tab bar and the quick actions", async () => {
    mockDesk({ registrations: [field[0], field[1], unpaidCat] });
    const cat: PendingRegistrationDto = { ...unpaidCat, player: staffPlayer("p-r3", "Cat"), amountOwed: 100 };
    server.use(http.get("/api/tournaments/t1/pending-registrations", () => HttpResponse.json([cat])));
    const { user, location } = renderPhone("/admin/tournaments/t1?tab=money");

    const note = await screen.findByTestId("paid-players-note");
    expect(note).toHaveTextContent("Prize pool from 2 paid players · 1 not paid yet (not in the pool)");
    expect(within(note).queryByRole("link")).not.toBeInTheDocument();
    await user.click(within(note).getByRole("button", { name: "Take payments" }));

    const sheet = await screen.findByRole("dialog", { name: "Take payment" });
    expect(await within(sheet).findByTestId("confirm-payment-r3")).toBeInTheDocument();
    expect(location()).toBe("/admin/tournaments/t1?tab=money");
  });

  it("counts everyone in the field who has not paid beside Take payment, whatever the seating mode", async () => {
    mockDesk({ registrations: [field[0], field[1], unpaidCat] });
    mockSeating(seatingDto({ tables: [], settings: { autoSeat: "off" } }));
    const { user } = renderPhone();

    await user.click(await screen.findByRole("button", { name: "Quick actions" }));
    const item = await screen.findByRole("menuitem", { name: /Take payment/ });
    expect(item).toHaveTextContent("Take payment1 waiting to pay");
  });
});

describe("TournamentDetailsPage on a phone: the waiting list (round 5, item 15)", () => {
  const staffPlayer = (id: string, name: string) => ({ id, name, email: null, phone: null, imageUrl: null, createdAt: null, canEdit: true }) as const;
  /** Three accepted (paid) players fill a field of three; Eve, then Dee, signed up after it filled. */
  const paid = (registration: PublicRegistration): ManagedRegistration => ({ ...registration, waitingListPosition: null, paymentConfirmed: true });
  const waitingOn = (registration: PublicRegistration, waitingListPosition: number): ManagedRegistration => ({ ...registration, waitingListPosition, paymentConfirmed: false });
  const dee = waitingOn(registrationDto("r4", "Dee", 1, { registrationTime: "2026-10-23T06:40:00.000Z" }), 2);
  const eve = waitingOn(registrationDto("r5", "Eve", 1, { registrationTime: "2026-10-23T06:30:00.000Z" }), 1);
  const fullField = [...field.map(paid), dee, eve];
  const FULL = "3 of 3 players accepted: raise Max players to accept more";
  const pendingOf = (registration: ManagedRegistration): PendingRegistrationDto => ({ ...registration, player: staffPlayer(`p-${registration.id}`, playerName(registration)), amountOwed: 100 });

  it("counts the field apart from the waiting list, and numbers the list under the standings, next in first", async () => {
    mockDesk({ tournament: { maxPlayers: 3 }, registrations: fullField });
    renderPhone();

    expect(await screen.findByTestId("field-summary")).toHaveTextContent("3 players · 3 still in · max 3 · 2 on the waiting list");
    const standings = await screen.findByRole("list", { name: "Standings" });
    expect(within(standings).getAllByRole("listitem").map((card) => card.getAttribute("data-testid"))).toEqual(["player-row-r1", "player-row-r2", "player-row-r3"]);
    const list = within(screen.getByTestId("waiting-list"));
    expect(list.getByRole("heading", { name: "Waiting list" })).toBeInTheDocument();
    expect(list.getAllByRole("listitem").map((row) => row.getAttribute("data-testid"))).toEqual(["waiting-r5", "waiting-r4"]);
    expect(list.getByTestId("waiting-r5")).toHaveTextContent("#1");
    // No override past Max players: the card says what makes room.
    expect(list.getByTestId("waiting-list-full")).toHaveTextContent(`${FULL}.`);
    expect(list.queryByRole("button", { name: /Eliminate/ })).not.toBeInTheDocument();
    for (const button of list.getAllByRole("button", { name: /^Remove .*'s entry$/ })) expect(button).toHaveClass("h-11", "w-11");
  });

  it("takes a sign-up off the waiting list with the standings' own confirm", async () => {
    let registrations: PublicRegistration[] = fullField;
    mockDesk({ tournament: { maxPlayers: 3 }, registrations });
    server.use(
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
      http.delete("/api/registrations/r4", () => {
        registrations = [...field.map(paid), eve];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderPhone();

    await user.click(await screen.findByRole("button", { name: "Remove Dee's entry" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Remove this entry?" })).getByRole("button", { name: "Remove entry" }));

    expect(await notifications().findByText("Entry removed")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("waiting-r4")).not.toBeInTheDocument());
    expect(screen.getByTestId("field-summary")).toHaveTextContent("3 players · 3 still in · max 3 · 1 on the waiting list");
  });

  it("leaves the waiting list out of the bust sheet: they are not playing", async () => {
    mockDesk({ tournament: { maxPlayers: 3 }, registrations: fullField });
    const { user } = renderPhone();

    await quickAction(user, "Bust a player");
    const picker = within(within(await screen.findByRole("dialog", { name: "Bust a player" })).getByTestId("bust-pick"));
    expect(picker.getByTestId("bust-pick-r1")).toBeInTheDocument();
    expect(picker.queryByTestId("bust-pick-r4")).not.toBeInTheDocument();
    expect(picker.queryByTestId("bust-pick-r5")).not.toBeInTheDocument();
  });

  it("numbers the waiting list in Take payment, says the field is full, and shows the refusal of an accept at max", async () => {
    mockDesk({ tournament: { maxPlayers: 3 }, registrations: fullField });
    server.use(
      http.get("/api/tournaments/t1/pending-registrations", () => HttpResponse.json([pendingOf(dee), pendingOf(eve)])),
      http.patch("/api/registrations/r5/confirm-payment", () => apiError(409, "TOURNAMENT_FULL", FULL)),
    );
    const { user } = renderPhone();

    await quickAction(user, "Take payment");
    const sheet = within(await screen.findByRole("dialog", { name: "Take payment" }));
    expect(await sheet.findByText("Everyone in the field has paid.")).toBeInTheDocument();
    const waiting = within(sheet.getByTestId("payment-waiting-list"));
    expect(waiting.getByRole("heading", { name: "Waiting list · 2" })).toBeInTheDocument();
    expect(waiting.getByTestId("payment-waiting-full")).toHaveTextContent(`${FULL}.`);
    expect(within(waiting.getByRole("list", { name: "Waiting list" })).getAllByRole("listitem").map((row) => row.getAttribute("data-testid"))).toEqual([
      "registration-r5",
      "registration-r4",
    ]);
    // Their amounts wait with them: nothing is pending in the field.
    expect(sheet.queryByText("Total Pending")).not.toBeInTheDocument();

    await user.click(waiting.getByRole("button", { name: "Confirm payment for Eve" }));
    expect(await notifications().findByText("Tournament full")).toBeInTheDocument();
    expect(notifications().getByText(FULL)).toBeInTheDocument();
  });

  it("says a player signed up at the desk past a full field is on the waiting list, not waiting for a seat", async () => {
    mockDesk({ tournament: { maxPlayers: 3 }, registrations: field.map(paid) });
    server.use(
      http.get("/api/public/tournaments/t1/players", () => HttpResponse.json([{ id: "p-dee", name: "Dee Visitor", imageUrl: null }])),
      http.post("/api/tournaments/t1/registrations", () =>
        HttpResponse.json(
          { ...registrationDto("r9", "Dee Visitor"), waitingListPosition: 1, paymentConfirmed: false, seating: { status: "waiting", reason: "awaiting_payment" } } satisfies RegistrationCreatedDto,
          { status: 201 },
        ),
      ),
    );
    const { user } = renderPhone();

    await quickAction(user, "Register player");
    await user.type(await screen.findByRole("searchbox", { name: "Player" }), "Dee");
    await user.click(await screen.findByTestId("player-option-p-dee"));
    await user.click(screen.getByTestId("register-player-final"));

    expect(await notifications().findByText("Dee Visitor is #1 on the waiting list: the field is full.")).toBeInTheDocument();
    expect(notifications().queryByText(/Seated once/)).not.toBeInTheDocument();
  });
});

describe("TournamentDetailsPage on a phone: the clock keeps ticking in the header", () => {
  it("counts down a running clock between polls", async () => {
    mockDesk();
    serveDisplay({ clock: runningClock(Date.now(), { remainingMs: 5 * 60_000 }) });
    renderPhone();

    const clock = await screen.findByTestId("mobile-clock");
    expect(clock).toHaveTextContent(/Clock, running:L1(5:00|4:59)200\/400/);
    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    expect(clock).toHaveTextContent(/4:5\d/);
  });
});
