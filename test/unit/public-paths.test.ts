/**
 * The links the server hands out (the TV's QR code to the season leaderboard, the TV clock key's link)
 * are built by shared/domain/urls publicPaths; the client's router serves the pages at the paths its
 * own `routes` build. A QR code printed on a flyer or shown on the venue TV must open a page the router
 * serves, so the two must make the same path for every id (R2-CQ-08).
 */
import { describe, expect, it } from "vitest";
import { routes } from "@/app/routes";
import { publicPaths } from "@shared/domain/urls";

const IDS = ["4f1c2a9e-7b3d-4e5f-9a1b-2c3d4e5f6a7b", "t 1", "a/b?c#d", "Zoë"];

describe("public page paths", () => {
  it.each(IDS)("are the same on the server and in the client's router for %j", (id) => {
    expect(routes.publicTournament(id)).toBe(publicPaths.tournament(id));
    expect(routes.publicSeats(id)).toBe(publicPaths.seats(id));
    expect(routes.publicSeason(id)).toBe(publicPaths.season(id));
    expect(routes.clockDisplay(id)).toBe(publicPaths.clockDisplay(id));
  });
});
