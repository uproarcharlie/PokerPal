import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TablePlan, type PlanSeat } from "./table-plan";

const seats: PlanSeat[] = [
  { seatNumber: 1, player: { id: "p1", name: "Aroha Ngata", imageUrl: null } },
  { seatNumber: 3, player: { id: "p2", name: "Bob Jones", imageUrl: null }, unpaid: true },
];

describe("TablePlan", () => {
  it("names the table and how full it is, and reads the seats in order", () => {
    render(<TablePlan name="Table 2" seatCount={4} seats={seats} />);

    const plan = screen.getByRole("group", { name: "Table 2: 2 of 4 seats taken" });
    expect(within(plan).getAllByRole("listitem").map((seat) => within(seat).getByText(/^Seat \d/).textContent)).toEqual([
      "Seat 1: Aroha Ngata",
      "Seat 2, empty",
      "Seat 3: Bob Jones, not paid",
      "Seat 4, empty",
    ]);
    // The first name under the photo; the full name is read once.
    expect(within(plan).getByText("Aroha")).toHaveAttribute("class", expect.stringContaining("truncate"));
  });

  it("makes every seat a button for the TD, the one picked up pressed", async () => {
    const onSeatPress = vi.fn();
    const user = userEvent.setup();
    render(<TablePlan name="Table 2" seatCount={4} seats={seats} selectedSeat={3} onSeatPress={onSeatPress} />);

    expect(screen.getByRole("button", { name: "Seat 3: Bob Jones, not paid" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Seat 1: Aroha Ngata" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Seat 2, empty" }));
    expect(onSeatPress).toHaveBeenCalledWith({ seatNumber: 2, player: null });
  });

  it("ignores presses while a change is being saved, keeping the seats in the tab order", async () => {
    const onSeatPress = vi.fn();
    const user = userEvent.setup();
    render(<TablePlan name="Table 2" seatCount={4} seats={seats} onSeatPress={onSeatPress} busy />);

    const seat = screen.getByRole("button", { name: "Seat 1: Aroha Ngata" });
    expect(seat).toHaveAttribute("aria-disabled", "true");
    await user.click(seat);
    expect(onSeatPress).not.toHaveBeenCalled();
    expect(seat).not.toBeDisabled();
  });

  it("names each seat as the TD's screen words it", () => {
    render(<TablePlan name="Table 2" seatCount={2} seats={seats} onSeatPress={() => {}} seatLabel={(seat) => `Seat ${seat.seatNumber} here`} />);

    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Seat 1 here", "Seat 2 here"]);
  });
});
