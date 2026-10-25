import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { PaidPlayersNote } from "./paid-players-note";

beforeEach(() => {
  mockSignedOut();
});

describe("PaidPlayersNote", () => {
  it("says the pool holds only the paid players' money, and leads to the payment desk while anyone has not paid", () => {
    renderWithApp(<PaidPlayersNote tournamentId="t1" paid={16} entrants={18} />);

    expect(screen.getByTestId("paid-players-note")).toHaveTextContent("Prize pool from 16 paid players · 2 not paid yet (not in the pool)");
    const link = screen.getByRole("link", { name: "Take payments" });
    expect(link).toHaveAttribute("href", "/admin/registrations/t1");
    expect(link).toHaveClass("h-11");
  });

  it("opens the phone desk's Take payment sheet instead of leaving the desk, when given one (R6REV1-PHONE-02)", async () => {
    const onTakePayments = vi.fn();
    renderWithApp(<PaidPlayersNote tournamentId="t1" paid={16} entrants={18} onTakePayments={onTakePayments} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Take payments" });
    expect(button).toHaveClass("h-11");
    await userEvent.click(button);
    expect(onTakePayments).toHaveBeenCalledOnce();
  });

  it("offers no link once everyone has paid", () => {
    renderWithApp(<PaidPlayersNote tournamentId="t1" paid={1} entrants={1} />);

    expect(screen.getByTestId("paid-players-note")).toHaveTextContent(/^Prize pool from 1 paid player$/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says a pool nobody has paid into yet is empty for that reason", () => {
    renderWithApp(<PaidPlayersNote tournamentId="t1" paid={0} entrants={3} />);

    expect(screen.getByTestId("paid-players-note")).toHaveTextContent("Prize pool from 0 paid players · 3 not paid yet (not in the pool)");
  });

  it("shows nothing before anyone has signed up", () => {
    renderWithApp(<PaidPlayersNote tournamentId="t1" paid={0} entrants={0} />);

    expect(screen.queryByTestId("paid-players-note")).not.toBeInTheDocument();
  });
});
