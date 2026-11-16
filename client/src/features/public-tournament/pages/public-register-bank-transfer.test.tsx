/**
 * The QR sign-up's confirmation in a tournament that shows its club's bank details (round 8, item 3),
 * on a phone (390 × 844): how to pay the buy-in ahead by transfer, each detail with Copy, the high hand
 * paid at the door, and "don't pay yet" for the waiting list. The details come only in the sign-up's
 * own answer (paymentInstructions), never in what the page reads before, and stay in the tab for when
 * the player comes back from their banking app (R8REV1-PHONE-02).
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import type { NothingToTransferDto, PaymentInstructionsDto } from "@shared/api/registrations";
import type { AutoSeatResultDto } from "@shared/api/seating";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { clubDto, mockTournamentPages, registrationDto, tournamentDto } from "@test/helpers/f2-public";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import PublicRegisterPage from "./public-register";

const NO_TABLES: AutoSeatResultDto = { status: "waiting", reason: "no_tables" };
const tama = { id: "p1", name: "Tama Rangi", imageUrl: null };

const INSTRUCTIONS: PaymentInstructionsDto = {
  accountName: "Central Stars Poker Club",
  accountNumber: "12-3456-7890123-00",
  bankName: "ANZ",
  instructions: "Pay by 5 pm on the day",
  amountDueCents: 5000,
  particulars: "Wed 18 Nov",
  reference: "Tama Rangi",
  highHandAtDoorCents: 0,
  waitingList: false,
};

function mockTournament(overrides: Partial<TournamentDetailDto> = {}, signedUp = 0) {
  mockTournamentPages(
    tournamentDto({ status: "registration", buyInAmount: "50.00", maxPlayers: 40, showBankTransfer: true, ...overrides }),
    Array.from({ length: signedUp }, (_, i) => registrationDto(`r${i}`, `P${i}`)),
    clubDto(),
  );
  server.use(http.get("/api/public/tournaments/t1/players", () => HttpResponse.json([tama])));
}

/** The sign-up's answer; returns what was sent, and how many sign-ups were sent. */
function mockSignUp(answer: Record<string, unknown>): { body: () => unknown; count: () => number } {
  let body: unknown;
  let count = 0;
  server.use(
    http.post("/api/tournaments/t1/registrations", async ({ request }) => {
      body = await request.json();
      count++;
      return HttpResponse.json({ id: "r1", playerId: tama.id, player: tama, seating: NO_TABLES, ...answer }, { status: 201 });
    }),
  );
  return { body: () => body, count: () => count };
}

const openPage = () => renderWithApp(<PublicRegisterPage />, { path: "/register/t1", route: "/register/:tournamentId" });

/** Tama finds himself, ticks the high hand or not, and signs up. */
async function signUpTama({ highHand = false }: { highHand?: boolean } = {}) {
  const user = userEvent.setup();
  openPage();
  await user.click(await screen.findByTestId("player-type-existing"));
  await user.click(screen.getByTestId("step1-next"));
  await user.type(screen.getByTestId("player-search"), "Tama");
  await user.click(await screen.findByRole("button", { name: "Tama Rangi" }));
  await user.click(screen.getByTestId("step2-next"));
  if (highHand) await user.click(screen.getByText("Yes, I'm in!"));
  await user.click(screen.getByTestId("complete-registration"));
  return user;
}

const card = () => screen.findByRole("region", { name: "Pay by bank transfer" });

beforeEach(() => {
  screenWidth(390);
  mockSignedOut();
  sessionStorage.clear();
});

