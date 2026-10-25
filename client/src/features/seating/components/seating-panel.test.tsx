import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "@/lib/api/query-keys";
import { server } from "@test/msw/server";
import { MANAGER_VIEW, tournamentDto } from "@test/helpers/dto";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { mockSeating, recordWrite, seatingDto, seatingMutation, seatMove, seatRef, type SeatingSpec } from "@test/helpers/seating-dto";
import { SeatingPanel } from "./seating-panel";

const tournament = tournamentDto({ status: "in_progress", viewer: MANAGER_VIEW });

/** Two tables, three players seated (Bob unpaid), Cara and Dan waiting (Dan unpaid). */
const night: SeatingSpec = {
  tables: [
    { id: "tA", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Alice Smith" }, 2: { id: "r2", name: "Bob Jones", paid: false } } },
    { id: "tB", number: 2, seats: 9, seated: { 4: { id: "r4", name: "Eve Brown" } } },
  ],
  unseated: [
    { id: "r3", name: "Cara Lee" },
    { id: "r5", name: "Dan Wu", paid: false },
  ],
};

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});
afterEach(() => {
  vi.useRealTimers();
  // "Paid players only" is kept on the device: each test starts without it.
  window.localStorage.clear();
});

/** GET /api/tournaments/t1/seating answers `seating`, counting how often it is asked. */
function countSeatingReads(seating: ReturnType<typeof seatingDto>): { asked: number } {
  const reads = { asked: 0 };
  server.use(
    http.get("/api/tournaments/t1/seating", () => {
      reads.asked += 1;
      return HttpResponse.json(seating);
    }),
  );
  return reads;
}

describe("SeatingPanel: what it shows", () => {
  it("loads, then shows every table, the seats at a glance and who is waiting", async () => {
    mockSeating(seatingDto(night));
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByRole("group", { name: "Table 1: 2 of 9 seats taken" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Table 2: 1 of 9 seats taken" })).toBeInTheDocument();
    expect(screen.getByTestId("seating-summary")).toHaveTextContent("3/18 seats · 15 open · 2 waiting");
    expect(screen.getByRole("button", { name: "Seat 2: Bob Jones, not paid" })).toBeInTheDocument();
    expect(within(screen.getByTestId("unseated-list")).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Cara Lee"),
      expect.stringContaining("Dan Wu, not paid"),
    ]);
    expect(screen.getByRole("button", { name: "Copy seat-finder link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open seat finder" })).toHaveAttribute("href", "/tournament/t1/seats");
  });

  it("puts who is waiting above the tables, in sight of the seats they are picked up for (R5REV-HOST-10)", async () => {
    mockSeating(seatingDto(night));
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const waiting = await screen.findByTestId("unseated-list");
    const firstTable = screen.getByRole("group", { name: "Table 1: 2 of 9 seats taken" });
    expect(waiting.compareDocumentPosition(firstTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says when the seating could not be loaded, and tries again", async () => {
    let asked = 0;
    server.use(
      http.get("/api/tournaments/t1/seating", () => {
        asked += 1;
        return asked === 1 ? apiError(500, "INTERNAL", "Something broke") : HttpResponse.json(seatingDto(night));
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The seating could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: "Table 1: 2 of 9 seats taken" })).toBeInTheDocument();
  });

  it("asks nothing of the server for a viewer who is not the club's staff, and points to the seat finder", () => {
    renderWithApp(<SeatingPanel tournament={tournamentDto({ status: "in_progress" })} registrations={[]} />);

    expect(screen.getByRole("heading", { name: "Only the club's staff see the seating plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open seat finder" })).toHaveAttribute("href", "/tournament/t1/seats");
  });

  it("shows a finished tournament's seating without a way to change it", async () => {
    mockSeating(seatingDto({ ...night, readOnly: true }));
    renderWithApp(<SeatingPanel tournament={tournamentDto({ status: "completed", viewer: MANAGER_VIEW })} registrations={[]} />);

    expect(await screen.findByRole("group", { name: "Table 1: 2 of 9 seats taken" })).toBeInTheDocument();
    expect(screen.getByText("The tournament is over: the seating is shown as it was left.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Seat 1: Alice/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add tables" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Table 1 options" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Seat Cara Lee at random" })).not.toBeInTheDocument();
  });

  it("follows the seating every 10 seconds while the panel is open, and stops when it closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reads = countSeatingReads(seatingDto(night));
    const { unmount } = renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);
    await screen.findByRole("group", { name: "Table 1: 2 of 9 seats taken" });
    expect(reads.asked).toBe(1);

    await vi.advanceTimersByTimeAsync(10_100);
    expect(reads.asked).toBe(2);

    unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads.asked).toBe(2);
  });

  it("reads a finished tournament's seating once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reads = countSeatingReads(seatingDto({ ...night, readOnly: true }));
    renderWithApp(<SeatingPanel tournament={tournamentDto({ status: "completed", viewer: MANAGER_VIEW })} registrations={[]} />);
    await screen.findByRole("group", { name: "Table 1: 2 of 9 seats taken" });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads.asked).toBe(1);
  });
});

