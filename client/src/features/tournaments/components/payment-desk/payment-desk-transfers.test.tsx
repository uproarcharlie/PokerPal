/**
 * The payment desk in a tournament that shows bank transfer details after sign-up (round 8, item 4),
 * on the TD's phone (390 px): each unpaid sign-up's transfer Reference (their name, cut to 12
 * characters), a box to find a name or reference off the bank statement, and Cash or Transfer to
 * confirm the payment with, recorded for the club's books and shown on the paid list. The transfer
 * pays the buy-in only: what is left for the door (the high hand) is shown apart, and collected before
 * a transfer confirms the entry.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { freeEntryStatus, registrationDto, screenWidth, tournamentDto } from "@test/helpers/f1-tournaments";
import type { ConfirmedRegistrationDto, PaymentConfirmedDto, PendingRegistrationDto } from "@shared/api/registrations";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { PaymentDeskCards } from "./payment-desk-cards";

const staffPlayer = (id: string, name: string) => ({ id, name, email: null, phone: null, imageUrl: null, createdAt: null, canEdit: true }) as const;

function pending(id: string, name: string, overrides: Partial<PendingRegistrationDto> = {}): PendingRegistrationDto {
  return { ...registrationDto(id, name), ...freeEntryStatus(), paymentConfirmed: false, paidBy: null, player: staffPlayer(`p-${id}`, name), amountOwed: 100, ...overrides };
}

function confirmed(id: string, name: string, paidBy: ConfirmedRegistrationDto["paidBy"], overrides: Partial<ConfirmedRegistrationDto> = {}): ConfirmedRegistrationDto {
  return { ...registrationDto(id, name), ...freeEntryStatus(), paymentConfirmed: true, paidBy, player: staffPlayer(`p-${id}`, name), amountPaid: 100, ...overrides };
}

const alexandra = pending("r1", "Alexandra Fitzgerald");
const tama = pending("r2", "Tama Rangi");
const waitingAri = pending("r3", "Ari Waiting", { waitingListPosition: 1 });

/** The desk's two lists, and every confirm with the body it sent ("" for none). */
function mockDesk({ pendingRows = [alexandra, tama, waitingAri], confirmedRows = [] as ConfirmedRegistrationDto[] } = {}) {
  const confirms: Array<{ id: string; body: string }> = [];
  let rows = pendingRows;
  server.use(
    http.get("/api/tournaments/t1/pending-registrations", () => HttpResponse.json(rows)),
    http.get("/api/tournaments/t1/confirmed-registrations", () => HttpResponse.json(confirmedRows)),
    http.patch("/api/registrations/:id/confirm-payment", async ({ params, request }) => {
      const id = String(params.id);
      confirms.push({ id, body: await request.text() });
      const row = rows.find((candidate) => candidate.id === id) as PendingRegistrationDto;
      rows = rows.filter((candidate) => candidate.id !== id);
      const answer: PaymentConfirmedDto = { ...row, paymentConfirmed: true, seating: null, highHandUnawardedCents: 0 };
      return HttpResponse.json(answer);
    }),
  );
  return confirms;
}

function renderDesk(overrides: Partial<TournamentDetailDto> = {}) {
  const user = userEvent.setup();
  renderWithApp(<PaymentDeskCards tournament={tournamentDto({ showBankTransfer: true, ...overrides })} timeZone="Pacific/Auckland" rakeLabel="AP" />);
  return user;
}

const pendingList = () => screen.findByRole("list", { name: "Registrations waiting for payment" });

