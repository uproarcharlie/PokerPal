/**
 * The Fix menu on an entry already confirmed as paid (round 9, item 1; the owner: "I need to be able to
 * edit players who are confirmed as paid just in case of a mistake"), on the TD's phone (390 × 844):
 * from the payment desk's paid list and from a player's row in the standings, mark them as not paid
 * (asked first, saying what the prize pool loses), change how they paid, tick or untick the high hand,
 * or edit their details; what the game's rules do not allow now is greyed out, saying why.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { freeEntryStatus, recordBodies, registrationDto, screenWidth, tournamentDto } from "@test/helpers/f1-tournaments";
import { mockSeating, seatingDto } from "@test/helpers/seating-dto";
import type { StaffPlayer } from "@shared/api/players";
import type { ConfirmedRegistrationDto, ManagedRegistration, PaymentConfirmedDto, PendingRegistrationDto } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { PaymentDeskCards } from "../payment-desk/payment-desk-cards";
import { StandingsTable } from "../standings/standings-table";

const contact = (id: string, name: string, canEdit = true) =>
  canEdit
    ? ({ id: `p-${id}`, name, email: null, phone: `021 555 01${id.slice(1)}0`, imageUrl: null, createdAt: null, canEdit: true } as const)
    : ({ id: `p-${id}`, name, email: null, phone: null, imageUrl: null, createdAt: null, canEdit: false } as const);

/** Ann and Bea have two buy-ins each, Tama one: all three paid in cash. Cat has not paid yet. */
const paid = (id: string, name: string, buyIns: number, overrides: Partial<ConfirmedRegistrationDto> = {}): ConfirmedRegistrationDto => ({
  ...registrationDto(id, name, buyIns),
  ...freeEntryStatus(),
  paymentConfirmed: true,
  paidBy: "cash",
  waitingListPosition: null,
  player: contact(id, name),
  amountPaid: buyIns * 100,
  ...overrides,
});
const ann = paid("r1", "Ann", 2);
const bea = paid("r2", "Bea", 2);
const tama = paid("r3", "Tama", 1);
const cat: PendingRegistrationDto = {
  ...registrationDto("r4", "Cat"),
  ...freeEntryStatus(),
  paymentConfirmed: false,
  paidBy: null,
  waitingListPosition: null,
  player: contact("r4", "Cat"),
  amountOwed: 100,
};

/** The desk's two lists, and every write the Fix menu makes, with its body. */
function mockDesk({ confirmed = [ann, bea, tama], pending = [cat] }: { confirmed?: ConfirmedRegistrationDto[]; pending?: PendingRegistrationDto[] } = {}) {
  const updates = recordBodies();
  const confirms = recordBodies();
  const players = recordBodies();
  server.use(
    http.get("/api/tournaments/t1/pending-registrations", () => HttpResponse.json(pending)),
    http.get("/api/tournaments/t1/confirmed-registrations", () => HttpResponse.json(confirmed)),
    http.put("/api/registrations/:id", async ({ request, params }) => {
      const body = (await updates.record(request)) as Partial<ManagedRegistration>;
      const row = confirmed.find((entry) => entry.id === params.id) ?? tama;
      return HttpResponse.json({ ...row, ...body, ...(body.paymentConfirmed === false ? { paidBy: null } : {}) });
    }),
    http.patch("/api/registrations/:id/confirm-payment", async ({ request, params }) => {
      const body = (await confirms.record(request)) as { paidBy: "cash" | "transfer" };
      const row = confirmed.find((entry) => entry.id === params.id) ?? tama;
      return HttpResponse.json({ ...row, paidBy: body.paidBy, seating: null, highHandUnawardedCents: 0 } satisfies PaymentConfirmedDto);
    }),
    http.put("/api/players/:id", async ({ request, params }) => {
      const body = (await players.record(request)) as Partial<StaffPlayer>;
      return HttpResponse.json({ id: String(params.id), name: "Tama", email: null, phone: null, imageUrl: null, createdAt: null, ...body });
    }),
  );
  return { updates: updates.bodies, confirms: confirms.bodies, players: players.bodies };
}

/** The $100 game with $5 AP per entry: the desk at 390 px. */
function renderDesk(overrides: Partial<TournamentDetailDto> = {}) {
  const user = userEvent.setup();
  renderWithApp(<PaymentDeskCards tournament={tournamentDto(overrides)} timeZone="Pacific/Auckland" rakeLabel="AP" />);
  return user;
}

/** Opens the Fix menu on a row (its button's test id is `standings-fix-<id>` in the standings). */
async function openFix(user: ReturnType<typeof userEvent.setup>, id: string, prefix = "fix-entry") {
  await user.click(await screen.findByTestId(`${prefix}-${id}`));
  return screen.findByRole("menu");
}

