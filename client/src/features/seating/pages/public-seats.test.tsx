import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { publicSeatingDto, type SeatingSpec } from "@test/helpers/seating-dto";
import PublicSeatsPage from "./public-seats";

const drawn: SeatingSpec = {
  tables: [
    { id: "tA", number: 1, seats: 6, seated: { 2: { id: "r1", name: "Aroha Ngata" }, 5: { id: "r2", name: "Mark Arnold" } } },
    { id: "tC", number: 3, name: "Feature table", seats: 8, seated: { 7: { id: "r3", name: "Zoë Brown" } } },
  ],
  unseated: [{ id: "r4", name: "Late Larry" }],
};

const showPage = () => renderWithApp(<PublicSeatsPage />, { path: "/tournament/t1/seats", route: "/tournament/:id/seats" });

function mockPublicSeating(body: ReturnType<typeof publicSeatingDto> | (() => Response)) {
  server.use(http.get("/api/public/tournaments/t1/seating", () => (typeof body === "function" ? body() : HttpResponse.json(body))));
}

beforeEach(() => {
  mockSignedOut();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Find your seat", () => {
  it("loads, then finds a player's table and seat as they type their name", async () => {
    mockPublicSeating(publicSeatingDto(drawn));
    const user = userEvent.setup();
    showPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading the seats");
    expect(await screen.findByRole("heading", { level: 1, name: "Find your seat" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Friday Freezeout" })).toHaveAttribute("href", "/tournament/t1");
    const search = screen.getByLabelText("Type your name");
    expect(search).toHaveFocus();

    await user.type(search, "ar");
    const results = within(screen.getByTestId("seat-results")).getAllByRole("listitem");
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveTextContent(/Aroha Ngata\s*Table 1 · Seat 2\s*Show my seat$/);
    expect(results[1]).toHaveTextContent(/Mark Arnold\s*Table 1 · Seat 5\s*Show my seat$/);

    await user.clear(search);
    await user.type(search, "zoe");
    expect(within(screen.getByTestId("seat-results")).getByText("Feature table · Seat 7")).toBeInTheDocument();
    expect(within(screen.getByTestId("seat-results")).getByText("Table 3")).toBeInTheDocument();
  });

  it("rings the seats it found on the table plan", async () => {
    mockPublicSeating(publicSeatingDto(drawn));
    const user = userEvent.setup();
    showPage();

    await user.type(await screen.findByLabelText("Type your name"), "mark");
    const plan = screen.getByRole("group", { name: "Table 1: 2 of 6 seats taken" });
    expect(within(plan).getByText("Seat 5: Mark Arnold").parentElement?.innerHTML).toContain("ring-accent");
    expect(within(plan).getByText("Seat 2: Aroha Ngata").parentElement?.innerHTML).not.toContain("ring-accent");
  });

  it("says when nobody seated has the name, and that some players are still waiting", async () => {
    mockPublicSeating(publicSeatingDto(drawn));
    const user = userEvent.setup();
    showPage();

    await user.type(await screen.findByLabelText("Type your name"), "larry");

    expect(screen.getByTestId("seat-results")).toHaveTextContent("Nobody seated has that name. 1 player is still waiting for a seat: ask the tournament director.");
  });

  it("lists every table: the plan on a wide screen", async () => {
    mockPublicSeating(publicSeatingDto(drawn));
    showPage();

    const plan = await screen.findByRole("group", { name: "Feature table: 1 of 8 seats taken" });
    expect(within(plan).getAllByRole("listitem")).toHaveLength(8);
    expect(within(plan).getByText("Seat 7: Zoë Brown")).toBeInTheDocument();
    expect(within(plan).getByText("Seat 1, empty")).toBeInTheDocument();
    expect(within(plan).queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws the tables in their shape on a phone too (round 5), with a plain list one tap away", async () => {
    screenWidth(390);
    mockPublicSeating(publicSeatingDto({ ...drawn, tables: [{ ...drawn.tables![0], shape: "rectangle" }, drawn.tables![1]] }));
    const user = userEvent.setup();
    showPage();

    const plan = await screen.findByRole("group", { name: "Table 1: 2 of 6 seats taken" });
    expect(plan).toHaveAttribute("data-shape", "rectangle");
    expect(screen.getByRole("group", { name: "Feature table: 1 of 8 seats taken" })).toHaveAttribute("data-shape", "oval");

    await user.click(screen.getByRole("button", { name: "List" }));
    const seats = screen.getByRole("list", { name: "Table 1 seats" });
    const rows = within(seats).getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent(/^Seat 1\s*Empty$/);
    expect(rows[1]).toHaveTextContent(/^Seat 2.*Aroha Ngata$/);
    expect(rows[4]).toHaveTextContent(/^Seat 5.*Mark Arnold$/);
    expect(screen.queryByRole("group", { name: /seats taken/ })).not.toBeInTheDocument();
  });

  it("takes a player from their result to their table's drawing, their seat ringed", async () => {
    screenWidth(390);
    mockPublicSeating(publicSeatingDto(drawn));
    const scrolled: string[] = [];
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this.id);
    });
    const user = userEvent.setup();
    showPage();

    await user.type(await screen.findByLabelText("Type your name"), "zoe");
    await user.click(screen.getByRole("button", { name: "Show my seat: Zoë Brown, Feature table" }));

    expect(scrolled).toEqual(["seat-finder-table-3"]);
    expect(document.getElementById("seat-finder-table-3")).toHaveFocus();
    const plan = screen.getByRole("group", { name: "Feature table: 1 of 8 seats taken" });
    expect(within(plan).getByText("Seat 7: Zoë Brown").parentElement?.innerHTML).toContain("ring-accent");
    scrollIntoView.mockRestore();
  });

  it("says the seats have not been drawn yet", async () => {
    mockPublicSeating(publicSeatingDto({ unseated: [{ id: "r1", name: "Aroha" }] }));
    showPage();

    expect(await screen.findByRole("heading", { name: "Seats haven't been drawn yet" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Type your name")).not.toBeInTheDocument();
  });

  it("says the tournament was not found", async () => {
    mockPublicSeating(() => apiError(404, "NOT_FOUND", "Tournament not found"));
    showPage();

    expect(await screen.findByRole("heading", { name: "Tournament not found" })).toBeInTheDocument();
  });

  it("says when the seats could not be loaded, and tries again", async () => {
    let asked = 0;
    mockPublicSeating(() => {
      asked += 1;
      return asked === 1 ? apiError(500, "INTERNAL", "Something broke") : HttpResponse.json(publicSeatingDto(drawn));
    });
    const user = userEvent.setup();
    showPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("The seats could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Type your name")).toBeInTheDocument();
  });

  it("keeps the tab out of search engines and names the tournament", async () => {
    mockPublicSeating(publicSeatingDto(drawn));
    showPage();

    await screen.findByLabelText("Type your name");
    expect(document.title).toBe("Find your seat: Friday Freezeout | LovePoker.club");
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  it("follows the seats every 15 seconds while the tournament runs, and stops once it is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status: SeatingSpec["tournamentStatus"] = "in_progress";
    let asked = 0;
    mockPublicSeating(() => {
      asked += 1;
      return HttpResponse.json(publicSeatingDto({ ...drawn, tournamentStatus: status }));
    });
    showPage();
    await screen.findByLabelText("Type your name");

    await vi.advanceTimersByTimeAsync(15_100);
    expect(asked).toBe(2);
    status = "completed";
    await vi.advanceTimersByTimeAsync(15_100);
    await waitFor(() => expect(asked).toBe(3));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toBe(3);
  });
});