beforeEach(() => {
  screenWidth(390);
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("the payment desk with bank transfers (round 8)", () => {
  it("shows each unpaid sign-up's transfer Reference, as the player was told to write it", async () => {
    mockDesk();
    renderDesk();

    const list = await pendingList();
    expect(within(within(list).getByTestId("registration-r1")).getByTestId("transfer-reference-r1")).toHaveTextContent("Alexandra Fi");
    expect(within(list).getByTestId("transfer-reference-r2")).toHaveTextContent("Tama Rangi");
    expect(within(list).getByTestId("registration-r2")).toHaveTextContent("Transfer ref");
    // The waiting list was told not to pay yet: no reference to look for.
    expect(within(screen.getByTestId("payment-waiting-list")).getByTestId("registration-r3")).toBeInTheDocument();
    expect(screen.queryByTestId("transfer-reference-r3")).not.toBeInTheDocument();
  });

  it("finds a name or reference from the bank statement, whatever its case and spacing", async () => {
    mockDesk();
    const user = renderDesk();
    const list = await pendingList();

    await user.type(screen.getByRole("searchbox", { name: "Find a transfer" }), "ALEXANDRA  FI");
    expect(within(list).getByTestId("registration-r1")).toBeInTheDocument();
    expect(within(list).queryByTestId("registration-r2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-waiting-list")).not.toBeInTheDocument();
    // The total is still the whole field's.
    expect(screen.getByText("Total Pending").parentElement).toHaveTextContent("$200.00");

    await user.clear(screen.getByRole("searchbox", { name: "Find a transfer" }));
    await user.type(screen.getByRole("searchbox", { name: "Find a transfer" }), "Nobody Here");
    expect(screen.getByTestId("transfer-search-none")).toHaveTextContent("Nobody waiting to pay matches “Nobody Here”.");
  });

  it("confirms a payment as a bank transfer, and says so", async () => {
    const confirms = mockDesk();
    const user = renderDesk();
    const list = await pendingList();

    await user.click(within(list).getByRole("button", { name: "Confirm bank transfer for Alexandra Fitzgerald" }));

    await waitFor(() => expect(confirms).toEqual([{ id: "r1", body: JSON.stringify({ paidBy: "transfer" }) }]));
    expect(await screen.findByText("Alexandra Fitzgerald has paid by bank transfer.")).toBeInTheDocument();
    await waitFor(() => expect(within(list).queryByTestId("registration-r1")).not.toBeInTheDocument());
  });

  it("confirms a payment as cash", async () => {
    const confirms = mockDesk();
    const user = renderDesk();
    const list = await pendingList();

    expect(within(list).getByTestId("confirm-payment-r2")).toHaveAccessibleName("Confirm cash payment for Tama Rangi");
    await user.click(within(list).getByTestId("confirm-payment-r2"));

    await waitFor(() => expect(confirms).toEqual([{ id: "r2", body: JSON.stringify({ paidBy: "cash" }) }]));
    expect(await screen.findByText("Tama Rangi has paid in cash.")).toBeInTheDocument();
  });

  it("shows on the paid list how each payment was made, when it was recorded", async () => {
    mockDesk({ pendingRows: [], confirmedRows: [confirmed("r4", "Bea Transfer", "transfer"), confirmed("r5", "Cal Cash", "cash"), confirmed("r6", "Dee Before", null)] });
    renderDesk();

    const paid = await screen.findByRole("list", { name: "Players who have paid" });
    expect(within(paid).getByTestId("paid-by-r4")).toHaveTextContent("Bank transfer");
    expect(within(paid).getByTestId("paid-by-r5")).toHaveTextContent("Cash");
    expect(within(paid).queryByTestId("paid-by-r6")).not.toBeInTheDocument();
    expect(within(paid).getByTestId("confirmed-registration-r6")).toHaveTextContent("Confirmed");
  });

  it("stays as it was for a tournament that shows no bank details: one Confirm, sending nothing about how", async () => {
    const confirms = mockDesk();
    const user = renderDesk({ showBankTransfer: false });
    const list = await pendingList();

    expect(screen.queryByRole("searchbox", { name: "Find a transfer" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("transfer-reference-r1")).not.toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /bank transfer/ })).not.toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Confirm payment for Tama Rangi" }));

    await waitFor(() => expect(confirms).toEqual([{ id: "r2", body: "" }]));
  });

  describe("with the high hand paid at the door (R8REV1-PHONE-01)", () => {
    // $50 buy-in, $5 high hand: Alexandra ticked it (owes $55), Tama did not (owes $50).
    const HIGH_HAND = { buyInAmount: "50.00", enableHighHand: true, highHandAmount: "5.00" } as const;
    const withHighHand = () => [pending("r1", "Alexandra Fitzgerald", { enteringHighHands: true, amountOwed: 55 }), pending("r2", "Tama Rangi", { amountOwed: 50 })];

    it("splits what a high-hand entrant owes into the transfer (the buy-in) and the door (the high hand)", async () => {
      mockDesk({ pendingRows: withHighHand() });
      renderDesk(HIGH_HAND);
      const list = await pendingList();

      const alexandraRow = within(list).getByTestId("registration-r1");
      expect(alexandraRow).toHaveTextContent("$55.00");
      expect(within(alexandraRow).getByTestId("transfer-part-r1")).toHaveTextContent("Transfer $50.00 (buy-in)");
      expect(within(alexandraRow).getByTestId("door-part-r1")).toHaveTextContent("At the door $5.00 (high hand)");
      // Nothing at the door for Tama: his amount is his transfer.
      expect(within(list).getByTestId("registration-r2")).toHaveTextContent("$50.00");
      expect(within(list).queryByTestId("door-part-r2")).not.toBeInTheDocument();
    });

    it("asks the TD to collect the high hand at the door before a transfer confirms it, and Not yet leaves the entry to pay", async () => {
      const confirms = mockDesk({ pendingRows: withHighHand() });
      const user = renderDesk(HIGH_HAND);
      const list = await pendingList();

      await user.click(within(list).getByRole("button", { name: "Confirm bank transfer for Alexandra Fitzgerald" }));
      const ask = await screen.findByRole("alertdialog", { name: "Collect $5.00 at the door" });
      expect(ask).toHaveTextContent("Alexandra Fitzgerald's bank transfer pays the buy-in, $50.00. The high hand is paid at the door: confirm once you have it.");
      await user.click(within(ask).getByRole("button", { name: "Not yet" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(confirms).toEqual([]);
      expect(within(list).getByTestId("registration-r1")).toBeInTheDocument();

      await user.click(within(list).getByRole("button", { name: "Confirm bank transfer for Alexandra Fitzgerald" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Collected: confirm" }));
      await waitFor(() => expect(confirms).toEqual([{ id: "r1", body: JSON.stringify({ paidBy: "transfer" }) }]));
      expect(await screen.findByText("Alexandra Fitzgerald has paid by bank transfer.")).toBeInTheDocument();
    });

    it("confirms at once a transfer that pays everything owed, and cash, which is all taken at the desk", async () => {
      const confirms = mockDesk({ pendingRows: withHighHand() });
      const user = renderDesk(HIGH_HAND);
      const list = await pendingList();

      await user.click(within(list).getByRole("button", { name: "Confirm bank transfer for Tama Rangi" }));
      await user.click(within(list).getByRole("button", { name: "Confirm cash payment for Alexandra Fitzgerald" }));

      await waitFor(() =>
        expect(confirms).toEqual([
          { id: "r2", body: JSON.stringify({ paidBy: "transfer" }) },
          { id: "r1", body: JSON.stringify({ paidBy: "cash" }) },
        ]),
      );
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("shows on the paid list what a transfer paid and what the door collected", async () => {
      mockDesk({
        pendingRows: [],
        confirmedRows: [
          confirmed("r4", "Bea Transfer", "transfer", { enteringHighHands: true, amountPaid: 55 }),
          confirmed("r5", "Cal Cash", "cash", { enteringHighHands: true, amountPaid: 55 }),
        ],
      });
      renderDesk(HIGH_HAND);

      const paid = await screen.findByRole("list", { name: "Players who have paid" });
      expect(within(paid).getByTestId("transfer-part-r4")).toHaveTextContent("Transfer $50.00 (buy-in)");
      expect(within(paid).getByTestId("door-part-r4")).toHaveTextContent("At the door $5.00 (high hand)");
      expect(within(paid).getByTestId("paid-by-r4")).toHaveTextContent("Bank transfer");
      // Cash was all taken at the desk: one amount.
      expect(within(paid).getByTestId("confirmed-registration-r5")).toHaveTextContent("$55.00");
      expect(within(paid).queryByTestId("door-part-r5")).not.toBeInTheDocument();
    });
  });

  it("accepts players in a game with no buy-in, without asking how they paid", async () => {
    mockDesk();
    renderDesk({ buyInAmount: "0.00" });
    const list = await pendingList();

    expect(within(list).getByRole("button", { name: "Accept Tama Rangi" })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /bank transfer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Find a transfer" })).not.toBeInTheDocument();
  });
});
