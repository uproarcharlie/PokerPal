import { describe, expect, it } from "vitest";
import { tournamentItem } from "@test/helpers/f3-clubs";
import { timeZoneGroups, timeZoneLabel } from "./time-zones";
import { fieldCountText, groupForPublicPage } from "./tournament-lists";

describe("time zones", () => {
  it("offer New Zealand's first, then the nearby ones, then every other zone once", () => {
    const { nearby, other } = timeZoneGroups("Pacific/Auckland");

    expect(nearby[0]).toBe("Pacific/Auckland");
    expect(nearby).toContain("Australia/Sydney");
    expect(other).toContain("Europe/London");
    expect(other).not.toContain("Pacific/Auckland");
  });

  it("keep offering a club's zone that this browser does not list", () => {
    expect(timeZoneGroups("Mars/Olympus_Mons").nearby[0]).toBe("Mars/Olympus_Mons");
    expect(timeZoneLabel("America/Port_of_Spain")).toBe("America/Port of Spain");
  });
});

describe("a club's tournaments", () => {
  it("are grouped for the public page: live, upcoming soonest first, past latest first, cancelled left out", () => {
    const at = (id: string, status: string, startDateTime: string) => tournamentItem({ id, status, startDateTime });
    const groups = groupForPublicPage([
      at("later", "scheduled", "2026-11-20T06:00:00.000Z"),
      at("old", "completed", "2026-08-01T06:00:00.000Z"),
      at("live", "in_progress", "2026-10-19T06:00:00.000Z"),
      at("sooner", "registration", "2026-10-24T06:00:00.000Z"),
      at("recent", "completed", "2026-10-10T06:00:00.000Z"),
      at("off", "cancelled", "2026-10-30T06:00:00.000Z"),
    ]);

    expect({ live: groups.live.map((t) => t.id), upcoming: groups.upcoming.map((t) => t.id), past: groups.past.map((t) => t.id) }).toEqual({
      live: ["live"],
      upcoming: ["sooner", "later"],
      past: ["recent", "old"],
    });
  });

  it("count the field against Max players, the waiting list behind it while open, never \"19 / 18\" (round 6, B4)", () => {
    const counted = (status: string, registeredCount: number, waitingListCount: number) =>
      fieldCountText(tournamentItem({ status, registeredCount, waitingListCount, maxPlayers: 18 }));

    expect(counted("registration", 19, 1)).toBe("18 / 18 players · 1 waiting");
    expect(counted("in_progress", 20, 2)).toBe("18 / 18 players · 2 waiting");
    expect(counted("scheduled", 12, 0)).toBe("12 / 18 players");
    // Nobody waits for a game that is over.
    expect(counted("completed", 19, 1)).toBe("18 / 18 players");
  });
});
