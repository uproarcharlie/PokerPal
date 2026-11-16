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

  it("counts free entries as accepted, and says how many came in free (round 7, item 6)", () => {
    renderWithApp(<PaidPlayersNote tournamentId="t1" paid={5} entrants={6} freeEntries={1} />);

    expect(screen.getByTestId("paid-players-note")).toHaveTextContent("Prize pool from 5 accepted players · 1 free entry · 1 not paid yet (not in the pool)");
    expect(screen.getByRole("link", { name: "Take payments" })).toBeInTheDocument();
  });

  it("in a $0 game only counts who is accepted, and offers Accept players (round 7, item 8)", async () => {
    const onTakePayments = vi.fn();
    renderWithApp(<PaidPlayersNote tournamentId="t1" paid={3} entrants={5} freeTournament onTakePayments={onTakePayments} />);

    const note = screen.getByTestId("paid-players-note");
    expect(note).toHaveTextContent(/^3 accepted players · 2 not accepted yet/);
    expect(note).not.toHaveTextContent(/paid|not in the pool/);
    await userEvent.click(screen.getByRole("button", { name: "Accept players" }));
    expect(onTakePayments).toHaveBeenCalledOnce();
  });

  it("shows nothing before anyone has signed up", () => {
    renderWithApp(<PaidPlayersNote tournamentId="t1" paid={0} entrants={0} />);

    expect(screen.queryByTestId("paid-players-note")).not.toBeInTheDocument();
  });
});
