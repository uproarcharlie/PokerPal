import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, freeEntryStatus, phoneLayout, registrationDto, screenWidth, tournamentDto } from "@test/helpers/f1-tournaments";
import type { ConfirmedRegistrationDto, FreeEntryChangedDto, PendingRegistrationDto } from "@shared/api/registrations";
import AdminRegistrationsPage from "./admin-registrations";

const staffPlayer = (id: string, name: string, phone: string | null) =>
  ({ id, name, email: null, phone, imageUrl: null, createdAt: null, canEdit: true }) as const;

/** A normal entry: no free entry (round 7). */
const NOT_FREE = freeEntryStatus();

const ann: PendingRegistrationDto = {
  ...registrationDto("r1", "Ann", 2, { rebuys: 1, addons: 1 }),
  ...NOT_FREE,
  paymentConfirmed: false,
  player: staffPlayer("p-r1", "Ann", "021 555 0101"),
  amountOwed: 175,
};
const visitor: PendingRegistrationDto = {
  ...registrationDto("r2", "Vic", 1, { enteringHighHands: true }),
  ...NOT_FREE,
  paymentConfirmed: false,
  player: { id: "p-r2", name: "Vic", email: null, phone: null, imageUrl: null, createdAt: null, canEdit: false },
  amountOwed: 60.5,
};
const bob: ConfirmedRegistrationDto = {
  ...registrationDto("r3", "Bob", 1),
  ...NOT_FREE,
  paymentConfirmed: true,
  player: staffPlayer("p-r3", "Bob", null),
  amountPaid: 50,
};

function mockDesk({ canManage = true, pending = [ann, visitor], confirmed = [bob], maxPlayers = 20, buyInAmount = "100.00" } = {}) {
  const lists: string[] = [];
  server.use(
    http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ maxPlayers, buyInAmount, viewer: { canManage, canOwn: canManage } }))),
    http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())),
    http.get("/api/tournaments/t1/pending-registrations", () => {
      lists.push("pending");
      return HttpResponse.json(pending);
    }),
    http.get("/api/tournaments/t1/confirmed-registrations", () => {
      lists.push("confirmed");
      return HttpResponse.json(confirmed);
    }),
  );
  return lists;
}

