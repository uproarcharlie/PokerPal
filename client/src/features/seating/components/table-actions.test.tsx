import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { MANAGER_VIEW, tournamentDto } from "@test/helpers/dto";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { mockSeating, recordWrite, seatingDto, seatingMutation, seatMove, seatRef, type SeatingSpec } from "@test/helpers/seating-dto";
import { SeatingPanel } from "./seating-panel";

const tournament = tournamentDto({ status: "in_progress", viewer: MANAGER_VIEW });

/** Table 1 with four players, Table 2 with one, Table 3 empty, and Table 4 archived. */
const night: SeatingSpec = {
  version: "1234abcd",
  tables: [
    {
      id: "tA",
      number: 1,
      seats: 10,
      seated: { 1: { id: "r1", name: "Alice" }, 2: { id: "r2", name: "Bob" }, 9: { id: "r3", name: "Cara" }, 10: { id: "r4", name: "Dan" } },
    },
    { id: "tB", number: 2, seats: 9, seated: { 3: { id: "r5", name: "Eve" } } },
    { id: "tC", number: 3, seats: 9 },
    { id: "tD", number: 4, seats: 8, status: "broken" },
  ],
};

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  mockSeating(seatingDto(night));
});

async function openMenu(user: ReturnType<typeof userEvent.setup>, table: string, item: string) {
  await user.click(await screen.findByRole("button", { name: `${table} options` }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

describe("SeatingPanel: a table's menu", () => {
  it("offers what each table can do now", async () => {
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Table 1 options" }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Rename or resize…", "Final table here…", "Break table…"]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Table 3 options" }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Rename or resize…", "Final table here…", "Remove table…"]);
  });

  it("renames a table, sending only the name", async () => {
    const bodies = recordWrite("patch", "/api/tournaments/t1/tables/tB", () => HttpResponse.json(seatingMutation(seatingDto(night))));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await openMenu(user, "Table 2", "Rename or resize…");
    const dialog = await screen.findByRole("dialog", { name: "Table 2 settings" });
    await user.type(within(dialog).getByLabelText("Name"), "Feature table");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ name: "Feature table" }]));
    expect(await screen.findByText("Table updated")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Table 2 settings" })).not.toBeInTheDocument();
  });

  it("puts the seats still taken on the seat count when a table cannot shrink", async () => {
    const bodies = recordWrite("patch", "/api/tournaments/t1/tables/tA", () => apiError(409, "SEATS_OCCUPIED", "Seats are taken", { seatNumbers: [9, 10] }));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await openMenu(user, "Table 1", "Rename or resize…");
    const dialog = await screen.findByRole("dialog", { name: "Table 1 settings" });
    await user.click(within(dialog).getByRole("button", { name: "8 seats" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ seatCount: 8 }]));
    expect(await within(dialog).findByText("Seats 9 and 10 are taken: move those players first")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Seats")).toHaveAttribute("aria-invalid", "true");
  });

  it("closes without asking the server when nothing changed", async () => {
    const bodies = recordWrite("patch", "/api/tournaments/t1/tables/tB", () => HttpResponse.json(seatingMutation(seatingDto(night))));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await openMenu(user, "Table 2", "Rename or resize…");
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bodies).toEqual([]);
  });

  it("removes an empty table once confirmed, and says when it was archived instead", async () => {
    const bodies = recordWrite("delete", "/api/tournaments/t1/tables/tC", () => HttpResponse.json(seatingMutation(seatingDto(night), [], { removed: "archived" })));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await openMenu(user, "Table 3", "Remove table…");
    await user.click(within(await screen.findByRole("alertdialog", { name: "Remove Table 3?" })).getByRole("button", { name: "Remove table" }));

    await waitFor(() => expect(bodies).toEqual([null]));
    expect(await screen.findByText("Table archived")).toBeInTheDocument();
  });

  it("breaks a table against the seating on screen, and lists who moved", async () => {
    const bodies = recordWrite("post", "/api/tournaments/t1/tables/tB/break", () =>
      HttpResponse.json(
        seatingMutation(
          seatingDto({ tables: [night.tables![0], { ...night.tables![1], status: "broken" }] }),
          [seatMove("r5", "Eve", seatRef("tB", 2, 3), seatRef("tA", 1, 5), "table_broken")],
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await openMenu(user, "Table 2", "Break table…");
    const confirm = await screen.findByRole("alertdialog", { name: "Break Table 2?" });
    expect(confirm).toHaveTextContent("Its 1 player move to random empty seats at the other tables");
    await user.click(within(confirm).getByRole("button", { name: "Break table" }));

    await waitFor(() => expect(bodies).toEqual([{ expectedVersion: "1234abcd" }]));
    const moves = await screen.findByRole("dialog", { name: "Table 2 broken" });
    expect(within(moves).getByText("Table 1, Seat 5")).toBeInTheDocument();
    expect(within(moves).getByText("from Table 2, Seat 3")).toBeInTheDocument();
  });

  it("draws the final table at the table chosen", async () => {
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/final-table", () => HttpResponse.json(seatingMutation(seatingDto(night), [seatMove("r5", "Eve", seatRef("tB", 2, 3), seatRef("tC", 3, 1), "final_table")])));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await openMenu(user, "Table 3", "Final table here…");
    const confirm = await screen.findByRole("alertdialog", { name: "Draw the final table at Table 3?" });
    expect(confirm).toHaveTextContent("Everyone still in (5 players) gets a new random seat at Table 3");
    await user.click(within(confirm).getByRole("button", { name: "Draw the final table" }));

    await waitFor(() => expect(bodies).toEqual([{ tableId: "tC" }]));
    expect(await screen.findByRole("dialog", { name: "Final table drawn" })).toBeInTheDocument();
  });

  it("reopens an archived table", async () => {
    const bodies = recordWrite("patch", "/api/tournaments/t1/tables/tD", () => HttpResponse.json(seatingMutation(seatingDto(night))));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Reopen Table 4" }));

    await waitFor(() => expect(bodies).toEqual([{ status: "active" }]));
    expect(await screen.findByText("Table reopened")).toBeInTheDocument();
  });
});
