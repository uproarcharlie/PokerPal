import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { delay, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { apiError, createTestQueryClient } from "@test/helpers/web";
import { mockSeating, recordWrite, seatingDto, seatingMutation } from "@test/helpers/seating-dto";
import type { ToastAction } from "@/hooks/use-toast";
import { publicSeatingInterval } from "./hooks";
import { seatingInterval, staleSeating, useSeatingBusy, useSeatingMutations } from "./staff-hooks";
import { useWaitingSeat } from "./waiting-seat";

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

describe("useWaitingSeat (P4REV4-R3-CQ-08)", () => {
  it("seats a waiting player through the seating's one change path: busy for the panel meanwhile, and a refusal refreshes the seating", async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    mockSeating(seatingDto({ tables: [{ id: "tb1", number: 1, seats: 2, seated: { 1: { id: "r1", name: "Ann" }, 2: { id: "r3", name: "Cat" } } }], unseated: [{ id: "r2", name: "Bob" }] }));
    const sent = recordWrite("post", "/api/tournaments/t1/seating/draw", async () => {
      await delay(300);
      return apiError(409, "INSUFFICIENT_SEATS", "Need 1 more seat", { needed: 1, available: 0 });
    });
    const { result } = renderHook(() => ({ waitingSeat: useWaitingSeat("t1"), busy: useSeatingBusy("t1") }), { wrapper });

    let seatNow: ToastAction | null = null;
    await act(async () => {
      seatNow = await result.current.waitingSeat("r2", "Bob");
    });
    expect(seatNow).toMatchObject({ label: "Seat now" });
    act(() => (seatNow as ToastAction | null)?.onClick());
    await waitFor(() => expect(result.current.busy).toBe(true));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(sent).toEqual([{ scope: "unseated", registrationIds: ["r2"], includeUnconfirmed: true }]);
    expect(queryClient.getQueryState(qk.tournaments.seating("t1"))?.isInvalidated).toBe(true);
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
