import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { apTournament, entrants, prizePoolDto } from "@test/helpers/ap-dto";
import { prizePoolSnapshotDto, VISITOR_VIEW } from "@test/helpers/dto";
import type { PayoutDisplay } from "@shared/domain/prize-pool";
import { PrizeStructureCard } from "./prize-structure-card";

const live: PayoutDisplay = {
  source: "live",
  rows: [
    { position: 1, amountCents: 36_000, percentage: 50 },
    { position: 2, amountCents: 21_600, percentage: 30 },
    { position: 3, amountCents: 14_400, percentage: 20 },
  ],
  totalCents: 72_000,
  undistributedCents: 0,
};

// Four players dealt: Fay, Eve and Dee by their places (Standard), and Cat, 4th, a share too.
const deal = {
  reason: "Chip chop at 4 handed",
  totalCents: 60_000,
  players: [
    { registrationId: "r6", playerId: "p6", playerName: "Fay", position: 1, plannedCents: 30_000, amountCents: 20_000 },
    { registrationId: "r5", playerId: "p5", playerName: "Eve", position: 2, plannedCents: 18_000, amountCents: 15_000 },
    { registrationId: "r4", playerId: "p4", playerName: "Dee", position: 3, plannedCents: 12_000, amountCents: 15_000 },
    { registrationId: "r3", playerId: "p3", playerName: "Cat", position: 4, plannedCents: 0, amountCents: 10_000 },
  ],
};
const dealt: PayoutDisplay = {
  source: "snapshot",
  rows: [
    { position: 1, amountCents: 20_000, percentage: 50, registrationId: "r6" },
    { position: 2, amountCents: 15_000, percentage: 30, registrationId: "r5" },
    { position: 3, amountCents: 15_000, percentage: 20, registrationId: "r4" },
    { position: 4, amountCents: 10_000, percentage: 0, registrationId: "r3" },
  ],
  totalCents: 60_000,
  undistributedCents: 0,
};

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  // The card reads the server's pool for its breakdown line (round 5, item 16).
  server.use(http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(apTournament({ status: "completed" }), entrants(6), { rakeLabel: "Rake" }))));
});

describe("PrizeStructureCard", () => {
  it("lets the club's staff edit the payouts while the tournament is open", async () => {
    server.use(http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(apTournament(), entrants(8)))));
    const user = userEvent.setup();
    renderWithApp(<PrizeStructureCard display={live} entrants={8} highHandAmount={null} tournament={apTournament()} />);

    await user.click(screen.getByRole("button", { name: "Edit payouts" }));
    expect(await screen.findByRole("dialog", { name: "Edit payouts" })).toBeInTheDocument();
  });

  it("offers no payout editor to a visitor, once the tournament is completed, or without the tournament", () => {
    const { unmount } = renderWithApp(<PrizeStructureCard display={live} entrants={8} highHandAmount={null} tournament={apTournament({ viewer: VISITOR_VIEW })} />);
    expect(screen.queryByRole("button", { name: "Edit payouts" })).not.toBeInTheDocument();
    unmount();

    const second = renderWithApp(<PrizeStructureCard display={live} entrants={8} highHandAmount={null} tournament={apTournament({ status: "completed" })} />);
    expect(screen.queryByRole("button", { name: "Edit payouts" })).not.toBeInTheDocument();
    second.unmount();

    renderWithApp(<PrizeStructureCard display={live} entrants={8} highHandAmount={null} />);
    expect(screen.queryByRole("button", { name: "Edit payouts" })).not.toBeInTheDocument();
  });

  it("says a deal paid the players still in, instead of their places' shares", () => {
    const tournament = apTournament({ status: "completed", prizePoolSnapshot: prizePoolSnapshotDto({ deal }) });
    renderWithApp(<PrizeStructureCard display={dealt} entrants={6} highHandAmount={null} tournament={tournament} />);

    expect(screen.getByTestId("payout-deal")).toHaveTextContent("DealFay $200, Eve $150, Dee $150, Cat $100 (Chip chop at 4 handed)");
    const top = screen.getByRole("list", { name: "Top places" });
    expect(within(top).getAllByText("Paid by the deal")).toHaveLength(3);
    expect(screen.queryByText(/% of prize pool/)).not.toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Deal")).toHaveLength(4);
  });

  it("says honestly where the money the prizes leave went, live (round 5, item 16)", async () => {
    const tournament = apTournament({ manualPrizePool: "600.00", prizeDifference: "carry" });
    server.use(http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(tournament, entrants(8), { carryTarget: "Winter League" }))));
    renderWithApp(<PrizeStructureCard display={live} entrants={8} highHandAmount={null} tournament={tournament} />);

    // $800 in, $80 AP: $720 available, a $600 pool.
    expect(await screen.findByTestId("pool-summary")).toHaveTextContent("Prize pool $600· AP $80· Carried over to Winter League $120");
  });

  it("says what the club added to prizes above the money available, and nothing when the prizes are what is available", async () => {
    const fixed = apTournament({ payoutStructure: "custom", customPayouts: '{"v":2,"places":[{"amountCents":60000},{"amountCents":20000}]}' });
    server.use(http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(fixed, entrants(8)))));
    const { unmount } = renderWithApp(<PrizeStructureCard display={live} entrants={8} highHandAmount={null} tournament={fixed} />);
    expect(await screen.findByTestId("pool-summary")).toHaveTextContent("Prize pool $800· AP $80· Added by the club $80");
    unmount();

    server.use(http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(apTournament(), entrants(8)))));
    renderWithApp(<PrizeStructureCard display={live} entrants={8} highHandAmount={null} tournament={apTournament()} />);
    await screen.findByRole("button", { name: "Edit payouts" });
    expect(screen.queryByTestId("pool-summary")).not.toBeInTheDocument();
  });

  it("says where the difference went as finalize froze it", () => {
    const difference = {
      choice: "club" as const,
      availableCents: 47_500,
      setCents: 42_500,
      cents: 5_000,
      keptByClubCents: 5_000,
      addedToPrizesCents: 0,
      carriedOverCents: 0,
      addedByClubCents: 0,
    };
    const snapshot = prizePoolSnapshotDto();
    const frozen = { ...snapshot, pool: { ...snapshot.pool, netCents: 42_500, impliedRakeCents: 7_500, difference } };
    renderWithApp(<PrizeStructureCard display={{ ...dealt, rows: [] }} entrants={3} highHandAmount={null} tournament={apTournament({ status: "completed", prizePoolSnapshot: frozen })} />);

    expect(screen.getByTestId("pool-summary")).toHaveTextContent("Prize pool $425· Rake $25· Kept by the club $50");
  });

  it("never shows a 0% share for a place paid outside the structure", () => {
    renderWithApp(<PrizeStructureCard display={dealt} entrants={6} highHandAmount={null} />);

    expect(screen.queryByText("0% of prize pool")).not.toBeInTheDocument();
    expect(screen.getAllByText("50% of prize pool")).toHaveLength(1);
    expect(within(screen.getByRole("table")).getAllByRole("row")[4]).toHaveTextContent("4th-$100");
  });
});
