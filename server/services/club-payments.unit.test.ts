import { describe, expect, it } from "vitest";
import { normaliseNzBankAccount } from "@shared/api/clubs";
import { BANK_TRANSFER_FIELD_MAX, paymentParticulars, paymentReference } from "@shared/api/registrations";
import type { Club, Tournament, TournamentRegistration } from "@shared/schema";
import { bankDetailsOf, paymentInstructionsFor, type SignUpForPayment } from "./club-payments";

const club = (overrides: Partial<Club> = {}) =>
  ({
    id: "c1",
    timezone: "Pacific/Auckland",
    bankAccountName: "Central Stars",
    bankAccountNumber: "12-3456-7890123-00",
    bankName: null,
    bankInstructions: null,
    ...overrides,
  }) as Club;

const tournament = (overrides: Partial<Tournament> = {}) =>
  ({
    id: "t1",
    name: "Wed Night",
    startDateTime: new Date("2026-11-18T06:30:00Z"),
    buyInAmount: "100.00",
    rebuyAmount: "50.00",
    addonAmount: "25.00",
    enableHighHand: true,
    highHandAmount: "10.00",
    showBankTransfer: true,
    ...overrides,
  }) as Tournament;

const registration = (overrides: Partial<TournamentRegistration> = {}) =>
  ({ id: "r1", buyIns: 1, rebuys: 0, addons: 0, enteringHighHands: false, freeEntry: false, ...overrides }) as TournamentRegistration;

const signUp = (overrides: Partial<SignUpForPayment> = {}): SignUpForPayment => ({
  tournament: tournament(),
  club: club(),
  registration: registration(),
  player: { name: "Tama Rangi" },
  waitingList: false,
  ...overrides,
});

describe("normaliseNzBankAccount", () => {
  it.each([
    ["12-3456-7890123-00", "12-3456-7890123-00"],
    ["12-3456-7890123-001", "12-3456-7890123-001"],
    ["  12 3456 7890123 00 ", "12-3456-7890123-00"],
    ["123456789012300", "12-3456-7890123-00"],
    ["1234567890123001", "12-3456-7890123-001"],
  ])("writes %j as the banks do", (typed, expected) => {
    expect(normaliseNzBankAccount(typed)).toBe(expected);
  });

  it.each(["", "12-3456-789012-00", "12345678901230", "12345678901230012", "1-23456-7890123-00", "12-3456-7890123-0", "12-3456-789O123-00", `12-3456-7890123-00${" ".repeat(40)}x`])(
    "refuses %j",
    (typed) => {
      expect(normaliseNzBankAccount(typed)).toBeNull();
    },
  );
});

describe("paymentReference and paymentParticulars", () => {
  it("cut a name to the 12 characters a transfer takes, spacing tidied, whole characters only", () => {
    expect(paymentReference("Tama Rangi")).toBe("Tama Rangi");
    expect(paymentReference("  Alexandra   Fitzgerald ")).toBe("Alexandra Fi");
    expect(paymentReference("Mereana Te Aho")).toBe("Mereana Te A");
    expect(paymentReference("Hēmi 🂡🂡🂡🂡🂡🂡🂡🂡")).toBe("Hēmi 🂡🂡🂡🂡🂡🂡🂡");
    expect(paymentReference("Ana Maria Lopez")).toHaveLength(BANK_TRANSFER_FIELD_MAX);
    // A cut that ends on a space drops it.
    expect(paymentReference("Wiremu Tane Smith")).toBe("Wiremu Tane");
  });

  it("suggest the tournament's name when it fits, else its day in the club's zone", () => {
    const start = new Date("2026-11-18T06:30:00Z");

    expect(paymentParticulars({ name: "Main Event", startDateTime: start }, "Pacific/Auckland")).toBe("Main Event");
    expect(paymentParticulars({ name: "Central Stars One Life Line", startDateTime: start }, "Pacific/Auckland")).toBe("Wed 18 Nov");
    // The same moment is Tuesday evening in Hawaii.
    expect(paymentParticulars({ name: "Central Stars One Life Line", startDateTime: start }, "Pacific/Honolulu")).toBe("Tue 17 Nov");
    expect(paymentParticulars({ name: "   ", startDateTime: start }, "Pacific/Auckland")).toBe("Wed 18 Nov");
  });
});