describe("PublicRegisterPage: pay by bank transfer (round 8)", () => {
  it("tells the player how to pay the buy-in by transfer, or at the door", async () => {
    mockTournament();
    const sent = mockSignUp({ paymentInstructions: INSTRUCTIONS });
    await signUpTama();

    const transfer = await card();
    expect(screen.getByText("Registration Complete!")).toBeInTheDocument();
    expect(within(transfer).getByTestId("bank-transfer-amount")).toHaveTextContent("$50.00");
    expect(within(transfer).getByTestId("bank-transfer-account-name")).toHaveTextContent("Central Stars Poker Club");
    expect(within(transfer).getByTestId("bank-transfer-account-number")).toHaveTextContent("12-3456-7890123-00");
    expect(within(transfer).getByTestId("bank-transfer-bank")).toHaveTextContent("ANZ");
    expect(within(transfer).getByTestId("bank-transfer-particulars")).toHaveTextContent("Wed 18 Nov");
    expect(within(transfer).getByTestId("bank-transfer-reference")).toHaveTextContent("Tama Rangi");
    expect(within(transfer).getByTestId("bank-transfer-instructions")).toHaveTextContent("Pay by 5 pm on the day");
    expect(transfer).toHaveTextContent("Or pay at the door.");
    expect(transfer).toHaveTextContent("The TD will confirm your payment.");
    expect(within(transfer).queryByTestId("bank-transfer-high-hand")).not.toBeInTheDocument();
    // One way to pay is said once: no second "proceed to the payment desk" total beside it.
    expect(screen.queryByTestId("amount-due")).not.toBeInTheDocument();
    expect(await screen.findByText("Pay by bank transfer, or at the door.")).toBeInTheDocument();
    // The public sign-up sends what it always has: nothing about paying.
    expect(sent.body()).toEqual({ playerId: "p1", enteringHighHands: false });
  });

  it("copies the account number, the particulars and the reference with a tap", async () => {
    mockTournament();
    mockSignUp({ paymentInstructions: INSTRUCTIONS });
    const user = await signUpTama();
    const transfer = await card();

    for (const [what, value] of [
      ["account number", "12-3456-7890123-00"],
      ["particulars", "Wed 18 Nov"],
      ["reference", "Tama Rangi"],
    ] as const) {
      const copy = within(transfer).getByRole("button", { name: `Copy ${what}` });
      await user.click(copy);
      expect(await navigator.clipboard.readText()).toBe(value);
      expect(copy).toHaveTextContent("Copied");
    }
  });

  it("says so when the phone would not copy, with the detail to copy by hand", async () => {
    mockTournament();
    mockSignUp({ paymentInstructions: INSTRUCTIONS });
    const user = await signUpTama();
    const transfer = await card();
    // The clipboard refuses, and jsdom has no select-and-copy (execCommand) to fall back on.
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));

    const copy = within(transfer).getByRole("button", { name: "Copy account number" });
    await user.click(copy);

    expect(await screen.findByText("Couldn't copy the account number")).toBeInTheDocument();
    expect(screen.getByText("Select it and copy it yourself: 12-3456-7890123-00")).toBeInTheDocument();
    expect(copy).not.toHaveTextContent("Copied");
  });

  it("asks for the buy-in only by transfer, and the high hand at the door", async () => {
    mockTournament({ enableHighHand: true, highHandAmount: "10.00" });
    mockSignUp({ enteringHighHands: true, paymentInstructions: { ...INSTRUCTIONS, highHandAtDoorCents: 1000 } });
    await signUpTama({ highHand: true });

    const transfer = await card();
    expect(within(transfer).getByTestId("bank-transfer-amount")).toHaveTextContent("$50.00");
    expect(within(transfer).getByTestId("bank-transfer-high-hand")).toHaveTextContent("High hand ($10.00) — pay at the door");
  });

  it("tells a waiting-list sign-up not to pay yet, and shows no bank details", async () => {
    mockTournament({ maxPlayers: 3 }, 3);
    const nothingYet: NothingToTransferDto = { amountDueCents: 5000, highHandAtDoorCents: 0, waitingList: true };
    mockSignUp({ waitingListPosition: 2, seating: { status: "waiting", reason: "awaiting_payment" }, paymentInstructions: nothingYet });
    await signUpTama();

    expect(await screen.findByTestId("dont-pay-yet")).toHaveTextContent(
      "You're on the waiting list (#2) — don't pay yet; the club will tell you if a spot opens.",
    );
    expect(screen.getByTestId("waiting-list-place")).toHaveTextContent("#2");
    expect(screen.queryByRole("region", { name: "Pay by bank transfer" })).not.toBeInTheDocument();
    expect(screen.queryByText("12-3456-7890123-00")).not.toBeInTheDocument();
    expect(screen.queryByTestId("amount-due")).not.toBeInTheDocument();
    expect(await screen.findByText("You're on the waiting list: don't pay yet.")).toBeInTheDocument();
  });

  it("asks nothing by transfer when there is no buy-in to pay", async () => {
    mockTournament({ buyInAmount: "0.00" });
    mockSignUp({ paymentInstructions: { amountDueCents: 0, highHandAtDoorCents: 0, waitingList: false } satisfies NothingToTransferDto });
    await signUpTama();

    expect(await screen.findByTestId("amount-due")).toHaveTextContent("$0.00");
    expect(screen.queryByRole("region", { name: "Pay by bank transfer" })).not.toBeInTheDocument();
    expect(screen.queryByText("12-3456-7890123-00")).not.toBeInTheDocument();
  });

  it("keeps the desk's total for a tournament that shows no bank details", async () => {
    mockTournament({ showBankTransfer: false });
    mockSignUp({});
    await signUpTama();

    expect(await screen.findByTestId("amount-due")).toHaveTextContent("$50.00");
    expect(screen.getByText("Please proceed to the payment desk")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pay by bank transfer" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Please proceed to payment confirmation.")).toBeInTheDocument());
  });
});

