import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { SeatingDto } from "@shared/api/seating";
import { qk } from "@/lib/api/query-keys";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { seatingDto, type SeatingSpec } from "@test/helpers/seating-dto";
import { newArrivals, useAutoSeatNotices } from "./auto-seat-notices";

const before: SeatingSpec = {
  tables: [{ id: "tA", number: 1, seats: 4, seated: { 1: { id: "r1", name: "Alice" }, 2: { id: "r2", name: "Bob" } } }],
  unseated: [{ id: "r3", name: "Cara" }],
};

describe("newArrivals", () => {
  it("are the players in neither the tables nor the waiting list before: seated where auto-seat put them, or waiting", () => {
    const after = seatingDto({
      tables: [{ id: "tA", number: 1, seats: 4, seated: { 1: { id: "r1", name: "Alice" }, 2: { id: "r2", name: "Bob" }, 3: { id: "r3", name: "Cara" }, 4: { id: "r4", name: "Dan" } } }],
      unseated: [{ id: "r5", name: "Eve" }],
    });

    expect(newArrivals(seatingDto(before), after)).toEqual([
      { registrationId: "r4", name: "Dan", seat: { tableId: "tA", tableName: "Table 1", seatNumber: 4 } },
      { registrationId: "r5", name: "Eve", seat: null },
    ]);
  });

  it("are nobody when the seating did not gain a player (a draw of the waiting, a bust)", () => {
    const drawn = seatingDto({ tables: [{ id: "tA", number: 1, seats: 4, seated: { 1: { id: "r1", name: "Alice" }, 3: { id: "r3", name: "Cara" } } }] });
    expect(newArrivals(seatingDto(before), drawn)).toEqual([]);
  });
});

/** The TD's page as the notices see it: the hook mounted, and nothing else. */
function Notices() {
  useAutoSeatNotices("t1");
  return null;
}

describe("useAutoSeatNotices", () => {
  let current: SeatingDto;
  beforeEach(() => {
    mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
    current = seatingDto(before);
    server.use(http.get("/api/tournaments/t1/seating", () => HttpResponse.json(current)));
  });

  /** The page's own poll brings a new list of registrations: the notices ask for the seating again. */
  const registrationsArrive = (queryClient: ReturnType<typeof renderWithApp>["queryClient"], ids: string[]) =>
    queryClient.setQueryData(
      qk.tournaments.registrations("t1"),
      ids.map((id) => ({ id, isEliminated: false })),
    );

  it("toasts a late registration auto-seat sat down, as the page's registrations show someone new", async () => {
    const { queryClient } = renderWithApp(<Notices />);
    await waitFor(() => expect(queryClient.getQueryData(qk.tournaments.seating("t1"))).toBeDefined());

    current = seatingDto({ ...before, tables: [{ ...before.tables![0], seated: { ...before.tables![0].seated, 4: { id: "r4", name: "Test Player 16" } } }] });
    registrationsArrive(queryClient, ["r1", "r2", "r3", "r4"]);

    expect(await screen.findByText("Player seated")).toBeInTheDocument();
    expect(screen.getByText("Test Player 16 seated at Table 1, Seat 4.")).toBeInTheDocument();
  });

  it("toasts a late registration left waiting with every table full", async () => {
    const full: SeatingSpec = { tables: [{ id: "tA", number: 1, seats: 2, seated: { 1: { id: "r1", name: "Alice" }, 2: { id: "r2", name: "Bob" } } }] };
    current = seatingDto(full);
    const { queryClient } = renderWithApp(<Notices />);
    await waitFor(() => expect(queryClient.getQueryData(qk.tournaments.seating("t1"))).toBeDefined());

    current = seatingDto({ ...full, unseated: [{ id: "r9", name: "Test Player 17" }] });
    registrationsArrive(queryClient, ["r1", "r2", "r9"]);

    expect(await screen.findByText("Every table is full")).toBeInTheDocument();
    expect(screen.getByText("Test Player 17 is waiting for a seat: open a table on the Seats tab.")).toBeInTheDocument();
  });

  it("leaves a registration this device made to its own screen", async () => {
    const { queryClient } = renderWithApp(<Notices />);
    await waitFor(() => expect(queryClient.getQueryData(qk.tournaments.seating("t1"))).toBeDefined());
    await queryClient.getMutationCache().build(queryClient, { mutationFn: () => Promise.resolve({ id: "r4", seating: { status: "seated" } }) }).execute(undefined);

    current = seatingDto({ ...before, tables: [{ ...before.tables![0], seated: { ...before.tables![0].seated, 4: { id: "r4", name: "Desk Dana" } } }] });
    registrationsArrive(queryClient, ["r1", "r2", "r3", "r4"]);

    await waitFor(() => expect(queryClient.getQueryData<SeatingDto>(qk.tournaments.seating("t1"))?.seatByRegistrationId.r4).toBeDefined());
    expect(screen.queryByText("Player seated")).not.toBeInTheDocument();
  });
});
