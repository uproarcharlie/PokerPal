import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { qk } from "@/lib/api/query-keys";
import { MANAGER_VIEW, tournamentDto } from "@test/helpers/dto";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { mockSeating, recordWrite, seatingDto, seatingMutation, seatMove, seatRef, type SeatingSpec } from "@test/helpers/seating-dto";
import { SeatingPanel } from "./seating-panel";

const tournament = tournamentDto({ status: "in_progress", viewer: MANAGER_VIEW });

const fullest = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, { id: `a${i + 1}`, name: `Ann ${i + 1}` }]));
const emptiest = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i + 1, { id: `b${i + 1}`, name: `Ben ${i + 1}` }]));

/** Table 1 has 9 players, Table 3 has 7: the server suggests moving Ann 9 across. */
const uneven: SeatingSpec = {
  version: "aaaa1111",
  tables: [
    { id: "tA", number: 1, seats: 9, seated: fullest },
    { id: "tC", number: 3, seats: 9, seated: emptiest },
  ],
  suggestions: { balance: [seatMove("a9", "Ann 9", seatRef("tA", 1, 9), seatRef("tC", 3, 8), "balance")] },
};

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("SeatingPanel: what the seating suggests", () => {
  it("lists the balancing moves and applies exactly those, against the seating they were worked out from", async () => {
    mockSeating(seatingDto(uneven));
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/balance", () => HttpResponse.json(seatingMutation(seatingDto({ tables: uneven.tables }), uneven.suggestions!.balance)));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const advice = await screen.findByTestId("seating-advice");
    expect(advice).toHaveTextContent("Tables are uneven: move 1 player");
    expect(advice).toHaveTextContent("Table 1 has 9 players, Table 3 has 7.");
    expect(advice).toHaveTextContent("Ann 9: Table 1, Seat 9 → Table 3, Seat 8");
    await user.click(within(advice).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(bodies).toEqual([{ expectedVersion: "aaaa1111" }]));
    expect(await screen.findByRole("dialog", { name: "Tables balanced" })).toBeInTheDocument();
  });

  it("shows the seating as it now is when it changed before Apply, and says so", async () => {
    mockSeating(seatingDto(uneven));
    const fresh = seatingDto({ version: "bbbb2222", tables: [{ id: "tA", number: 1, seats: 9, seated: fullest }, { id: "tC", number: 3, seats: 9, seated: { ...emptiest, 8: { id: "x", name: "Xena" } } }] });
    recordWrite("post", "/api/tournaments/t1/seating/balance", () => apiError(409, "STALE_PLAN", "The seating changed", { seating: fresh }));
    const user = userEvent.setup();
    const { queryClient } = renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(within(await screen.findByTestId("seating-advice")).getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("Could not balance the tables")).toBeInTheDocument();
    expect(screen.getByText("Seating changed — refreshed")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Seat 8: Xena" })).toBeInTheDocument();
    expect(queryClient.getQueryData(qk.tournaments.seating("t1"))).toMatchObject({ version: "bbbb2222" });
    expect(screen.queryByTestId("seating-advice")).not.toBeInTheDocument();
  });

  it("suggests breaking the emptiest table once its players fit elsewhere", async () => {
    mockSeating(
      seatingDto({
        tables: [
          { id: "tA", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Alice" } } },
          { id: "tB", number: 2, seats: 9, seated: { 1: { id: "r2", name: "Bob" } } },
          { id: "tC", number: 3, seats: 9, seated: { 1: { id: "r3", name: "Cara" } } },
        ],
        suggestions: { breakTable: { tableId: "tC", tableNumber: 3, playersToMove: 1 } },
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const advice = await screen.findByTestId("seating-advice");
    expect(advice).toHaveTextContent("Table 3 can be broken");
    expect(advice).toHaveTextContent("Its 1 player fit at the other tables.");
    await user.click(within(advice).getByRole("button", { name: "Break Table 3" }));
    expect(await screen.findByRole("alertdialog", { name: "Break Table 3?" })).toBeInTheDocument();
  });

  it("calls the final table once everyone still in fits at one, in place of breaking a table", async () => {
    mockSeating(
      seatingDto({
        tables: [
          { id: "tA", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Alice" } } },
          { id: "tB", number: 2, name: "Feature table", seats: 9, seated: { 1: { id: "r2", name: "Bob" } } },
        ],
        suggestions: { finalTable: { tableId: "tB", tableNumber: 2 }, breakTable: { tableId: "tA", tableNumber: 1, playersToMove: 1 } },
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const advice = await screen.findByTestId("seating-advice");
    expect(advice).toHaveTextContent("Final table!Everyone still in (2 players) fits at Feature table.");
    expect(within(advice).queryByRole("button", { name: /^Break/ })).not.toBeInTheDocument();
    await user.click(within(advice).getByRole("button", { name: "Draw the final table" }));
    expect(await screen.findByRole("alertdialog", { name: "Draw the final table at Feature table?" })).toBeInTheDocument();
  });

  it("suggests nothing to a finished tournament", async () => {
    mockSeating(seatingDto({ ...uneven, readOnly: true }));
    renderWithApp(<SeatingPanel tournament={tournamentDto({ status: "completed", viewer: MANAGER_VIEW })} registrations={[]} />);

    await screen.findByRole("group", { name: /^Table 1:/ });
    expect(screen.queryByTestId("seating-advice")).not.toBeInTheDocument();
  });
});
