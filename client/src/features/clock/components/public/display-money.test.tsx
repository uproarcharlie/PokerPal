import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { DisplayMoney, moneyText, PAYOUT_PAGE_MS, payoutPage } from "./display-money";
import type { MoneyPlan } from "./screen-plan";

const money = (places: number): LiveDisplayDto["money"] => ({
  show: true,
  estimated: false,
  netCents: places * 10_000,
  payouts: Array.from({ length: places }, (_, index) => ({ position: index + 1, amountCents: 10_000 })),
  carriedIn: [],
  highHands: null,
});

const plan = (payouts: number): MoneyPlan => ({ pool: true, payouts, carried: false, note: false, label: 20, amount: 60, row: 24, small: 20, padX: 12, padY: 8, gap: 8 });

const placesShown = () => within(screen.getByTestId("display-payouts")).getAllByRole("listitem").map((row) => row.firstElementChild?.textContent);

describe("payoutPage", () => {
  it("splits the places into groups that fit, wrapping round after the last", () => {
    const places = [1, 2, 3, 4, 5, 6, 7];
    expect(payoutPage(places, 3, 0)).toEqual({ rows: [1, 2, 3], pages: 3, start: 0 });
    expect(payoutPage(places, 3, 2)).toEqual({ rows: [7], pages: 3, start: 6 });
    expect(payoutPage(places, 3, 3)).toEqual({ rows: [1, 2, 3], pages: 3, start: 0 });
    expect(payoutPage(places, 10, 4)).toEqual({ rows: places, pages: 1, start: 0 });
    expect(payoutPage(places, 0, 0)).toEqual({ rows: [], pages: 0, start: 0 });
  });
});

describe("DisplayMoney: every place, a group at a time (the TV)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the panel every place paid, not only the top 5", () => {
    expect(moneyText(money(12), "always")?.payouts).toHaveLength(12);
  });

  it("moves on to the next places when they do not all fit, then back to 1st", () => {
    const twelve = money(12);
    render(<DisplayMoney money={twelve} text={moneyText(twelve, "always")!} plan={plan(5)} />);

    expect(placesShown()).toEqual(["1st", "2nd", "3rd", "4th", "5th"]);
    act(() => void vi.advanceTimersByTime(PAYOUT_PAGE_MS));
    expect(placesShown()).toEqual(["6th", "7th", "8th", "9th", "10th"]);
    act(() => void vi.advanceTimersByTime(PAYOUT_PAGE_MS));
    expect(placesShown()).toEqual(["11th", "12th"]);
    act(() => void vi.advanceTimersByTime(PAYOUT_PAGE_MS));
    expect(placesShown()).toEqual(["1st", "2nd", "3rd", "4th", "5th"]);
  });

  it("keeps every place still when they all fit", () => {
    const three = money(3);
    render(<DisplayMoney money={three} text={moneyText(three, "always")!} plan={plan(5)} />);

    expect(placesShown()).toEqual(["1st", "2nd", "3rd"]);
    act(() => void vi.advanceTimersByTime(PAYOUT_PAGE_MS * 3));
    expect(placesShown()).toEqual(["1st", "2nd", "3rd"]);
  });
});