describe("SeatingPanel: setting up", () => {
  const empty = seatingDto({
    unseated: Array.from({ length: 22 }, (_, i) => ({ id: `r${i}`, name: `Player ${String(i).padStart(2, "0")}`, paid: i >= 4 })),
  });

  it("offers the one-tap setup with the tables it suggests for the players still in", async () => {
    mockSeating(empty);
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    expect(await screen.findByRole("heading", { name: "No tables yet" })).toBeInTheDocument();
    expect(screen.getByText("22 players still in. Start with 3 tables: 8 / 7 / 7.")).toBeInTheDocument();
  });

  it("previews the tables for the seats chosen, leaves unpaid players out when asked, and shows who sits where", async () => {
    mockSeating(empty);
    const after = seatingDto({ tables: [{ id: "tA", number: 1, seats: 8, seated: { 3: { id: "r4", name: "Player 04" } } }] });
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/setup", () =>
      HttpResponse.json(seatingMutation(after, [seatMove("r9", "Zed", null, seatRef("tA", 1, 1), "draw"), seatMove("r4", "Player 04", null, seatRef("tA", 1, 3), "draw")], { excludedUnconfirmed: 4 }), { status: 201 }),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Set up tables & draw seats" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up tables & draw seats" });
    expect(within(dialog).getByTestId("setup-preview")).toHaveTextContent("3 tables: 8 / 7 / 7");
    await user.click(within(dialog).getByRole("button", { name: "6 seats" }));
    expect(within(dialog).getByRole("button", { name: "6 seats" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByTestId("setup-preview")).toHaveTextContent("4 tables: 6 / 6 / 5 / 5");
    for (let i = 0; i < 4; i++) await user.click(within(dialog).getByRole("button", { name: "More seats" }));
    expect(within(dialog).getByLabelText("Seats per table")).toHaveValue("10");
    expect(within(dialog).getByRole("button", { name: "More seats" })).toBeDisabled();
    expect(within(dialog).getByTestId("setup-preview")).toHaveTextContent("3 tables: 8 / 7 / 7");
    await user.click(within(dialog).getByRole("switch", { name: "Include 4 unpaid players" }));
    expect(within(dialog).getByTestId("setup-preview")).toHaveTextContent("2 tables: 9 / 9");
    await user.click(within(dialog).getByRole("button", { name: "Set up & draw seats" }));

    await waitFor(() => expect(bodies).toEqual([{ seatCount: 10, tableCount: 2, includeUnconfirmed: false }]));
    const moves = await screen.findByRole("dialog", { name: "Seats drawn" });
    expect(within(moves).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Player 04 →  to Table 1, Seat 3", "Zed →  to Table 1, Seat 1"]);
    expect(within(moves).getByText("4 unpaid players were left out: seat them once they have paid.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Set up tables & draw seats" })).not.toBeInTheDocument();
  });

  it("keeps the setup open with the refusal when the server says no", async () => {
    mockSeating(empty);
    recordWrite("post", "/api/tournaments/t1/seating/setup", () => apiError(409, "TABLES_EXIST", "Tables are already set up"));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Set up tables & draw seats" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Set up & draw seats" }));

    expect(await screen.findByText("Could not set up the tables")).toBeInTheDocument();
    expect(screen.getByText("Tables are already set up")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Set up tables & draw seats" })).toBeInTheDocument();
  });

  it("adds tables numbered after the highest, archived ones included", async () => {
    mockSeating(seatingDto({ ...night, tables: [...(night.tables ?? []), { id: "tOld", number: 3, status: "broken" }] }));
    const bodies = recordWrite("post", "/api/tournaments/t1/tables", () => HttpResponse.json(seatingMutation(seatingDto(night)), { status: 201 }));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Add tables" }));
    const dialog = await screen.findByRole("dialog", { name: "Add tables" });
    expect(within(dialog).getByText("Adds Table 4 (9 seats)")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "More tables" }));
    expect(within(dialog).getByText("Adds Tables 4 to 5 (9 seats each)")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add tables" }));

    await waitFor(() => expect(bodies).toEqual([{ count: 2, seatCount: 9, shape: "oval" }]));
    expect(await screen.findByText("2 tables added")).toBeInTheDocument();
  });
});

