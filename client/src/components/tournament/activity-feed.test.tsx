import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { ActivityFeed } from "./activity-feed";

const entry = (id: string, eventType: string, description: string) => ({
  id,
  tournamentId: "t1",
  eventType,
  description,
  timestamp: "2026-10-23T08:00:00.000Z",
  player: null,
});

beforeEach(() => {
  mockSignedOut();
});

describe("ActivityFeed (P2REV4-CQ-07)", () => {
  it("labels every event the server writes, and an old unknown one plainly", async () => {
    server.use(
      http.get("/api/tournaments/t1/activity", () =>
        HttpResponse.json([
          entry("1", "prize_pool_adjusted", "Prize pool set manually to $300"),
          entry("2", "rake_rates_changed", "AP rates changed"),
          entry("3", "tournament_refinalized", "Tournament finalized again"),
          entry("4", "reentry", "Ann is back in with a re-buy"),
          entry("5", "registration_removed", "Bob's entry was removed"),
          entry("6", "something_from_2024", "An old entry"),
        ]),
      ),
    );
    renderWithApp(<ActivityFeed tournamentId="t1" />);

    for (const label of ["Prize Pool", "Rates", "Results Corrected", "Re-entry", "Entry Removed", "Event"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });
});
