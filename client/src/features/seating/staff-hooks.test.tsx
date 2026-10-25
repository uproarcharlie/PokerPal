import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { apiError, createTestQueryClient } from "@test/helpers/web";
import { mockSeating, recordWrite, seatingDto, seatingMutation } from "@test/helpers/seating-dto";
import type { ActivityDto } from "@shared/api/public";
import { server } from "@test/msw/server";
import { publicSeatingInterval } from "./hooks";
import { seatingInterval, staleSeating, useSeatingBusy, useSeatingMutations } from "./staff-hooks";
import { returnSeatText, useReturnSeat, type ReturnSeat } from "./waiting-seat";

function renderMutations(before = seatingDto()) {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  queryClient.setQueryData(qk.tournaments.seating("t1"), before);
  queryClient.setQueryData(qk.tournaments.detail("t1"), { id: "t1" });
  for (const key of [qk.tournaments.registrations("t1"), qk.tournaments.prizePool("t1"), qk.tournaments.activity("t1", { limit: 50 }), qk.tournaments.publicSeating("t1"), qk.tournaments.display("t1")]) {
    queryClient.setQueryData(key, {});
  }
  const { result } = renderHook(() => useSeatingMutations("t1"), { wrapper });
  return { queryClient, result };
}

const draw = { kind: "draw", input: { scope: "unseated", includeUnconfirmed: true } } as const;

const invalidated = (queryClient: QueryClient, key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated;

describe("useSeatingMutations", () => {
  it("shows the seating the change answers with, and refreshes only what a seat change touches (R2-CQ-05)", async () => {
    const tables = [{ id: "tA", number: 1, seated: { 1: { id: "r1", name: "Ann" } } }];
    const after = seatingDto({ version: "feedf00d", tables });
    recordWrite("post", "/api/tournaments/t1/seating/draw", () => HttpResponse.json(seatingMutation(after)));
    const { queryClient, result } = renderMutations(seatingDto({ tables: [{ id: "tA", number: 1 }] }));

    await act(() => result.current.mutateAsync(draw));

    expect(queryClient.getQueryData(qk.tournaments.seating("t1"))).toEqual(after);
    expect(invalidated(queryClient, qk.tournaments.seating("t1"))).toBe(false);
    expect(invalidated(queryClient, qk.tournaments.activity("t1", { limit: 50 }))).toBe(true);
    expect(invalidated(queryClient, qk.tournaments.publicSeating("t1"))).toBe(true);
    // The same tables in play: the TV's figures did not change.
    expect(invalidated(queryClient, qk.tournaments.display("t1"))).toBe(false);
    for (const key of [qk.tournaments.detail("t1"), qk.tournaments.registrations("t1"), qk.tournaments.prizePool("t1")]) expect(invalidated(queryClient, key)).toBe(false);
  });

  it("refreshes the TV's table count when the tables in play change", async () => {
    const after = seatingDto({ tables: [{ id: "tA", number: 1 }, { id: "tB", number: 2 }] });
    recordWrite("post", "/api/tournaments/t1/tables", () => HttpResponse.json(seatingMutation(after), { status: 201 }));
    const { queryClient, result } = renderMutations(seatingDto({ tables: [{ id: "tA", number: 1 }] }));

    await act(() => result.current.mutateAsync({ kind: "addTables", input: { count: 1, seatCount: 9 } }));

    expect(invalidated(queryClient, qk.tournaments.display("t1"))).toBe(true);
    expect(invalidated(queryClient, qk.tournaments.detail("t1"))).toBe(false);
  });

  it("shows the fresh seating a STALE_PLAN refusal carries", async () => {
    const fresh = seatingDto({ version: "c0ffee00" });
    recordWrite("post", "/api/tournaments/t1/seating/balance", () => apiError(409, "STALE_PLAN", "The seating changed", { seating: fresh }));
    const { queryClient, result } = renderMutations();

    await act(() => result.current.mutateAsync({ kind: "balance", input: { expectedVersion: "0badc0de" } }).catch(() => undefined));

    expect(queryClient.getQueryData(qk.tournaments.seating("t1"))).toEqual(fresh);
  });

  it("refreshes the seating after a conflict, and the whole tournament once it has closed", async () => {
    recordWrite("post", "/api/tournaments/t1/seating/draw", () => apiError(409, "SEAT_CONFLICT", "Someone else took that seat"));
    const { queryClient, result } = renderMutations();

    await act(() => result.current.mutateAsync(draw).catch(() => undefined));
    await waitFor(() => expect(queryClient.getQueryState(qk.tournaments.seating("t1"))?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(qk.tournaments.detail("t1"))?.isInvalidated).toBe(false);

    recordWrite("post", "/api/tournaments/t1/seating/draw", () => apiError(409, "TOURNAMENT_CLOSED", "This tournament is over"));
    await act(() => result.current.mutateAsync(draw).catch(() => undefined));
    await waitFor(() => expect(queryClient.getQueryState(qk.tournaments.detail("t1"))?.isInvalidated).toBe(true));
  });
});

function renderReturnSeat() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({ returnSeat: useReturnSeat("t1"), busy: useSeatingBusy("t1") }), { wrapper });
  return { queryClient, result };
}