describe("SeatingPanel: drawing seats", () => {
  it("seats everyone waiting in one tap, holding the buttons while it saves", async () => {
    mockSeating(seatingDto(night));
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/draw", async () => {
      await delay(100);
      return HttpResponse.json(seatingMutation(seatingDto({ tables: night.tables }), [seatMove("r3", "Cara Lee", null, seatRef("tB", 2, 1), "draw")]));
    });
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByTestId("seat-waiting"));
    expect(screen.getByTestId("seat-waiting")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Add tables" })).toHaveAttribute("aria-disabled", "true");

    const moves = await screen.findByRole("dialog", { name: "Seats drawn" });
    expect(within(moves).getByText("Table 2, Seat 1")).toBeInTheDocument();
    expect(bodies).toEqual([{ scope: "unseated", includeUnconfirmed: true }]);
  });

  it("leaves unpaid players waiting with Paid players only", async () => {
    mockSeating(seatingDto(night));
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/draw", () => HttpResponse.json(seatingMutation(seatingDto(night))));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    expect(await screen.findByTestId("seat-waiting")).toHaveTextContent("Seat 2 waiting");
    await user.click(screen.getByRole("switch", { name: "Paid players only" }));
    expect(screen.getByTestId("seat-waiting")).toHaveTextContent("Seat 1 waiting");
    await user.click(screen.getByTestId("seat-waiting"));

    await waitFor(() => expect(bodies).toEqual([{ scope: "unseated", includeUnconfirmed: false }]));
    expect(await screen.findByText("Everyone is seated")).toBeInTheDocument();
  });

  it("keeps Paid players only for the tournament when the panel is left and opened again, or the page reloads (TDN3-PAIDONLY-RESET)", async () => {
    mockSeating(seatingDto(night));
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/draw", () => HttpResponse.json(seatingMutation(seatingDto(night))));
    const user = userEvent.setup();
    const first = renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);
    await user.click(await screen.findByRole("switch", { name: "Paid players only" }));
    first.unmount();

    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);
    expect(await screen.findByRole("switch", { name: "Paid players only" })).toBeChecked();
    expect(screen.getByTestId("seat-waiting")).toHaveTextContent("Seat 1 waiting");
    await user.click(screen.getByTestId("seat-waiting"));
    await waitFor(() => expect(bodies).toEqual([{ scope: "unseated", includeUnconfirmed: false }]));
  });

  it("says how many seats are missing when the tables are full", async () => {
    mockSeating(seatingDto(night));
    recordWrite("post", "/api/tournaments/t1/seating/draw", () => apiError(409, "INSUFFICIENT_SEATS", "Need 2 more seats: add a table", { needed: 4, available: 2 }));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByTestId("seat-waiting"));

    expect(await screen.findByText("Could not draw seats")).toBeInTheDocument();
    expect(screen.getByText("Need 2 more seats — add a table?")).toBeInTheDocument();
  });

  it("redraws everyone only once confirmed", async () => {
    mockSeating(seatingDto(night));
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/draw", () =>
      HttpResponse.json(seatingMutation(seatingDto(night), [seatMove("r1", "Alice Smith", seatRef("tA", 1, 1), seatRef("tB", 2, 5), "redraw")])),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Redraw everyone" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Redraw every seat?" });
    expect(confirm).toHaveTextContent("Everyone still in (5 players) gets a new random seat.");
    expect(bodies).toEqual([]);
    await user.click(within(confirm).getByRole("button", { name: "Redraw seats" }));

    const moves = await screen.findByRole("dialog", { name: "Seats redrawn" });
    expect(within(moves).getByText("from Table 1, Seat 1")).toBeInTheDocument();
    expect(bodies).toEqual([{ scope: "all", includeUnconfirmed: true }]);
  });

  it("shows the change at once and refreshes the rest of the tournament behind it", async () => {
    mockSeating(seatingDto(night));
    const after = seatingDto({ tables: night.tables, unseated: [{ id: "r5", name: "Dan Wu", paid: false }] });
    recordWrite("post", "/api/tournaments/t1/seating/draw", () => HttpResponse.json(seatingMutation(after, [seatMove("r3", "Cara Lee", null, seatRef("tB", 2, 1), "draw")])));
    const user = userEvent.setup();
    const { queryClient } = renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);
    queryClient.setQueryData(qk.tournaments.publicSeating("t1"), { stale: true });

    await user.click(await screen.findByRole("button", { name: "Seat Cara Lee at random" }));

    await waitFor(() => expect(queryClient.getQueryState(qk.tournaments.publicSeating("t1"))?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(qk.tournaments.seating("t1"))?.data).toBeDefined();
  });
});
