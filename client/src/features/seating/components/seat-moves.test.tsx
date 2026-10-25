import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { MANAGER_VIEW, registrationDto, tournamentDto } from "@test/helpers/dto";
import { recordRequests } from "@test/helpers/requests";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { mockSeating, recordWrite, seatingDto, seatingMutation, seatMove, seatRef, type SeatingSpec } from "@test/helpers/seating-dto";
import { SeatingPanel } from "./seating-panel";

const tournament = tournamentDto({ status: "in_progress", viewer: MANAGER_VIEW });

const night: SeatingSpec = {
  tables: [
    { id: "tA", number: 1, seats: 6, seated: { 1: { id: "r1", name: "Alice Smith" }, 2: { id: "r2", name: "Bob Jones" } } },
    { id: "tB", number: 2, seats: 6, seated: { 4: { id: "r4", name: "Eve Brown" } } },
  ],
  unseated: [{ id: "r3", name: "Cara Lee" }],
};

const table = (number: number) => screen.getByRole("group", { name: new RegExp(`^Table ${number}:`) });

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  mockSeating(seatingDto(night));
});

describe("SeatingPanel: moving players by hand", () => {
  it("moves a seated player to the empty seat tapped next", async () => {
    const after = seatingDto({
      ...night,
      tables: [
        { id: "tA", number: 1, seats: 6, seated: { 2: { id: "r2", name: "Bob Jones" } } },
        { id: "tB", number: 2, seats: 6, seated: { 3: { id: "r1", name: "Alice Smith" }, 4: { id: "r4", name: "Eve Brown" } } },
      ],
    });
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/assign", () => {
      mockSeating(after);
      return HttpResponse.json(seatingMutation(after, [seatMove("r1", "Alice Smith", seatRef("tA", 1, 1), seatRef("tB", 2, 3), "move")]));
    });
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Seat 1: Alice Smith" }));
    expect(screen.getByRole("button", { name: "Seat 1: Alice Smith" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Selected player" })).toHaveTextContent("Alice Smith · Table 1, Seat 1");
    await user.click(within(table(2)).getByRole("button", { name: "Seat 3, empty: move Alice Smith here" }));

    await waitFor(() => expect(bodies).toEqual([{ registrationId: "r1", tableId: "tB", seatNumber: 3, swap: false }]));
    expect(await screen.findByText("Player moved")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith → Table 2, Seat 3 (from Table 1, Seat 1)")).toBeInTheDocument();
    expect(within(table(2)).getByRole("button", { name: "Seat 3: Alice Smith" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Selected player" })).not.toBeInTheDocument();
  });

  it("swaps two seated players once confirmed", async () => {
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/assign", () =>
      HttpResponse.json(
        seatingMutation(seatingDto(night), [
          seatMove("r1", "Alice Smith", seatRef("tA", 1, 1), seatRef("tB", 2, 4), "swap"),
          seatMove("r4", "Eve Brown", seatRef("tB", 2, 4), seatRef("tA", 1, 1), "swap"),
        ]),
      ),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Seat 1: Alice Smith" }));
    await user.click(screen.getByRole("button", { name: "Seat 4: Eve Brown" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Swap Alice Smith and Eve Brown?" });
    expect(confirm).toHaveTextContent("Alice Smith goes to Table 2, Seat 4 and Eve Brown to Table 1, Seat 1.");
    expect(bodies).toEqual([]);
    await user.click(within(confirm).getByRole("button", { name: "Swap seats" }));

    await waitFor(() => expect(bodies).toEqual([{ registrationId: "r1", tableId: "tB", seatNumber: 4, swap: true }]));
    expect(await screen.findByText("Alice Smith and Eve Brown swapped seats.")).toBeInTheDocument();
  });

  it("seats a waiting player where the TD taps, and says what to do with a taken seat", async () => {
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/assign", () => HttpResponse.json(seatingMutation(seatingDto(night), [seatMove("r3", "Cara Lee", null, seatRef("tA", 1, 5), "move")])));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Cara Lee" }));
    expect(screen.getByRole("button", { name: "Cara Lee" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Selected player" })).toHaveTextContent("Cara Lee · waiting for a seat");
    expect(screen.queryByRole("button", { name: "Unseat" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Seat 2: Bob Jones" }));
    expect(screen.getByText("That seat is taken. Pick an empty seat for Cara Lee, or move Bob Jones first.")).toBeInTheDocument();
    await user.click(within(table(1)).getByRole("button", { name: "Seat 5, empty: move Cara Lee here" }));

    await waitFor(() => expect(bodies).toEqual([{ registrationId: "r3", tableId: "tA", seatNumber: 5, swap: false }]));
  });

  it("says to pick a player first when an empty seat is tapped with nobody picked up", async () => {
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(within(await screen.findByRole("group", { name: /^Table 1:/ })).getByRole("button", { name: "Seat 3, empty" }));

    expect(screen.getByText("Pick a player first (at their seat, or in the waiting list), then tap the empty seat.")).toBeInTheDocument();
  });

  it("unseats the player picked up, and puts a player down with Cancel", async () => {
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/unseat", () => HttpResponse.json(seatingMutation(seatingDto(night), [seatMove("r2", "Bob Jones", seatRef("tA", 1, 2), null, "unseat")])));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Seat 1: Alice Smith" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Selected player" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seat 1: Alice Smith" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Seat 2: Bob Jones" }));
    await user.click(screen.getByRole("button", { name: "Unseat" }));

    await waitFor(() => expect(bodies).toEqual([{ registrationId: "r2" }]));
    expect(await screen.findByText("Bob Jones left Table 1, Seat 2 and is waiting for a seat.")).toBeInTheDocument();
  });

  it("puts a mistaken unseat back from its toast, in the seat the player left (TDN4-UNSEAT-NO-UNDO)", async () => {
    const unseated = seatingDto({ ...night, version: "0000beef", tables: [{ ...night.tables![0], seated: { 1: { id: "r1", name: "Alice Smith" } } }, night.tables![1]], unseated: [...night.unseated!, { id: "r2", name: "Bob Jones" }] });
    recordWrite("post", "/api/tournaments/t1/seating/unseat", () => HttpResponse.json(seatingMutation(unseated, [seatMove("r2", "Bob Jones", seatRef("tA", 1, 2), null, "unseat")])));
    const back = recordWrite("post", "/api/tournaments/t1/seating/assign", () => HttpResponse.json(seatingMutation(seatingDto(night), [seatMove("r2", "Bob Jones", null, seatRef("tA", 1, 2), "move")])));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Seat 2: Bob Jones" }));
    await user.click(screen.getByRole("button", { name: "Unseat" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(back).toEqual([{ registrationId: "r2", tableId: "tA", seatNumber: 2, swap: false, expectedVersion: "0000beef" }]));
    expect(await screen.findByText("Move undone")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones is back at Table 1, Seat 2.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("says when a move cannot be undone because the seating changed since", async () => {
    const moved = seatingMutation(seatingDto({ ...night, version: "0000cafe" }), [seatMove("r1", "Alice Smith", seatRef("tA", 1, 1), seatRef("tB", 2, 3), "move")]);
    let answered = 0;
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/assign", () =>
      answered++ === 0 ? HttpResponse.json(moved) : apiError(409, "STALE_PLAN", "The seating changed", { seating: seatingDto(night) }),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Seat 1: Alice Smith" }));
    await user.click(within(table(2)).getByRole("button", { name: "Seat 3, empty: move Alice Smith here" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Could not undo")).toBeInTheDocument();
    expect(screen.getByText("Seating changed — refreshed")).toBeInTheDocument();
    expect(bodies[1]).toEqual({ registrationId: "r1", tableId: "tA", seatNumber: 1, swap: false, expectedVersion: "0000cafe" });
  });

  it("records a bust from the seat, offering the player's table-mates first as the eliminator (P4REV0-BUST-FROM-SEAT)", async () => {
    const registrations = [
      registrationDto("r1", "Alice Smith"),
      registrationDto("r2", "Bob Jones"),
      registrationDto("r3", "Cara Lee"),
      registrationDto("r4", "Eve Brown"),
    ];
    const sent: unknown[] = [];
    server.use(
      http.put("/api/registrations/r2", async ({ request }) => {
        sent.push(await request.json());
        mockSeating(seatingDto({ ...night, tables: [{ id: "tA", number: 1, seats: 6, seated: { 1: { id: "r1", name: "Alice Smith" } } }, night.tables![1]] }));
        return HttpResponse.json({ ...registrations[1], isEliminated: true });
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={registrations} />);

    await user.click(await screen.findByRole("button", { name: "Seat 2: Bob Jones" }));
    await user.click(within(screen.getByRole("region", { name: "Selected player" })).getByRole("button", { name: "Eliminate" }));
    const dialog = await screen.findByRole("dialog", { name: "Eliminate Player" });
    await user.click(within(dialog).getByRole("combobox", { name: "Knocked out by (optional)" }));
    const listbox = await screen.findByRole("listbox");
    // Bob's table-mate first, under their table; then everyone else still in.
    const options = within(listbox).getAllByRole("option");
    expect(["None", "Alice Smith", "Cara Lee", "Eve Brown"].map((name) => options.indexOf(within(listbox).getByRole("option", { name })))).toEqual([0, 1, 2, 3]);
    expect(within(listbox).getByRole("group", { name: "At Table 1" })).toHaveTextContent("Alice Smith");
    await user.click(within(listbox).getByRole("option", { name: "Alice Smith" }));
    await user.click(within(dialog).getByRole("button", { name: "Eliminate Player" }));

    await waitFor(() => expect(sent).toEqual([{ isEliminated: true, eliminatedBy: "p-r1" }]));
    expect(await screen.findByText("Player eliminated successfully")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selected player" })).not.toBeInTheDocument();
    expect(await within(table(1)).findByRole("button", { name: "Seat 2, empty" })).toBeInTheDocument();
  });

  it("takes a bust recorded from the seat back from its toast, and the player sits down again (TDN3-BUST-NO-UNDO)", async () => {
    const registrations = [registrationDto("r1", "Alice Smith"), registrationDto("r2", "Bob Jones")];
    const sent = recordRequests([["put", "/api/registrations/r2"]], ({ body }) => {
      const { isEliminated } = body as { isEliminated: boolean };
      // Out, Bob leaves his seat; back in, the server gives it back (it is still free).
      mockSeating(isEliminated ? seatingDto({ ...night, tables: [{ id: "tA", number: 1, seats: 6, seated: { 1: { id: "r1", name: "Alice Smith" } } }, night.tables![1]] }) : seatingDto(night));
      return HttpResponse.json({ ...registrations[1], isEliminated });
    }, ({ body }) => body);
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={registrations} />);

    await user.click(await screen.findByRole("button", { name: "Seat 2: Bob Jones" }));
    await user.click(within(screen.getByRole("region", { name: "Selected player" })).getByRole("button", { name: "Eliminate" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Eliminate Player" })).getByRole("button", { name: "Eliminate Player" }));
    const toasts = within(screen.getByTestId("notifications"));
    expect(await toasts.findByText("Player eliminated successfully")).toBeInTheDocument();
    expect(await within(table(1)).findByRole("button", { name: "Seat 2, empty" })).toBeInTheDocument();

    await user.click(toasts.getByRole("button", { name: "Undo" }));
    expect(await toasts.findByText("Elimination undone")).toBeInTheDocument();
    expect(sent).toEqual([{ isEliminated: true, eliminatedBy: null }, { isEliminated: false }]);
    expect(await within(table(1)).findByRole("button", { name: "Seat 2: Bob Jones" })).toBeInTheDocument();
  });

  it("seats a waiting player at random in one tap", async () => {
    const bodies = recordWrite("post", "/api/tournaments/t1/seating/draw", () => HttpResponse.json(seatingMutation(seatingDto(night), [seatMove("r3", "Cara Lee", null, seatRef("tB", 2, 6), "draw")])));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Seat Cara Lee at random" }));

    await waitFor(() => expect(bodies).toEqual([{ scope: "unseated", registrationIds: ["r3"], includeUnconfirmed: true }]));
    expect(within(await screen.findByRole("dialog", { name: "Seats drawn" })).getByText("Table 2, Seat 6")).toBeInTheDocument();
  });

  it("refreshes the seating when someone else took the seat first", async () => {
    let reads = 0;
    server.use(
      http.get("/api/tournaments/t1/seating", () => {
        reads += 1;
        return HttpResponse.json(seatingDto(night));
      }),
    );
    recordWrite("post", "/api/tournaments/t1/seating/assign", () => apiError(409, "SEAT_TAKEN", "That seat is taken: swap the two players instead", { occupantRegistrationId: "r9" }));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    await user.click(await screen.findByRole("button", { name: "Seat 1: Alice Smith" }));
    await user.click(within(table(2)).getByRole("button", { name: "Seat 1, empty: move Alice Smith here" }));

    expect(await screen.findByText("Could not move the player")).toBeInTheDocument();
    expect(screen.getByText("Seat taken — tap Swap")).toBeInTheDocument();
    await waitFor(() => expect(reads).toBe(2));
  });
});
