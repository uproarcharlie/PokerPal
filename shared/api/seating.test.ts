import { describe, expect, it } from "vitest";
import {
  assignSeatSchema,
  balanceSchema,
  breakTableSchema,
  createTablesSchema,
  drawSeatsSchema,
  finalTableSchema,
  seatingSetupSchema,
  undoSeatingSchema,
  unseatSchema,
  updateTableSchema,
} from "./seating";

describe("the seating request schemas", () => {
  it("default new tables to one of 9 seats, and keep tables between 2 and 10 seats", () => {
    expect(createTablesSchema.parse({})).toEqual({ count: 1, seatCount: 9 });
    expect(createTablesSchema.parse({ count: 3, seatCount: 6 })).toEqual({ count: 3, seatCount: 6 });
    expect(createTablesSchema.safeParse({ seatCount: 11 }).success).toBe(false);
    expect(createTablesSchema.safeParse({ seatCount: 1 }).success).toBe(false);
    expect(createTablesSchema.safeParse({ count: 21 }).success).toBe(false);
  });

  it("update a table by any field, a blank name meaning none, reopening only to active", () => {
    expect(updateTableSchema.parse({ name: "  " })).toEqual({ name: null });
    expect(updateTableSchema.parse({ name: " Feature table ", seatCount: 8 })).toEqual({ name: "Feature table", seatCount: 8 });
    expect(updateTableSchema.parse({ status: "active" })).toEqual({ status: "active" });
    expect(updateTableSchema.safeParse({ status: "broken" }).success).toBe(false);
    expect(updateTableSchema.safeParse({}).success).toBe(false);
    expect(updateTableSchema.safeParse({ tableNumber: 1000 }).success).toBe(false);
    expect(updateTableSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });

  it("set up and draw including unpaid entries unless told otherwise", () => {
    expect(seatingSetupSchema.parse({})).toEqual({ seatCount: 9, includeUnconfirmed: true });
    expect(seatingSetupSchema.parse({ seatCount: 8, tableCount: 3, includeUnconfirmed: false })).toEqual({ seatCount: 8, tableCount: 3, includeUnconfirmed: false });
    expect(seatingSetupSchema.safeParse({ tableCount: 51 }).success).toBe(false);
    expect(drawSeatsSchema.parse({})).toEqual({ scope: "unseated", includeUnconfirmed: true });
    expect(drawSeatsSchema.parse({ scope: "all", registrationIds: ["r1"] })).toMatchObject({ scope: "all", registrationIds: ["r1"] });
    expect(drawSeatsSchema.safeParse({ registrationIds: [] }).success).toBe(false);
    expect(drawSeatsSchema.safeParse({ scope: "some" }).success).toBe(false);
  });

  it("assign a seat by id, swapping only when asked", () => {
    expect(assignSeatSchema.parse({ registrationId: "r1", tableId: "t1", seatNumber: 4 })).toEqual({ registrationId: "r1", tableId: "t1", seatNumber: 4, swap: false });
    expect(assignSeatSchema.safeParse({ registrationId: "r1", tableId: "t1", seatNumber: 11 }).success).toBe(false);
    expect(assignSeatSchema.safeParse({ registrationId: "r 1", tableId: "t1", seatNumber: 1 }).success).toBe(false);
    expect(assignSeatSchema.parse({ registrationId: "r1", tableId: "t1", seatNumber: 4, swap: true, expectedVersion: "0a1b2c3d" })).toMatchObject({ expectedVersion: "0a1b2c3d" });
    expect(assignSeatSchema.safeParse({ registrationId: "r1", tableId: "t1", seatNumber: 4, expectedVersion: "stale" }).success).toBe(false);
    expect(unseatSchema.safeParse({}).success).toBe(false);
  });

  it("balance, break and final-table with optional guards", () => {
    expect(balanceSchema.parse({})).toEqual({});
    expect(balanceSchema.parse({ expectedVersion: "0a1b2c3d" })).toEqual({ expectedVersion: "0a1b2c3d" });
    expect(balanceSchema.safeParse({ expectedVersion: "0A1B2C3D" }).success).toBe(false);
    expect(breakTableSchema.parse({})).toEqual({});
    expect(finalTableSchema.parse({ tableId: "t2" })).toEqual({ tableId: "t2" });
    expect(finalTableSchema.parse({ expectedVersion: "0a1b2c3d" })).toEqual({ expectedVersion: "0a1b2c3d" });
    expect(drawSeatsSchema.parse({ scope: "all", expectedVersion: "0a1b2c3d" })).toMatchObject({ scope: "all", expectedVersion: "0a1b2c3d" });
    expect(finalTableSchema.safeParse({ expectedVersion: "stale" }).success).toBe(false);
    expect(drawSeatsSchema.safeParse({ expectedVersion: "stale" }).success).toBe(false);
  });

  it("undo the last change by its activity entry, with an optional guard", () => {
    expect(undoSeatingSchema.parse({ activityId: "a1" })).toEqual({ activityId: "a1" });
    expect(undoSeatingSchema.parse({ activityId: "a1", expectedVersion: "0a1b2c3d" })).toEqual({ activityId: "a1", expectedVersion: "0a1b2c3d" });
    expect(undoSeatingSchema.safeParse({}).success).toBe(false);
    expect(undoSeatingSchema.safeParse({ activityId: "a1", expectedVersion: "nope" }).success).toBe(false);
  });
});
