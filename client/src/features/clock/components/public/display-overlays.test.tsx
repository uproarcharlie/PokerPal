import { act, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { publicSeatingDto } from "@test/helpers/seating-dto";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { SEATS_PAGE_MS, seatPages, SeatingOverlay } from "./display-overlays";

/** A field of `count` players, two seats a table, named "Player 01"… so they sort in seat order. */
function field(count: number) {
  const tables = Array.from({ length: Math.ceil(count / 2) }, (_, t) => ({
    id: `t${t + 1}`,
    number: t + 1,
    seats: 2,
    seated: Object.fromEntries(
      [1, 2].flatMap((seat) => {
        const n = t * 2 + seat;
        return n <= count ? [[seat, { id: `r${n}`, name: `Player ${String(n).padStart(2, "0")}` }]] : [];
      }),
    ),
  }));
  return publicSeatingDto({ tables });
}

const names = () => within(screen.getByTestId("seat-list")).getAllByRole("listitem").map((item) => item.firstChild?.textContent);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockSignedOut();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the TV's seats layer (TDN4-TV-SEATS-OVERFLOW)", () => {
  it("fits up to 15 rows a column, then pages the rest", () => {
    expect(seatPages(63, 3)).toEqual({ rows: 15, perPage: 45, pages: 2 });
    expect(seatPages(63, 2)).toEqual({ rows: 15, perPage: 30, pages: 3 });
    expect(seatPages(30, 3)).toEqual({ rows: 10, perPage: 30, pages: 1 });
    expect(seatPages(5, 1)).toEqual({ rows: 8, perPage: 8, pages: 1 });
  });

  it("shows a field too big for the screen a page at a time, turning by itself, so every player sees their seat", async () => {
    server.use(http.get("/api/public/tournaments/t1/seating", () => HttpResponse.json(field(20))));
    renderWithApp(<SeatingOverlay tournamentId="t1" strip={<span>Level 1 · 12:00</span>} />);

    // One column (a phone's width in the test): 15 a page.
    await screen.findByTestId("seat-list");
    expect(names()).toHaveLength(15);
    expect(names()[0]).toBe("Player 01");
    expect(screen.getByTestId("seats-page")).toHaveTextContent("Page 1/2");

    await act(() => vi.advanceTimersByTimeAsync(SEATS_PAGE_MS));
    expect(names()).toEqual(["Player 16", "Player 17", "Player 18", "Player 19", "Player 20"]);
    expect(screen.getByTestId("seats-page")).toHaveTextContent("Page 2/2");

    await act(() => vi.advanceTimersByTimeAsync(SEATS_PAGE_MS));
    expect(names()[0]).toBe("Player 01");
  });

  it("shows a field that fits on one page, without paging", async () => {
    server.use(http.get("/api/public/tournaments/t1/seating", () => HttpResponse.json(field(6))));
    renderWithApp(<SeatingOverlay tournamentId="t1" strip={<span>Level 1 · 12:00</span>} />);

    await screen.findByTestId("seat-list");
    expect(names()).toHaveLength(6);
    expect(screen.queryByTestId("seats-page")).not.toBeInTheDocument();
  });
});