describe("bankDetailsOf", () => {
  it("needs both the name and the number, and reads blanks as none", () => {
    expect(bankDetailsOf(club({ bankName: " ASB ", bankInstructions: "" }))).toEqual({
      accountName: "Central Stars",
      accountNumber: "12-3456-7890123-00",
      bankName: "ASB",
      instructions: null,
    });
    expect(bankDetailsOf(club({ bankAccountName: "  " }))).toBeNull();
    expect(bankDetailsOf(club({ bankAccountNumber: null }))).toBeNull();
  });
});

describe("paymentInstructionsFor", () => {
  it("asks for the buy-ins only: never the re-buys, add-ons or high hand, which is paid at the door", () => {
    const instructions = paymentInstructionsFor(signUp({ registration: registration({ buyIns: 2, rebuys: 1, addons: 1, enteringHighHands: true }) }));

    expect(instructions).toEqual({
      accountName: "Central Stars",
      accountNumber: "12-3456-7890123-00",
      bankName: null,
      instructions: null,
      amountDueCents: 20_000,
      particulars: "Wed Night",
      reference: "Tama Rangi",
      highHandAtDoorCents: 1_000,
      waitingList: false,
    });
  });

  it("asks a free entry for nothing, without the club's account, and mentions no high hand the tournament does not offer", () => {
    const free = paymentInstructionsFor(signUp({ registration: registration({ freeEntry: true, enteringHighHands: true }), tournament: tournament({ enableHighHand: false }) }));

    expect(free).toEqual({ amountDueCents: 0, highHandAtDoorCents: 0, waitingList: false });
  });

  it("gives a free entry's high hand, to pay at the door, and a $0 game nothing to transfer, neither with the account", () => {
    const freeWithHighHand = paymentInstructionsFor(signUp({ registration: registration({ freeEntry: true, paymentConfirmed: true, enteringHighHands: true }) }));
    const freeroll = paymentInstructionsFor(signUp({ tournament: tournament({ buyInAmount: "0.00" }) }));

    expect(freeWithHighHand).toEqual({ amountDueCents: 0, highHandAtDoorCents: 1_000, waitingList: false });
    expect(freeroll).toEqual({ amountDueCents: 0, highHandAtDoorCents: 0, waitingList: false });
  });

  it("tells the waiting list not to pay yet, and never gives it the club's account (R8REV0-PRIV-01)", () => {
    const waiting = paymentInstructionsFor(signUp({ waitingList: true, registration: registration({ enteringHighHands: true }) }));

    expect(waiting).toEqual({ amountDueCents: 10_000, highHandAtDoorCents: 1_000, waitingList: true });
    expect(waiting).not.toHaveProperty("accountNumber");
    expect(JSON.stringify(waiting)).not.toContain("7890123");
  });

  it("tells the day in New Zealand when the club's own zone is unknown", () => {
    const instructions = paymentInstructionsFor(signUp({ club: club({ timezone: "Mars/Olympus" }), tournament: tournament({ name: "A tournament with a long name" }) }));

    expect(instructions).toMatchObject({ particulars: "Wed 18 Nov" });
  });

  it("is nothing while the tournament does not show bank details, or its club has none, nor for an entry already paid", () => {
    expect(paymentInstructionsFor(signUp({ tournament: tournament({ showBankTransfer: false }) }))).toBeUndefined();
    expect(paymentInstructionsFor(signUp({ registration: registration({ paymentConfirmed: true }) }))).toBeUndefined();
    expect(paymentInstructionsFor(signUp({ registration: registration({ paymentConfirmed: true, freeEntry: true }) }))).toEqual({ amountDueCents: 0, highHandAtDoorCents: 0, waitingList: false });
    expect(paymentInstructionsFor(signUp({ club: club({ bankAccountNumber: null }) }))).toBeUndefined();
    expect(paymentInstructionsFor(signUp({ club: undefined }))).toBeUndefined();
  });
});
