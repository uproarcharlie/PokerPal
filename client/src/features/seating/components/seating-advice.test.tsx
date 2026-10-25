import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { qk } from "@/lib/api/query-keys";
import { MANAGER_VIEW, tournamentDto } from "@test/helpers/dto";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import {
  advisedSeatingDto,
  mockSeating,
  recordWrite,
  seatingDto,
  seatingMutation,
  seatMove,
  seatRef,
  tableAdvice,
  type EntrySpec,
  type SeatingSpec,
} from "@test/helpers/seating-dto";
import { SeatingPanel } from "./seating-panel";

const tournament = tournamentDto({ status: "in_progress", viewer: MANAGER_VIEW });

const players = (prefix: string, count: number, from = 1): Partial<Record<number, EntrySpec>> =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [from + i, { id: `${prefix}${from + i}`, name: `${prefix.toUpperCase()} ${from + i}` }]));

/** Two full tables of 9 and one late arrival waiting: the advisor says to open Table 3. */
const fullRoom: SeatingSpec = {
  version: "f0f0f0f0",
  tables: [
    { id: "tA", number: 1, seats: 9, seated: players("a", 9) },
    { id: "tB", number: 2, seats: 9, seated: players("b", 9) },
  ],
  unseated: [{ id: "late", name: "Late Larry" }],
};

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});
afterEach(() => {
  window.localStorage.clear();
});

