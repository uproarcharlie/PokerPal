/**
 * The Seats tab on a phone (round 5, items 10 and 18; designed at 390 × 844): the tables drawn in their
 * real shape, a list by table one tap away (and remembered), tap-to-move in either, the new arrivals
 * auto-seat sat down, a way to jump between tables, and setting up and changing tables with shapes.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatingDto } from "@shared/api/seating";
import { qk } from "@/lib/api/query-keys";
import { server } from "@test/msw/server";
import { MANAGER_VIEW, tournamentDto } from "@test/helpers/dto";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { recordWrite, seatingDto, seatingMutation, seatMove, seatRef, type SeatingSpec } from "@test/helpers/seating-dto";
import { SeatingPanel } from "./seating-panel";

const tournament = tournamentDto({ status: "in_progress", viewer: MANAGER_VIEW });

/** Central Stars' night: two 9-seat rectangles. */
const night: SeatingSpec = {
  version: "c5c5c5c5",
  tables: [
    { id: "tA", number: 1, seats: 9, shape: "rectangle", seated: { 1: { id: "r1", name: "Alice Smith" }, 2: { id: "r2", name: "Bob Jones", paid: false } } },
    { id: "tB", number: 2, seats: 9, shape: "rectangle", seated: { 4: { id: "r4", name: "Eve Brown" } } },
  ],
  settings: { tableShape: "rectangle" },
};

let current: SeatingDto;

beforeEach(() => {
  screenWidth(390);
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  current = seatingDto(night);
  server.use(http.get("/api/tournaments/t1/seating", () => HttpResponse.json(current)));
});
afterEach(() => window.localStorage.clear());

describe("the Seats tab at 390 px", () => {
  it("draws the tables in their shape, with each player at their seat", async () => {
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const plan = await screen.findByRole("group", { name: "Table 1: 2 of 9 seats taken" });
    expect(plan).toHaveAttribute("data-shape", "rectangle");
    expect(within(plan).getAllByRole("button")).toHaveLength(9);
    expect(within(plan).getByRole("button", { name: "Seat 2: Bob Jones, not paid" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tables" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lists the tables seat by seat in one tap, moves a player with a tap on them and one on an empty seat, and remembers the list", async () => {
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/assign", () =>
      HttpResponse.json(seatingMutation(current, [seatMove("r1", "Alice Smith", seatRef("tA", 1, 1), seatRef("tB", 2, 5), "move")])),
    );
    const user = userEvent.setup();
    const first = renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "List" }));
    const table1 = screen.getByRole("list", { name: "Table 1 seats" });
    expect(within(table1).getAllByRole("listitem")).toHaveLength(9);
    expect(within(table1).getAllByRole("listitem")[1]).toHaveTextContent(/^Seat 2.*Bob Jones/);
    await user.click(within(table1).getByRole("button", { name: "Seat 1: Alice Smith" }));
    expect(within(table1).getByRole("button", { name: "Seat 1: Alice Smith" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(screen.getByRole("list", { name: "Table 2 seats" })).getByRole("button", { name: "Seat 5, empty: move Alice Smith here" }));

    await waitFor(() => expect(bodies).toEqual([{ registrationId: "r1", tableId: "tB", seatNumber: 5, swap: false }]));
    expect(await screen.findByText("Player moved")).toBeInTheDocument();
    first.unmount();

    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);
    expect(await screen.findByRole("list", { name: "Table 1 seats" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows who auto-seat sat down since the tab opened, marks their seat, and forgets them when dismissed", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);
    await screen.findByRole("group", { name: "Table 1: 2 of 9 seats taken" });

    current = seatingDto({ ...night, tables: [{ ...night.tables![0], seated: { ...night.tables![0].seated, 7: { id: "r16", name: "Test Player 16" } } }, night.tables![1]] });
    await queryClient.refetchQueries({ queryKey: qk.tournaments.seating("t1") });

    const banner = await screen.findByRole("region", { name: "New arrivals" });
    expect(banner).toHaveTextContent("Test Player 16 seated at Table 1, Seat 7");
    expect(within(screen.getByRole("group", { name: "Table 1: 3 of 9 seats taken" })).getByRole("button", { name: "Seat 7: Test Player 16" }).innerHTML).toContain("ring-status-live-foreground");
    await user.click(within(banner).getByRole("button", { name: "Dismiss new arrivals" }));
    expect(screen.queryByRole("region", { name: "New arrivals" })).not.toBeInTheDocument();
  });

  it("jumps to a table from the row of tables once there are three or more", async () => {
    current = seatingDto({ ...night, tables: [...night.tables!, { id: "tC", number: 3, seats: 9 }] });
    const scrolled: string[] = [];
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this.id);
    });
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const tables = await screen.findByRole("navigation", { name: "Go to a table" });
    await user.click(within(tables).getByRole("button", { name: "Table 3 · 0/9" }));
    expect(scrolled).toEqual(["seating-table-3"]);
    scrollIntoView.mockRestore();
  });

  it("sets up the starting tables in the shape chosen, saying who would wait for the next table", async () => {
    current = seatingDto({ unseated: Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, name: `Waiting ${i}` })), settings: { tableShape: "rectangle" } });
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/setup", () => HttpResponse.json(seatingMutation(seatingDto(night)), { status: 201 }));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    expect(await screen.findByText("20 players still in. Start with 3 tables: 7 / 7 / 6.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up tables & draw seats" }));
    const sheet = await screen.findByRole("dialog", { name: "Set up tables & draw seats" });
    expect(within(sheet).getByRole("radio", { name: /Rectangle/ })).toBeChecked();
    expect(within(sheet).getByTestId("setup-preview")).toHaveTextContent("3 tables: 7 / 7 / 6");
    await user.click(within(sheet).getByRole("button", { name: "2 tables" }));
    expect(within(sheet).getByTestId("setup-preview")).toHaveTextContent("2 tables: 9 / 9 · 2 players wait for a seat");
    await user.click(within(sheet).getByRole("radio", { name: /Round/ }));
    await user.click(within(sheet).getByRole("button", { name: "Set up & draw seats" }));

    await waitFor(() => expect(bodies).toEqual([{ tableCount: 2, includeUnconfirmed: true, shape: "round" }]));
  });

  it("redraws one table as another shape from its menu", async () => {
    const bodies = recordWrite("patch", "/api/tournaments/t1/tables/tB", () => HttpResponse.json(seatingMutation(current)));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Table 2 options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Table settings…" }));
    const dialog = await screen.findByRole("dialog", { name: "Table 2 settings" });
    expect(within(dialog).getByRole("radio", { name: /Rectangle/ })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: /Round/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ shape: "round" }]));
  });
});