beforeEach(() => {
  screenWidth(390);
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("the Fix menu on the payment desk's paid list, 390 px (round 9)", () => {
  it("is on every paid row, named with the player, a thumb's height", async () => {
    mockDesk();
    renderDesk();

    const fix = await screen.findByRole("button", { name: "Fix Tama's entry" });
    expect(fix).toHaveClass("h-11");
    for (const id of ["r1", "r2", "r3"]) expect(screen.getByTestId(`fix-entry-${id}`)).toBeInTheDocument();
    // Not on a sign-up still to pay: Confirm is its action.
    expect(screen.queryByTestId("fix-entry-r4")).not.toBeInTheDocument();
  });

  it("marks a paid player as not paid after saying what the prize pool loses, and says they are back on the list to pay", async () => {
    const { updates } = mockDesk();
    const user = renderDesk();

    const menu = await openFix(user, "r3");
    await user.click(within(menu).getByRole("menuitem", { name: "Mark as not paid…" }));

    const question = await screen.findByRole("alertdialog", { name: "Mark Tama as not paid?" });
    // Paid now: 5 buy-ins less $25 AP, $475, which 3 places pay as $474. Without Tama: $380 for 2 places, $304.
    expect(question).toHaveTextContent("Tama goes back to Not paid yet; the prize pool drops by $170. They keep their seat.");
    await user.click(within(question).getByRole("button", { name: "Mark as not paid" }));

    await waitFor(() => expect(updates).toEqual([{ paymentConfirmed: false }]));
    expect(await screen.findByText("Tama is back on the list to pay.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps the question open with the server's reason when it refuses", async () => {
    mockDesk();
    server.use(
      http.put("/api/registrations/r3", () =>
        apiError(409, "HIGH_HAND_OVER_POOL", "The high-hand awards already made ($20) would be more than the $10 pot: take an award back first"),
      ),
    );
    const user = renderDesk();

    await user.click(within(await openFix(user, "r3")).getByRole("menuitem", { name: "Mark as not paid…" }));
    const question = await screen.findByRole("alertdialog", { name: "Mark Tama as not paid?" });
    await user.click(within(question).getByRole("button", { name: "Mark as not paid" }));

    expect(await within(question).findByText(/would be more than the \$10 pot/)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Mark Tama as not paid?" })).toBeInTheDocument();
  });

  it("says a prize pool set by hand stays as it is, and what the high-hand pot loses", async () => {
    mockDesk({ confirmed: [ann, bea, { ...tama, enteringHighHands: true }] });
    const user = renderDesk({ manualPrizePool: "500.00", enableHighHand: true, highHandAmount: "20.00" });

    await user.click(within(await openFix(user, "r3")).getByRole("menuitem", { name: "Mark as not paid…" }));

    expect(await screen.findByRole("alertdialog", { name: "Mark Tama as not paid?" })).toHaveTextContent(
      "Tama goes back to Not paid yet. The prize pool stays at $500: it is set by hand. The high-hand pot drops by $20. They keep their seat.",
    );
  });

  it("changes how a paid player paid, cash to bank transfer, and says so", async () => {
    const { confirms } = mockDesk();
    const user = renderDesk();

    const menu = await openFix(user, "r3");
    expect(within(menu).getByRole("menuitemradio", { name: "Cash" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(menu).getByRole("menuitemradio", { name: "Bank transfer" }));

    await waitFor(() => expect(confirms).toEqual([{ paidBy: "transfer" }]));
    expect(await screen.findByText("Tama paid by bank transfer.")).toBeInTheDocument();
  });

  it("ticks the high hand for a paid player where the game has one, and greys it out once the pool is locked", async () => {
    const { updates } = mockDesk();
    const user = renderDesk({ enableHighHand: true, highHandAmount: "20.00" });

    const menu = await openFix(user, "r3");
    const highHand = within(menu).getByRole("menuitemcheckbox", { name: "High hand entered" });
    expect(highHand).toHaveAttribute("aria-checked", "false");
    await user.click(highHand);

    await waitFor(() => expect(updates).toEqual([{ enteringHighHands: true }]));
    expect(await screen.findByText("Tama is now in the high hand.")).toBeInTheDocument();
  });

  it("greys out joining the high hand once the pool is locked, and taking a payment back once the game is over, saying why", async () => {
    mockDesk({ confirmed: [ann, bea, { ...tama, player: contact("r3", "Tama", false) }] });
    const user = renderDesk({ enableHighHand: true, highHandAmount: "20.00", prizePoolLocked: true, status: "completed" });

    const menu = await openFix(user, "r3");

    const notPaid = within(menu).getByTestId("fix-not-paid-r3");
    expect(notPaid).toHaveAttribute("aria-disabled", "true");
    expect(notPaid).toHaveTextContent("The game is over: its payments stay as they are");
    const highHand = within(menu).getByTestId("fix-high-hand-r3");
    expect(highHand).toHaveAttribute("aria-disabled", "true");
    expect(highHand).toHaveTextContent("The prize pool is locked: nobody joins the high hand now");
    const edit = within(menu).getByTestId("fix-edit-player-r3");
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(edit).toHaveTextContent("Visiting from another club");
    // How they paid is the club's bookkeeping: still open after the game.
    expect(within(menu).getByRole("menuitemradio", { name: "Bank transfer" })).not.toHaveAttribute("aria-disabled");
  });

  it("edits a paid player's details in the staff's sheet, naming the tournament", async () => {
    const { players } = mockDesk();
    const user = renderDesk();

    await user.click(within(await openFix(user, "r3")).getByRole("menuitem", { name: "Edit player details…" }));

    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    expect(within(sheet).getByLabelText(/Mobile/)).toHaveValue("021 555 0130");
    await user.clear(within(sheet).getByLabelText(/Player Name/));
    await user.type(within(sheet).getByLabelText(/Player Name/), "Tama Rangi");
    await user.click(within(sheet).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(players).toEqual([expect.objectContaining({ name: "Tama Rangi", phone: "021 555 0130", tournamentId: "t1" })]));
    expect(await screen.findByText("Tama Rangi's details are saved.")).toBeInTheDocument();
  });

  it("says Not accepted in a game with no buy-in, where nobody paid and nobody chooses how", async () => {
    mockDesk({ confirmed: [{ ...tama, paidBy: null, amountPaid: 0 }] });
    const user = renderDesk({ buyInAmount: "0.00", rakeType: "none", rakeAmount: "0.00" });

    const menu = await openFix(user, "r3");
    expect(within(menu).queryByRole("menuitemradio")).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Mark as not accepted…" }));

    expect(await screen.findByRole("alertdialog", { name: "Mark Tama as not accepted?" })).toHaveTextContent(
      "Tama goes back to Not accepted yet; the prize pool does not change. They keep their seat.",
    );
  });
});

describe("the Fix menu on a player's row in the standings, 390 px (round 9)", () => {
  /** A desk row as the staff's registrations carry it: its payment status, the player's public fields. */
  const managed = ({ player, ...row }: ConfirmedRegistrationDto | PendingRegistrationDto): ManagedRegistration => ({
    ...row,
    player: player && { id: player.id, name: player.name, imageUrl: player.imageUrl },
  });

  function renderStandings(overrides: Partial<TournamentDetailDto> = {}) {
    mockSeating(seatingDto({ tournamentId: "t1" }));
    const user = userEvent.setup();
    renderWithApp(<StandingsTable tournament={tournamentDto(overrides)} registrations={[ann, bea, tama, cat].map(managed)} />);
    return user;
  }

  it("takes a payment back from the standings, with the same question", async () => {
    const { updates } = mockDesk();
    const user = renderStandings();

    await user.click(within(await openFix(user, "r3", "standings-fix")).getByRole("menuitem", { name: "Mark as not paid…" }));
    const question = await screen.findByRole("alertdialog", { name: "Mark Tama as not paid?" });
    expect(question).toHaveTextContent("the prize pool drops by $170");
    await user.click(within(question).getByRole("button", { name: "Mark as not paid" }));

    await waitFor(() => expect(updates).toEqual([{ paymentConfirmed: false }]));
    // The player is still in the field, with their row and its controls.
    expect(screen.getByTestId("player-row-r3")).toBeInTheDocument();
  });

  it("offers no payment fixes for a player who has not paid, and still their details", async () => {
    mockDesk();
    const user = renderStandings();

    const menu = await openFix(user, "r4", "standings-fix");

    expect(within(menu).queryByRole("menuitem", { name: "Mark as not paid…" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemradio")).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Edit player details…" })).toBeInTheDocument();
  });

  it("reads the player's contact details from the desk before the sheet opens with them, never blank", async () => {
    const { players } = mockDesk();
    const user = renderStandings();

    await user.click(within(await openFix(user, "r3", "standings-fix")).getByRole("menuitem", { name: "Edit player details…" }));

    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    expect(await within(sheet).findByLabelText(/Mobile/)).toHaveValue("021 555 0130");
    await user.click(within(sheet).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(players).toEqual([expect.objectContaining({ phone: "021 555 0130", tournamentId: "t1" })]));
  });

  it("has no Fix menu once the game is closed: the payment desk keeps its own", async () => {
    mockDesk();
    renderStandings({ status: "completed" });
    expect(await screen.findByTestId("player-row-r3")).toBeInTheDocument();
    expect(screen.queryByTestId("standings-fix-r3")).not.toBeInTheDocument();
  });
});