function renderDesk() {
  return renderWithApp(<AdminRegistrationsPage />, { path: "/admin/registrations/t1", route: "/admin/registrations/:tournamentId" });
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("AdminRegistrationsPage", () => {
  it("shows what each sign-up owes and each paid player paid, as the server works them out", async () => {
    mockDesk();
    renderDesk();

    const waiting = await screen.findByRole("table", { name: "Registrations waiting for payment" });
    const annRow = within(waiting).getByTestId("registration-r1");
    expect(annRow).toHaveTextContent("021 555 0101");
    expect(annRow).toHaveTextContent("$175.00");
    expect(annRow).toHaveTextContent("7:30 pm");
    // Another club's player keeps their phone number.
    expect(within(waiting).getByTestId("registration-r2")).toHaveTextContent("Other club");
    expect(screen.getByText("Total Pending").parentElement).toHaveTextContent("$235.50");

    const paid = screen.getByRole("table", { name: "Players who have paid" });
    expect(within(paid).getByTestId("confirmed-registration-r3")).toHaveTextContent("$50.00");
    expect(screen.getByText("Total Collected").parentElement).toHaveTextContent("$50.00");
    // Counted in words, as every count is (P3REV6-CQ-10): never "1 player(s)".
    expect(screen.getByText("2 players")).toBeInTheDocument();
    expect(screen.getByText("1 player")).toBeInTheDocument();
    expect(screen.queryByText(/player\(s\)/)).not.toBeInTheDocument();
    // The desk's two card headings are one style, the card title's own (P3REV6-CQ-09).
    const pendingTitle = screen.getByRole("heading", { name: "Pending Payment Confirmations" });
    expect(pendingTitle.className).toBe(screen.getByRole("heading", { name: "Confirmed Players" }).className);
    expect(screen.getByTestId("view-qr-code")).toHaveAttribute("href", "/qr/t1");
    expect(screen.getByRole("link", { name: "Tournament" })).toHaveAttribute("href", "/admin/tournaments/t1");
  });

  it("tells each confirmation's own outcome when the next row is confirmed before the first answer came (P3REV0-PARITY-03)", async () => {
    mockDesk();
    let answerAnn: () => void = () => {};
    const annAnswered = new Promise<void>((resolve) => {
      answerAnn = resolve;
    });
    server.use(
      http.patch("/api/registrations/r1/confirm-payment", async () => {
        await annAnswered;
        return apiError(409, "CONFLICT", "Ann's payment was already confirmed on another device");
      }),
      http.patch("/api/registrations/r2/confirm-payment", () => HttpResponse.json({ ...visitor, paymentConfirmed: true, seating: null })),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));
    await user.click(screen.getByTestId("confirm-payment-r2"));
    expect(await screen.findByText("Registration payment has been confirmed.")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-payment-r1")).toHaveAttribute("aria-disabled", "true");

    answerAnn();
    expect(await screen.findByText("Ann's payment was already confirmed on another device")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-payment-r1")).not.toHaveAttribute("aria-disabled");
  });

  it("confirms a payment, then shows the lists as the server has them", async () => {
    let confirmedIds: string[] = [];
    mockDesk();
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", ({ params }) => {
        confirmedIds = [...confirmedIds, String(params.id)];
        return HttpResponse.json({ ...ann, paymentConfirmed: true, seating: null });
      }),
      http.get("/api/tournaments/t1/pending-registrations", () => HttpResponse.json(confirmedIds.includes("r1") ? [visitor] : [ann, visitor])),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    expect(await screen.findByText("Payment Confirmed")).toBeInTheDocument();
    expect(confirmedIds).toEqual(["r1"]);
    await waitFor(() => expect(screen.queryByTestId("registration-r1")).not.toBeInTheDocument());
  });

  it("says where automatic seating put a player once their payment is confirmed (round 5, once they've paid)", async () => {
    mockDesk();
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", () =>
        HttpResponse.json({
          ...ann,
          paymentConfirmed: true,
          seating: { status: "seated", seat: { tableId: "tb1", tableNumber: 1, tableName: "Table 1", seatNumber: 4 } },
        }),
      ),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    expect(await screen.findByText(/has paid\. Seated at Table 1, Seat 4\./)).toBeInTheDocument();
  });

  it("says when the payment grew a high-hand pot whose every prize is already awarded (R6REV0-MONEY-01)", async () => {
    mockDesk();
    server.use(http.patch("/api/registrations/:id/confirm-payment", () => HttpResponse.json({ ...ann, paymentConfirmed: true, seating: null, highHandUnawardedCents: 500 })));
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    expect(
      await screen.findByText("Registration payment has been confirmed. $5 of the high-hand pot is not awarded yet: add it to a winner's prize from Award High Hand."),
    ).toBeInTheDocument();
  });

  it("frees the desk as soon as the server confirms, without waiting for the lists to refresh (P3REV4-PERF-02)", async () => {
    mockDesk();
    let refreshing = false;
    let hold: () => void = () => undefined;
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", () => {
        refreshing = true;
        return HttpResponse.json({ ...ann, paymentConfirmed: true, seating: null });
      }),
      // The refresh after it hangs on the venue's Wi-Fi.
      http.get("/api/tournaments/t1/pending-registrations", async () => {
        if (refreshing) await new Promise<void>((resolve) => (hold = resolve));
        return HttpResponse.json(refreshing ? [visitor] : [ann, visitor]);
      }),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    expect(await screen.findByText("Payment Confirmed")).toBeInTheDocument();
    expect(screen.queryByTestId("registration-r1")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-payment-r2")).not.toHaveAttribute("aria-disabled");
    hold();
  });

  it("waits only on the payment being confirmed: every other row can still be confirmed", async () => {
    mockDesk();
    let answer: () => void = () => undefined;
    server.use(
      http.patch("/api/registrations/:id/confirm-payment", async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return HttpResponse.json({ ...ann, paymentConfirmed: true, seating: null });
      }),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    await waitFor(() => expect(screen.getByTestId("confirm-payment-r1")).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByTestId("confirm-payment-r2")).not.toHaveAttribute("aria-disabled");
    answer();
    expect(await screen.findByText("Payment Confirmed")).toBeInTheDocument();
  });

  it("shows the server's sentence when a payment cannot be confirmed", async () => {
    mockDesk();
    server.use(http.patch("/api/registrations/:id/confirm-payment", () => apiError(403, "FORBIDDEN", "Only this club's staff can do that")));
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByTestId("confirm-payment-r1"));

    expect(await screen.findByText("Only this club's staff can do that")).toBeInTheDocument();
  });

  it("shows each registration once on a phone, so its test id and Confirm button are not doubled", async () => {
    phoneLayout();
    mockDesk();
    renderDesk();

    expect(await screen.findAllByTestId("registration-r1")).toHaveLength(1);
    expect(screen.getAllByTestId("confirm-payment-r1")).toHaveLength(1);
    expect(screen.getAllByTestId("confirmed-registration-r3")).toHaveLength(1);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says when nobody is waiting or has paid yet", async () => {
    mockDesk({ pending: [], confirmed: [] });
    renderDesk();

    expect(await screen.findByText("No pending registrations")).toBeInTheDocument();
    expect(screen.getByText("No confirmed players yet")).toBeInTheDocument();
    expect(screen.queryByText("Total Pending")).not.toBeInTheDocument();
  });

  it("tells someone who does not run the club so, without asking for the staff lists", async () => {
    const lists = mockDesk({ canManage: false });
    renderDesk();

    expect(await screen.findByRole("heading", { name: "Access Denied" })).toBeInTheDocument();
    expect(lists).toEqual([]);
  });

  it("says when the tournament does not exist", async () => {
    server.use(http.get("/api/tournaments/t1", () => apiError(404, "NOT_FOUND", "Tournament not found")));
    renderDesk();

    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
  });

  it("frames its loading, error and not-found states in the page's own inset, as every staff page does (P3REV5-CQ-04)", async () => {
    server.use(http.get("/api/tournaments/t1", () => apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now")));
    renderDesk();

    const alert = await screen.findByRole("alert");
    expect(alert.parentElement).toHaveClass("px-4", "py-6");
  });

  it("says only LiveStatus's word on how current it is, as the request desk does: no 'updates automatically' line beside it (P3REV5-CQ-17)", async () => {
    mockDesk();
    renderDesk();

    await screen.findByRole("table", { name: "Registrations waiting for payment" });
    expect(screen.queryByText(/updates automatically/)).not.toBeInTheDocument();
  });
});

