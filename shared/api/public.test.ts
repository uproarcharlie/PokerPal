import { describe, expect, it } from "vitest";
import type { Club, Player } from "../schema";
import {
  findForbiddenKeys,
  pickFields,
  PUBLIC_CLUB_FIELDS,
  PUBLIC_PLAYER_FIELDS,
  PUBLIC_REGISTRATION_FIELDS,
  PUBLIC_TOURNAMENT_FIELDS,
  publicPlayerSearchQuerySchema,
} from "./public";

describe("findForbiddenKeys", () => {
  it("finds personal data and user ids at any depth, including inside JSON text fields", () => {
    const body = [
      { id: "r1", player: { id: "p1", name: "Alice", phone: "021" } },
      { id: "a1", eventData: JSON.stringify({ amount: 5, byUserId: "u1" }) },
      { club: { ownerId: "u2", nested: [{ email: "x@y" }] } },
    ];

    expect(findForbiddenKeys(body)).toEqual([
      "[0].player.phone",
      "[1].eventData<json>.byUserId",
      "[2].club.ownerId",
      "[2].club.nested[0].email",
    ]);
  });

  it("passes a clean body, and text that only looks like JSON", () => {
    expect(findForbiddenKeys({ id: "p1", name: "Bob", note: "{not json", list: [1, "two", null] })).toEqual([]);
  });
});

describe("public projections", () => {
  it("pickFields copies the listed keys and nothing else", () => {
    const player = { id: "p1", name: "Alice", imageUrl: null, email: "a@x", phone: "021", userId: "u1" } as unknown as Player;

    expect(pickFields(player, PUBLIC_PLAYER_FIELDS)).toEqual({ id: "p1", name: "Alice", imageUrl: null });
  });

  it("no public field list names a forbidden key", () => {
    const lists = [PUBLIC_PLAYER_FIELDS, PUBLIC_CLUB_FIELDS, PUBLIC_TOURNAMENT_FIELDS, PUBLIC_REGISTRATION_FIELDS];
    for (const list of lists) {
      expect(findForbiddenKeys(Object.fromEntries(list.map((key) => [key, 1])))).toEqual([]);
    }
  });

  it("the club projection drops ownerId", () => {
    const club = { id: "c1", name: "Central Stars", slug: "central-stars", ownerId: "u1" } as unknown as Club;

    expect(pickFields(club, PUBLIC_CLUB_FIELDS)).not.toHaveProperty("ownerId");
  });
});

describe("publicPlayerSearchQuerySchema", () => {
  it("trims the query and defaults the limit", () => {
    expect(publicPlayerSearchQuerySchema.parse({ q: "  ali " })).toEqual({ q: "ali", limit: 10 });
  });

  it("refuses an empty query and a limit over 25", () => {
    expect(publicPlayerSearchQuerySchema.safeParse({ q: " " }).success).toBe(false);
    expect(publicPlayerSearchQuerySchema.safeParse({ q: "a", limit: "26" }).success).toBe(false);
  });
});