describe("PublicRegisterPage: back from the banking app (R8REV1-PHONE-02)", () => {
  const KEY = "pokerpal.signUp.t1";
  /** Tama's entry, as the tournament's public list shows it once he has signed up. */
  const listed = () => server.use(http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([registrationDto("r1", "Tama Rangi", { playerId: tama.id })])));
  /** The phone unloaded the page while the banking app was open: it starts again from the address. */
  const reload = () => {
    cleanup();
    openPage();
  };

  it("shows the transfer details again when the page comes back, without signing up again, until Register Another Player", async () => {
    mockTournament({ enableHighHand: true, highHandAmount: "10.00" });
    const signUps = mockSignUp({ enteringHighHands: true, paymentInstructions: { ...INSTRUCTIONS, highHandAtDoorCents: 1000 } });
    await signUpTama({ highHand: true });
    await card();
    listed();

    reload();
    const transfer = await card();
    expect(screen.getByText("Registration Complete!")).toBeInTheDocument();
    expect(screen.getByTestId("registered-player")).toHaveTextContent("Tama Rangi");
    expect(within(transfer).getByTestId("bank-transfer-amount")).toHaveTextContent("$50.00");
    expect(within(transfer).getByTestId("bank-transfer-account-number")).toHaveTextContent("12-3456-7890123-00");
    expect(within(transfer).getByTestId("bank-transfer-particulars")).toHaveTextContent("Wed 18 Nov");
    expect(within(transfer).getByTestId("bank-transfer-reference")).toHaveTextContent("Tama Rangi");
    expect(within(transfer).getByTestId("bank-transfer-high-hand")).toHaveTextContent("High hand ($10.00) — pay at the door");
    expect(signUps.count()).toBe(1);

    // The next player on this phone starts afresh, and so does the page after them.
    await userEvent.setup().click(screen.getByTestId("register-another"));
    expect(await screen.findByTestId("player-type-existing")).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    reload();
    expect(await screen.findByTestId("player-type-existing")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pay by bank transfer" })).not.toBeInTheDocument();
  });

  it("forgets a sign-up the club has since taken off the tournament", async () => {
    mockTournament();
    mockSignUp({ paymentInstructions: INSTRUCTIONS });
    await signUpTama();
    await card();

    reload();
    expect(await screen.findByTestId("player-type-existing")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pay by bank transfer" })).not.toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull());
  });

  it("does not show it again once the tournament is over", async () => {
    mockTournament();
    mockSignUp({ paymentInstructions: INSTRUCTIONS });
    await signUpTama();
    await card();
    listed();
    mockTournament({ status: "completed" });
    listed();

    reload();
    expect(await screen.findByTestId("registration-closed")).toBeInTheDocument();
    expect(screen.queryByText("12-3456-7890123-00")).not.toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull());
  });

  it("keeps nothing to come back for when there is no transfer to make: the waiting list, or the desk", async () => {
    mockTournament({ maxPlayers: 3 }, 3);
    mockSignUp({ waitingListPosition: 1, seating: { status: "waiting", reason: "awaiting_payment" }, paymentInstructions: { amountDueCents: 5000, highHandAtDoorCents: 0, waitingList: true } });
    await signUpTama();
    expect(await screen.findByTestId("dont-pay-yet")).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    mockTournament({ showBankTransfer: false });
    mockSignUp({});
    cleanup();
    await signUpTama();
    expect(await screen.findByTestId("amount-due")).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("still shows the details when the phone will not keep them, as long as the page stays open", async () => {
    mockTournament();
    mockSignUp({ paymentInstructions: INSTRUCTIONS });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    await signUpTama();

    expect(within(await card()).getByTestId("bank-transfer-account-number")).toHaveTextContent("12-3456-7890123-00");
    vi.mocked(Storage.prototype.setItem).mockRestore();
  });

  it("ignores what an older page, or anything else, left under the key", async () => {
    mockTournament();
    listed();
    sessionStorage.setItem(KEY, JSON.stringify({ player: tama, registration: { id: "r1", seating: NO_TABLES, paymentInstructions: INSTRUCTIONS }, enteringHighHands: false }));

    openPage();
    expect(await screen.findByTestId("player-type-existing")).toBeInTheDocument();
    sessionStorage.setItem(KEY, "{not json");
    reload();
    expect(await screen.findByTestId("player-type-existing")).toBeInTheDocument();
  });
});