describe("SeatingPanel: the table advisor", () => {
  it("says to open the next table with its plan, applies exactly that plan, and offers to undo it (at 390 px)", async () => {
    screenWidth(390);
    const shown = advisedSeatingDto(fullRoom);
    mockSeating(shown);
    const [advice] = shown.advisor.advice;
    const moves = advice.moves.map((move) => (move.to?.tableId === "new-table" ? { ...move, to: { ...move.to, tableId: "tN" } } : move));
    const after = seatingDto({
      version: "a1a1a1a1",
      tables: [...fullRoom.tables!, { id: "tN", number: 3, seats: 9 }],
      lastChange: { activityId: "act1", eventType: "table_opened", description: "Opened Table 3: 1 player seated, 5 moved", at: "2026-10-25T08:00:00.000Z", moves, canUndo: true },
    });
    const opened = recordWrite("post", "/api/tournaments/t1/seating/open-table", () => HttpResponse.json(seatingMutation(after, moves), { status: 201 }));
    const undone = recordWrite("post", "/api/tournaments/t1/seating/undo", () => HttpResponse.json(seatingMutation(seatingDto(fullRoom), [])));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const card = await screen.findByTestId("advice-open_table");
    expect(card).toHaveTextContent("Open Table 3");
    expect(card).toHaveTextContent("Every table is full and 1 player is waiting: open Table 3 and even the tables out to 7 / 6 / 6");
    expect(card).toHaveTextContent("1 player sits down, 5 players move across.");
    await user.click(within(card).getByText("Show who moves (6)"));
    expect(within(card).getByTestId("open-table-moves")).toHaveTextContent("Late Larry sits down at Table 3, Seat");
    expect(within(card).getByTestId("open-table-moves")).toHaveTextContent(/B 9: Table 2, Seat 9 → Table 3, Seat \d/);
    // The advice already offers it: the toolbar does not repeat "Seat 1 waiting".
    expect(screen.queryByTestId("seat-waiting")).not.toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Open Table 3" }));
    await waitFor(() => expect(opened).toEqual([{ expectedVersion: "f0f0f0f0" }]));
    const dialog = await screen.findByRole("dialog", { name: "Table 3 opened" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(6);

    await user.click(within(dialog).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(undone).toEqual([{ activityId: "act1", expectedVersion: "a1a1a1a1" }]));
  });

  it("refreshes the seating when it changed before Open Table was tapped, and says so", async () => {
    mockSeating(advisedSeatingDto(fullRoom));
    const fresh = seatingDto({ version: "bbbb2222", tables: fullRoom.tables });
    recordWrite("post", "/api/tournaments/t1/seating/open-table", () => apiError(409, "STALE_PLAN", "The seating changed", { seating: fresh }));
    const user = userEvent.setup();
    const { queryClient } = renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Open Table 3" }));

    expect(await screen.findByText("Could not open the table")).toBeInTheDocument();
    expect(screen.getByText("Seating changed — refreshed")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryData(qk.tournaments.seating("t1"))).toMatchObject({ version: "bbbb2222" }));
    expect(screen.queryByTestId("advice-open_table")).not.toBeInTheDocument();
  });

  it("offers to seat the players waiting while seats are open, and seats them (paid only under “once they've paid”)", async () => {
    const waiting: SeatingSpec = { tables: [{ id: "tA", number: 1, seats: 9, seated: players("a", 3) }], unseated: [{ id: "w1", name: "Wiremu" }, { id: "w2", name: "Xena", paid: false }] };
    mockSeating(advisedSeatingDto(waiting));
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/draw", () => HttpResponse.json(seatingMutation(seatingDto({ tables: waiting.tables }))));
    const user = userEvent.setup();
    const { unmount } = renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const card = await screen.findByTestId("advice-seat_waiting");
    expect(card).toHaveTextContent("Seat 2 waiting");
    expect(card).toHaveTextContent("2 players are waiting and 6 seats are open: seat them");
    await user.click(within(card).getByRole("button", { name: "Seat them" }));
    await waitFor(() => expect(bodies).toEqual([{ scope: "unseated", includeUnconfirmed: true }]));
    unmount();

    mockSeating(advisedSeatingDto({ ...waiting, settings: { autoSeat: "once_paid" } }));
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);
    const paidOnly = await screen.findByTestId("advice-seat_waiting");
    expect(screen.getByTestId("advisor-flag")).toHaveTextContent("1 player registered, not arrived yet: seated once they've paid.");
    await user.click(within(paidOnly).getByRole("button", { name: "Seat them" }));
    await waitFor(() => expect(bodies).toEqual([{ scope: "unseated", includeUnconfirmed: true }, { scope: "unseated", includeUnconfirmed: false }]));
  });

  it("lists the balancing moves, naming the tables they come from and go to (LEAD-SEAT-BANNER), and applies exactly those", async () => {
    const uneven: SeatingSpec = {
      version: "aaaa1111",
      tables: [
        { id: "tA", number: 1, seats: 9, seated: players("a", 9) },
        { id: "tC", number: 3, seats: 9, seated: players("c", 7) },
      ],
    };
    const shown = advisedSeatingDto(uneven);
    mockSeating(shown);
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/balance", () => HttpResponse.json(seatingMutation(seatingDto({ tables: uneven.tables }), shown.advisor.advice[0].moves)));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const card = await screen.findByTestId("advice-balance");
    expect(card).toHaveTextContent("Tables are uneven: move 1 player");
    expect(card).toHaveTextContent("Tables are 9 and 7 players: balance them (1 move)");
    expect(card).toHaveTextContent("Table 1 has 9 players, Table 3 has 7.");
    expect(card).toHaveTextContent("A 9: Table 1, Seat 9 → Table 3, Seat 8");
    await user.click(within(card).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(bodies).toEqual([{ expectedVersion: "aaaa1111" }]));
    expect(await screen.findByRole("dialog", { name: "Tables balanced" })).toBeInTheDocument();
  });

  it("says when a table can be broken, and who stays waiting, before the TD confirms", async () => {
    mockSeating(
      seatingDto({
        tables: [
          { id: "tA", number: 1, seats: 9, seated: players("a", 2) },
          { id: "tB", number: 2, seats: 9, seated: players("b", 2) },
          { id: "tC", number: 3, seats: 9, seated: players("c", 1) },
        ],
        unseated: [{ id: "w1", name: "Wiremu", paid: false }],
        advisor: { phase: "shrinking", advice: [tableAdvice("break_table", "5 players fit on 2 tables of 9: break Table 3", { tableId: "tC", tableNumber: 3, players: 1 })] },
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const card = await screen.findByTestId("advice-break_table");
    expect(card).toHaveTextContent("Table 3 can be broken");
    expect(card).toHaveTextContent("5 players fit on 2 tables of 9: break Table 3");
    expect(card).toHaveTextContent("1 player is waiting for a seat (1 unpaid): they keep waiting.");
    await user.click(within(card).getByRole("button", { name: "Break Table 3" }));
    expect(await screen.findByRole("alertdialog", { name: "Break Table 3?" })).toBeInTheDocument();
  });

  it("calls the final table at the table it names", async () => {
    mockSeating(
      seatingDto({
        tables: [
          { id: "tA", number: 1, seats: 9, seated: players("a", 1) },
          { id: "tB", number: 2, name: "Feature table", seats: 9, seated: players("b", 1) },
        ],
        advisor: { phase: "shrinking", advice: [tableAdvice("final_table", "2 players fit at one table: draw the final table at Feature table", { tableId: "tB", tableNumber: 2, players: 2 })] },
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const card = await screen.findByTestId("advice-final_table");
    expect(card).toHaveTextContent("Final table!2 players fit at one table: draw the final table at Feature table");
    await user.click(within(card).getByRole("button", { name: "Draw the final table" }));
    expect(await screen.findByRole("alertdialog", { name: "Draw the final table at Feature table?" })).toBeInTheDocument();
  });

  it("flags the waiting list behind a full field (round 5, item 15), and does not offer to seat only unpaid players with “Paid players only” on", async () => {
    window.localStorage.setItem("pokerpal.seating.paidOnly.t1", "on");
    mockSeating(
      seatingDto({
        tables: [{ id: "tA", number: 1, seats: 9, seated: players("a", 2) }],
        unseated: [{ id: "w1", name: "Wiremu", paid: false }],
        advisor: { overCapacity: 1, advice: [tableAdvice("seat_waiting", "1 player is waiting and 7 seats are open: seat them", { players: 1 })] },
      }),
    );
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    expect(await screen.findByTestId("advisor-flag")).toHaveTextContent("1 on the waiting list: seated once a place opens and they're accepted.");
    // No override past Max players: nothing tells the TD to seat them by hand.
    expect(screen.getByTestId("seating-advice")).not.toHaveTextContent("by hand");
    expect(screen.queryByTestId("advice-seat_waiting")).not.toBeInTheDocument();
  });

  it("suggests nothing to a finished tournament", async () => {
    mockSeating({ ...advisedSeatingDto(fullRoom), readOnly: true, tournamentStatus: "completed" });
    renderWithApp(<SeatingPanel tournament={tournamentDto({ status: "completed", viewer: MANAGER_VIEW })} registrations={[]} />);

    await screen.findByRole("group", { name: /^Table 1:/ });
    expect(screen.queryByTestId("seating-advice")).not.toBeInTheDocument();
  });

  it("names a move to a table the advice would open as that table", () => {
    const moved = seatMove("a9", "A 9", seatRef("tA", 1, 9), seatRef("new-table", 3, 2), "open_table");
    expect(moved.to).toMatchObject({ tableName: "Table 3", seatNumber: 2 });
  });
});
