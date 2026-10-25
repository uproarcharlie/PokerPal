import { act, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { publicSeatingDto, type TableSpec } from "@test/helpers/seating-dto";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import type { PublicSeatingDto } from "@shared/api/seating";
import { NEW_SEAT_MS, payoutsLayout, SEATS_PAGE_MS, SeatingOverlay, tableGrid } from "./display-overlays";

/** `tables` tables of 9, each with `perTable` players named "P01 Smith"…, rectangles. */
function room(tables: number, perTable = 9): PublicSeatingDto {
  const spec: TableSpec[] = Array.from({ length: tables }, (_, t) => ({
    id: `t${String(t + 1)}`,
    number: t + 1,
    seats: 9,
    shape: "rectangle",
    seated: Object.fromEntries(
      Array.from({ length: perTable }, (_, s) => {
        const n = t * perTable + s + 1;
        return [s + 1, { id: `r${String(n)}`, name: `P${String(n).padStart(2, "0")} Smith` }];
      }),
    ),
  }));
  return publicSeatingDto({ tables: spec });
}

const TV = { width: 1920, height: 1080 };

function showSeats(seating: () => PublicSeatingDto, size = TV) {
  server.use(http.get("/api/public/tournaments/t1/seating", () => HttpResponse.json(seating())));
  return renderWithApp(<SeatingOverlay tournamentId="t1" strip={<span>Level 1 · 12:00</span>} size={size} padding={{}} />);
}

const tablesShown = () => within(screen.getByTestId("seat-tables")).getAllByTestId("tv-table").map((table) => table.querySelector("figcaption")?.textContent);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockSignedOut();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the TV's seats layer as tables (round 5, item 18)", () => {
  it("draws every table as large as fits, all on one screen while their names can be read across the room", () => {
    const two = tableGrid(2, 1920, 972);
    expect(two).toMatchObject({ pages: 1, perPage: 2 });
    // Each table drawing as large as the screen allows: well over a third of its height.
    expect(two.scale * 344).toBeGreaterThan(0.4 * 972);
    const six = tableGrid(6, 1920, 972);
    expect(six).toMatchObject({ pages: 1, perPage: 6 });
    // A name is at least 2.2% of the screen's height.
    expect(six.scale * 19).toBeGreaterThanOrEqual(0.022 * 972);
  });

  it("pages a big room rather than drawing its names too small to read", () => {
    const grid = tableGrid(14, 1280, 648);
    expect(grid.pages).toBeGreaterThan(1);
    expect(grid.scale * 19).toBeGreaterThanOrEqual(Math.max(14, 0.022 * 648));
    // A phone held upright: one table across.
    expect(tableGrid(3, 390, 700).columns).toBe(1);
  });

  it("sizes every place of the payouts to fit the screen, in two columns for a long list on a wide one", () => {
    const places = Array.from({ length: 18 }, (_, i) => `${String(i + 1)}th  $1,000`);
    const wide = payoutsLayout(places, 1920, 972);
    expect(wide.columns).toBe(2);
    expect(wide.size * 1.45 * 9).toBeLessThanOrEqual(972);
    expect(payoutsLayout(places.slice(0, 3), 1920, 972)).toEqual({ columns: 1, size: 0.08 * 972 });
  });

  it("shows the tables in their shape with each player at their seat, and the list by name for screen readers", async () => {
    showSeats(() => room(2, 3));
    await screen.findByTestId("seat-tables");
    expect(tablesShown()).toEqual(["Table 1", "Table 2"]);
    const first = screen.getAllByTestId("tv-table")[0];
    expect(within(first).getByText("P01 S.")).toBeInTheDocument();
    expect(within(screen.getByTestId("seat-list")).getByText("P01 Smith").nextSibling).toHaveTextContent("Table 1, Seat 1");
    expect(screen.queryByTestId("seats-page")).not.toBeInTheDocument();
  });

  it("shows a room too big for one screen a page of tables at a time, turning by itself", async () => {
    showSeats(() => room(14), { width: 1280, height: 720 });
    await screen.findByTestId("seat-tables");
    const perPage = tablesShown().length;
    expect(perPage).toBeLessThan(14);
    expect(tablesShown()[0]).toBe("Table 1");
    expect(screen.getByTestId("seats-page")).toHaveTextContent(/^Page 1\/\d$/);

    await act(() => vi.advanceTimersByTimeAsync(SEATS_PAGE_MS));
    expect(tablesShown()[0]).toBe(`Table ${String(perPage + 1)}`);
  });

  it("lights up a player just seated or moved, for a while, never on the first look", async () => {
    let seating = room(2, 2);
    showSeats(() => seating);
    await screen.findByTestId("seat-tables");
    expect(document.querySelectorAll("[data-new]")).toHaveLength(0);

    // A late arrival sits at Table 2, Seat 3 (the TV asks again every few seconds).
    seating = publicSeatingDto({
      tables: [
        { id: "t1", number: 1, seats: 9, shape: "rectangle", seated: { 1: { id: "r1", name: "P01 Smith" }, 2: { id: "r2", name: "P02 Smith" } } },
        { id: "t2", number: 2, seats: 9, shape: "rectangle", seated: { 1: { id: "r3", name: "P03 Smith" }, 2: { id: "r4", name: "P04 Smith" }, 3: { id: "r5", name: "Late Arrival" } } },
      ],
    });
    await act(() => vi.advanceTimersByTimeAsync(16_000));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-new]")).toHaveLength(1));
    expect(document.querySelector("[data-new]")).toHaveTextContent("3Late A.");

    await act(() => vi.advanceTimersByTimeAsync(NEW_SEAT_MS + 1000));
    expect(document.querySelectorAll("[data-new]")).toHaveLength(0);
  });

  it("says when the seats have not been drawn", async () => {
    showSeats(() => publicSeatingDto({ tables: [] }));
    expect(await screen.findByText("Seats haven't been drawn yet")).toBeInTheDocument();
  });
});