/** The seat_assigned entry the server writes as it sits a returning player down. */
const seatEntry = (registrationId: string, to: { tableNumber: number; seatNumber: number }, how: { restored: true } | { auto: true }): ActivityDto => ({
  id: `a-${registrationId}`,
  tournamentId: "t1",
  playerId: `p-${registrationId}`,
  eventType: "seat_assigned",
  eventData: JSON.stringify({ registrationId, from: null, to, ...how }),
  description: "seated",
  timestamp: "2026-10-25T08:00:00.000Z",
  player: null,
});

const mockActivity = (entries: ActivityDto[]) => server.use(http.get("/api/tournaments/t1/activity", () => HttpResponse.json(entries)));

describe("useReturnSeat", () => {
  it("seats a waiting player through the seating's one change path: busy for the panel meanwhile, and a refusal refreshes the seating (P4REV4-R3-CQ-08)", async () => {
    mockSeating(seatingDto({ tables: [{ id: "tb1", number: 1, seats: 2, seated: { 1: { id: "r1", name: "Ann" }, 2: { id: "r3", name: "Cat" } } }], unseated: [{ id: "r2", name: "Bob" }] }));
    const sent = recordWrite("post", "/api/tournaments/t1/seating/draw", async () => {
      await delay(300);
      return apiError(409, "INSUFFICIENT_SEATS", "Need 1 more seat", { needed: 1, available: 0 });
    });
    const { queryClient, result } = renderReturnSeat();

    let outcome: ReturnSeat | null = null;
    await act(async () => {
      outcome = await result.current.returnSeat("r2", "Bob");
    });
    const waiting = outcome as ReturnSeat | null;
    expect(waiting).toMatchObject({ status: "waiting", seatNow: { label: "Seat now" } });
    expect(returnSeatText("Bob is back in", waiting)).toBe("Bob is back in, waiting for a seat.");
    act(() => (waiting?.status === "waiting" ? waiting.seatNow.onClick() : undefined));
    await waitFor(() => expect(result.current.busy).toBe(true));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(sent).toEqual([{ scope: "unseated", registrationIds: ["r2"], includeUnconfirmed: true }]);
    expect(queryClient.getQueryState(qk.tournaments.seating("t1"))?.isInvalidated).toBe(true);
  });

  it("says where a returning player sits now, and whether it is their old seat (R5REV-HOST-04)", async () => {
    mockSeating(seatingDto({ tables: [{ id: "tb1", number: 1, seats: 4, seated: { 3: { id: "r1", name: "Ann" } } }, { id: "tb2", number: 2, seats: 4, seated: { 2: { id: "r2", name: "Bob" } } }] }));
    // Ann's old seat was free: given back. Bob's was taken: auto-seat chose Table 2, Seat 2.
    mockActivity([seatEntry("r2", { tableNumber: 2, seatNumber: 2 }, { auto: true }), seatEntry("r1", { tableNumber: 1, seatNumber: 3 }, { restored: true })]);
    const { result } = renderReturnSeat();

    let ann: ReturnSeat | null = null;
    let bob: ReturnSeat | null = null;
    await act(async () => {
      ann = await result.current.returnSeat("r1", "Ann");
      bob = await result.current.returnSeat("r2", "Bob");
    });
    expect(ann).toEqual({ status: "seated", seat: { tableNumber: 1, tableName: "Table 1", seatNumber: 3 }, oldSeat: true });
    expect(returnSeatText("Ann is back in", ann)).toBe("Ann is back in, at their old seat: Table 1, Seat 3.");
    expect(bob).toMatchObject({ status: "seated", oldSeat: false });
    expect(returnSeatText("Bob is back in with the re-buy", bob)).toBe("Bob is back in with the re-buy at a new seat: Table 2, Seat 2.");
  });

  it("still names the seat when the seating's history cannot say whether it is the old one", async () => {
    mockSeating(seatingDto({ tables: [{ id: "tb1", number: 1, seats: 4, seated: { 3: { id: "r1", name: "Ann" } } }] }));
    // The latest entry about Ann is an older seat: it says nothing about this one.
    mockActivity([seatEntry("r1", { tableNumber: 1, seatNumber: 1 }, { restored: true })]);
    const { result } = renderReturnSeat();

    let ann: ReturnSeat | null = null;
    await act(async () => {
      ann = await result.current.returnSeat("r1", "Ann");
    });
    expect(returnSeatText("Ann is back in", ann)).toBe("Ann is back in at Table 1, Seat 3.");

    // A new registration is never "back" anywhere: the history is not asked.
    server.use(http.get("/api/tournaments/t1/activity", () => HttpResponse.error()));
    await act(async () => {
      ann = await result.current.returnSeat("r1", "Ann", { returning: false });
    });
    expect(ann).toMatchObject({ status: "seated", oldSeat: null });
  });

  it("has nothing to add while no table is in play", async () => {
    mockSeating(seatingDto({ tables: [], unseated: [{ id: "r2", name: "Bob" }] }));
    const { result } = renderReturnSeat();
    let outcome: ReturnSeat | null = { status: "waiting", seatNow: { label: "Seat now", onClick: () => undefined } };
    await act(async () => {
      outcome = await result.current.returnSeat("r2", "Bob");
    });
    expect(outcome).toBeNull();
    expect(returnSeatText("Bob is in", outcome)).toBe("Bob is in.");
  });
});