describe("AdminRegistrationsPage: the waiting list (round 5, item 15)", () => {
  /** Vic signed up once the field of two was full: the server numbers him on the waiting list. */
  const waitingVic: PendingRegistrationDto = { ...visitor, waitingListPosition: 1 };
  const FULL = "1 of 1 players accepted: raise Max players to accept more";

  it("numbers the waiting list apart from the field's payments, and leaves its amounts out of the total", async () => {
    // Ann has not played yet (no re-buys), so she is not accepted until she pays: one of two accepted.
    mockDesk({ maxPlayers: 2, pending: [{ ...ann, rebuys: 0, addons: 0, amountOwed: 100, waitingListPosition: null }, waitingVic] });
    renderDesk();

    const field = await screen.findByRole("table", { name: "Registrations waiting for payment" });
    expect(within(field).getByTestId("registration-r1")).toBeInTheDocument();
    expect(within(field).queryByTestId("registration-r2")).not.toBeInTheDocument();
    expect(screen.getByText("Total Pending").parentElement).toHaveTextContent("$100.00");
    const waiting = within(screen.getByTestId("payment-waiting-list"));
    expect(waiting.getByRole("heading", { name: "Waiting list · 1" })).toBeInTheDocument();
    expect(within(waiting.getByRole("table", { name: "Waiting list" })).getByTestId("registration-r2")).toHaveTextContent("#1");
    // There is room, so nothing says the field is full.
    expect(screen.queryByTestId("payment-waiting-full")).not.toBeInTheDocument();
  });

  it("says first that Max players are accepted, and shows the server's refusal of an accept at max: no override", async () => {
    mockDesk({ maxPlayers: 1, pending: [waitingVic], confirmed: [bob] });
    let asked = 0;
    server.use(
      http.patch("/api/registrations/r2/confirm-payment", () => {
        asked += 1;
        return apiError(409, "TOURNAMENT_FULL", FULL);
      }),
    );
    const user = userEvent.setup();
    renderDesk();

    expect(await screen.findByTestId("payment-waiting-full")).toHaveTextContent(`${FULL}.`);
    expect(screen.getByText("Everyone in the field has paid.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm payment for Vic" }));

    expect(await screen.findByText("Tournament full")).toBeInTheDocument();
    expect(screen.getByText(FULL)).toBeInTheDocument();
    expect(asked).toBe(1);
    expect(screen.getByTestId("confirm-payment-r2")).not.toHaveAttribute("aria-disabled");
  });

  it("shows the waiting list as numbered cards on a phone (390 px)", async () => {
    screenWidth(390);
    mockDesk({ maxPlayers: 1, pending: [waitingVic], confirmed: [bob] });
    renderDesk();

    const card = within(await screen.findByRole("list", { name: "Waiting list" })).getByTestId("registration-r2");
    expect(within(card).getByRole("heading", { level: 4 })).toHaveTextContent("#1");
    expect(within(card).getByRole("button", { name: "Confirm payment for Vic" })).toHaveClass("h-11");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("AdminRegistrationsPage: the early-bird bonus", () => {
  it("gives a paid player the bonus from the desk, and shows it at once from the answer", async () => {
    mockDesk();
    const sent: unknown[] = [];
    server.use(
      http.post("/api/tournaments/t1/early-birds", async ({ request }) => {
        sent.push(await request.json());
        // The desk's refresh never answers: what shows is the answer's own.
        server.use(http.get("/api/tournaments/t1/confirmed-registrations", () => delay("infinite")));
        return HttpResponse.json({ changed: ["r3"], earlyBirds: 1 });
      }),
    );
    const user = userEvent.setup();
    renderDesk();

    const toggle = await screen.findByRole("switch", { name: "Early-bird bonus for Bob" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(sent).toEqual([{ registrationIds: ["r3"], earlyBird: true }]);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Early-bird bonus for Bob" })).toBeChecked());
  });

  it("takes it back from a player still to pay, and says so when the server refuses", async () => {
    mockDesk({ pending: [{ ...ann, earlyBird: true }, visitor] });
    server.use(http.post("/api/tournaments/t1/early-birds", () => apiError(409, "TOURNAMENT_CLOSED", "This tournament is over")));
    const user = userEvent.setup();
    renderDesk();

    const toggle = await screen.findByRole("switch", { name: "Early-bird bonus for Ann" });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(await screen.findByText("Could not change the early-bird bonus")).toBeInTheDocument();
    expect(screen.getByText("This tournament is over")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Early-bird bonus for Ann" })).toBeChecked();
  });
});

describe("AdminRegistrationsPage: free entries (round 7, item 6)", () => {
  /** Bob came in free: his Winter League prize, the club paying his buy-in into the pool. */
  const freeBob: ConfirmedRegistrationDto = {
    ...bob,
    freeEntry: true,
    freeEntryFunded: true,
    freeEntryReason: "season_prize",
    freeEntryNote: "Winter League",
    amountPaid: 0,
  };
  /** The server's answer to a free-entry change: the registration as it now stands. */
  const answer = (registration: PendingRegistrationDto | ConfirmedRegistrationDto, overrides: Partial<FreeEntryChangedDto> = {}): FreeEntryChangedDto => {
    const { amountOwed: _owed, amountPaid: _paid, player: _player, ...row } = { amountOwed: 0, amountPaid: 0, ...registration };
    return { ...registrationDto(row.id, "Ann"), ...NOT_FREE, paymentConfirmed: true, seating: null, highHandUnawardedCents: 0, ...overrides };
  };

  function recordFreeEntries(reply: (id: string, body: unknown) => Response) {
    const sent: { id: string; body: unknown }[] = [];
    server.use(
      http.post("/api/registrations/:id/free-entry", async ({ params, request }) => {
        const body = await request.json();
        sent.push({ id: String(params.id), body });
        return reply(String(params.id), body);
      }),
    );
    return sent;
  }

  it("gives a sign-up a free entry: a reason must be chosen, the note and the club's funding go with it", async () => {
    mockDesk();
    const sent = recordFreeEntries(() =>
      HttpResponse.json(
        answer(ann, {
          freeEntry: true,
          freeEntryFunded: true,
          freeEntryReason: "season_prize",
          freeEntryNote: "Winter League",
          seating: { status: "seated", seat: { tableId: "tb1", tableNumber: 1, tableName: "Table 1", seatNumber: 4 } },
        }),
      ),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByRole("button", { name: "Free entry for Ann" }));
    const sheet = await screen.findByRole("dialog", { name: "Free entry for Ann" });
    // Not funded by default: the buy-in adds nothing to the pool.
    expect(within(sheet).getByText("Off: their $100 buy-in adds nothing to the prize pool.")).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Give free entry" }));
    expect(await within(sheet).findByText("Choose why they get a free entry")).toBeInTheDocument();
    expect(sent).toEqual([]);

    const reasons = within(sheet).getByRole("group", { name: /Why is it free\?/ });
    await user.click(within(reasons).getByRole("button", { name: "Season prize" }));
    expect(within(reasons).getByRole("button", { name: "Season prize" })).toHaveAttribute("aria-pressed", "true");
    await user.type(within(sheet).getByRole("textbox", { name: "Note (optional)" }), "Winter League");
    await user.click(within(sheet).getByRole("switch", { name: "Club pays their buy-in into the pool" }));
    expect(within(sheet).getByText("Adds $100 to the prize pool, with no AP taken from it.")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Give free entry" }));

    await waitFor(() => expect(sent).toEqual([{ id: "r1", body: { action: "give", reason: "season_prize", note: "Winter League", funded: true } }]));
    expect(await screen.findByText("Free entry given")).toBeInTheDocument();
    expect(screen.getByText("Ann is in with a free entry. Seated at Table 1, Seat 4.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Free entry for Ann" })).not.toBeInTheDocument());
  });

  it("sends no note when none is typed, and no funding unless it is switched on", async () => {
    mockDesk();
    const sent = recordFreeEntries(() => HttpResponse.json(answer(ann, { freeEntry: true, freeEntryReason: "promo" })));
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByRole("button", { name: "Free entry for Ann" }));
    const sheet = await screen.findByRole("dialog", { name: "Free entry for Ann" });
    await user.click(within(sheet).getByRole("button", { name: "Promo" }));
    await user.click(within(sheet).getByRole("button", { name: "Give free entry" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ id: "r1", body: { action: "give", reason: "promo", note: null, funded: false } });
  });

  it("says the tournament is full when a free entry would pass Max players, and keeps the sheet open", async () => {
    const FULL = "20 of 20 players accepted: raise Max players to accept more";
    mockDesk();
    recordFreeEntries(() => apiError(409, "TOURNAMENT_FULL", FULL));
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByRole("button", { name: "Free entry for Ann" }));
    const sheet = await screen.findByRole("dialog", { name: "Free entry for Ann" });
    await user.click(within(sheet).getByRole("button", { name: "Staff" }));
    await user.click(within(sheet).getByRole("button", { name: "Give free entry" }));

    expect(await screen.findByText("Tournament full")).toBeInTheDocument();
    expect(screen.getByText(FULL)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Free entry for Ann" })).toBeInTheDocument();
  });

  it("marks a free entry FREE among the confirmed, says why, and counts it under the total", async () => {
    mockDesk({ confirmed: [freeBob] });
    renderDesk();

    const paid = await screen.findByRole("table", { name: "Players who have paid" });
    const row = within(paid).getByTestId("confirmed-registration-r3");
    const badge = within(row).getByTestId("free-entry-badge");
    expect(badge).toHaveTextContent("Free entry: Season prize: Winter League · club pays the buy-in");
    expect(within(row).queryByText("Confirmed")).not.toBeInTheDocument();
    expect(screen.getByText("confirmed · 1 free entry")).toBeInTheDocument();
  });

  it("takes a free entry back, or marks it paid, each telling its own outcome", async () => {
    mockDesk({ confirmed: [freeBob] });
    const sent = recordFreeEntries((_id, body) =>
      (body as { action: string }).action === "mark_paid"
        ? apiError(409, "NOT_FREE_ENTRY", "Bob does not have a free entry")
        : HttpResponse.json(answer(freeBob, { paymentConfirmed: false })),
    );
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByRole("button", { name: "Mark Bob paid" }));
    expect(await screen.findByText("Could not mark the payment")).toBeInTheDocument();
    expect(screen.getByText("Bob does not have a free entry")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo Bob's free entry" }));
    expect(await screen.findByText("Free entry taken back")).toBeInTheDocument();
    expect(screen.getByText("Bob is a normal entry again and has not paid yet.")).toBeInTheDocument();
    expect(sent).toEqual([
      { id: "r3", body: { action: "mark_paid" } },
      { id: "r3", body: { action: "take_back" } },
    ]);
  });

  it("offers no free entry in a game with no buy-in, which accepts its players instead (round 7, item 8)", async () => {
    mockDesk({ buyInAmount: "0.00" });
    renderDesk();

    expect(await screen.findByRole("heading", { name: "Free tournament — accept players" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Accept Ann" })).toHaveTextContent("Accept");
    expect(screen.queryByRole("button", { name: "Free entry for Ann" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accepted Players" })).toBeInTheDocument();
    expect(within(screen.getByTestId("confirmed-registration-r3")).getByText("Accepted")).toBeInTheDocument();
  });

  it("says a player is accepted, not that they paid, in a game with no buy-in (round 7, item 8)", async () => {
    mockDesk({ buyInAmount: "0.00" });
    server.use(http.patch("/api/registrations/r1/confirm-payment", () => HttpResponse.json({ ...ann, paymentConfirmed: true, seating: null })));
    const user = userEvent.setup();
    renderDesk();

    await user.click(await screen.findByRole("button", { name: "Accept Ann" }));

    expect(await screen.findByText("Player accepted")).toBeInTheDocument();
    expect(screen.getByText("Ann is in.")).toBeInTheDocument();
    expect(screen.queryByText("Payment Confirmed")).not.toBeInTheDocument();
  });
});
