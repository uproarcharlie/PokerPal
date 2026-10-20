import { describe, expect, it } from "vitest";
import type { LeaderboardEntryDto } from "@shared/api/seasons";
import { leaderboardCsv, leaderboardFileName } from "./leaderboard-csv";

const entry = (rank: number, name: string, points: number, tournaments = 1): LeaderboardEntryDto => ({
  rank,
  player: { id: `p-${name}`, name, imageUrl: null },
  points,
  tournaments,
});

describe("leaderboardCsv", () => {
  it("writes one row per player in the server's order, ties keeping their shared rank", () => {
    const csv = leaderboardCsv([entry(1, "Ava", 120, 2), entry(2, "Ben", 80), entry(2, "Cal", 80)]);

    expect(csv).toBe("\uFEFFRank,Player,Points,Tournaments\r\n1,Ava,120,2\r\n2,Ben,80,1\r\n2,Cal,80,1\r\n");
  });

  it("quotes commas and quotes, and keeps a name a spreadsheet would run as a formula inert", () => {
    const csv = leaderboardCsv([entry(1, 'Smith, "Smithy"', 10), entry(2, "=HYPERLINK(1)", 5), entry(3, "Hēmi", 4)]);

    expect(csv.split("\r\n").slice(1, 4)).toEqual(['1,"Smith, ""Smithy""",10,1', "2,'=HYPERLINK(1),5,1", "3,Hēmi,4,1"]);
  });
});

describe("leaderboardFileName", () => {
  it("names the file after the season", () => {
    expect(leaderboardFileName("Spring 2026")).toBe("spring-2026-leaderboard.csv");
    expect(leaderboardFileName("Kōanga — Series #2")).toBe("koanga-series-2-leaderboard.csv");
    expect(leaderboardFileName("!!!")).toBe("season-leaderboard.csv");
  });
});