describe("staleSeating", () => {
  it("reads the seating out of a STALE_PLAN refusal, and nothing else", () => {
    const fresh = seatingDto();
    expect(staleSeating(new ApiError({ status: 409, code: "STALE_PLAN", error: "Changed", details: { seating: fresh } }))).toBe(fresh);
    expect(staleSeating(new ApiError({ status: 409, code: "STALE_PLAN", error: "Changed", details: { seating: { version: 1 } } }))).toBeNull();
    expect(staleSeating(new ApiError({ status: 409, code: "SEAT_CONFLICT", error: "Conflict", details: { seating: fresh } }))).toBeNull();
  });
});

describe("polling", () => {
  it("follows the TD's seating every 10 s while it can change", () => {
    expect(seatingInterval(seatingDto())).toBe(10_000);
    expect(seatingInterval(seatingDto({ readOnly: true }))).toBe(false);
    expect(seatingInterval(undefined)).toBe(false);
  });

  it("follows the seat finder every 15 s while the tournament runs", () => {
    expect(publicSeatingInterval({ tournament: { id: "t1", name: "Friday", status: "in_progress" } })).toBe(15_000);
    expect(publicSeatingInterval({ tournament: { id: "t1", name: "Friday", status: "cancelled" } })).toBe(false);
    expect(publicSeatingInterval(undefined)).toBe(false);
  });
});
