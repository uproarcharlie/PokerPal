import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { apTournament, entrants, prizePoolDto } from "@test/helpers/ap-dto";
import { clubDto, MANAGER_VIEW, prizePoolSnapshotDto, VISITOR_VIEW } from "@test/helpers/dto";
import { qk } from "@/lib/api/query-keys";
import { formatMoney } from "@/lib/format";
import type { CarryOversDto } from "@shared/api/prize-pool";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { useTournament } from "@/features/tournaments/hooks";
import { ApPanel } from "./ap-panel";

// 20 buy-ins ($2,000, 10% AP), 4 re-buys and 2 add-ons ($150, $5 AP each): $2,150 in, $230 AP, $1,920 to pay.
const players = entrants(20, { rebuys: 4, addons: 2 });

interface Mocks {
  tournament?: TournamentDetailDto;
  registrations?: PublicRegistration[];
  club?: ReturnType<typeof clubDto>;
  carryOvers?: CarryOversDto;
  carryTarget?: string;
}

function mockPanel({
  tournament = apTournament(),
  registrations = players,
  club = clubDto({ rakeLabel: "AP", viewer: MANAGER_VIEW }),
  carryOvers = { available: [], carriedIn: [] },
  carryTarget = "the next tournament",
}: Mocks = {}) {
  server.use(
    http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(tournament, registrations, { carryTarget }))),
    http.get("/api/clubs/c1", () => HttpResponse.json(club)),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
    http.get("/api/tournaments/t1/prize-pool/carry-overs", () => HttpResponse.json(carryOvers)),
  );
}

const panel = () => screen.getByTestId("ap-panel");

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("ApPanel", () => {
  it("shows the AP by component, each with its rule, and what the club keeps, titled with the club's name for it", async () => {
    mockPanel();
    renderWithApp(<ApPanel tournament={apTournament()} />);

    expect(within(panel()).getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByTestId("ap-take")).toHaveTextContent("$230");
    expect(within(panel()).getByRole("heading", { level: 2, name: "AP" })).toBeInTheDocument();

    expect(screen.getByText("Buy-ins: 10%")).toBeInTheDocument();
    expect(screen.getByTestId("ap-rake-buyins")).toHaveTextContent("$200");
    expect(screen.getByText("Re-buys: $5 per entry")).toBeInTheDocument();
    expect(screen.getByTestId("ap-rake-rebuys")).toHaveTextContent("$20");
    expect(screen.getByTestId("ap-rake-addons")).toHaveTextContent("$10");
    expect(screen.getByTestId("ap-calculated")).toHaveTextContent("$230");
    expect(screen.getByTestId("net-source")).toHaveTextContent("Calculated");
    expect(screen.queryByTestId("ap-override")).not.toBeInTheDocument();
  });

  it("leaves what came in and the pool to the prize pool card beside it, so the Overview shows each once (P4REV4-CQ-02)", async () => {
    mockPanel();
    renderWithApp(<ApPanel tournament={apTournament()} />);
    await screen.findByTestId("ap-take");
    expect(within(panel()).queryByText(/taken in|Buy-ins \(|Net prize pool/i)).not.toBeInTheDocument();
    expect(within(panel()).queryByText("$2,150")).not.toBeInTheDocument();
    expect(within(panel()).queryByText("$1,920")).not.toBeInTheDocument();
  });

  it("says a manual AP total is fixed at its amount, beside what the rates give, with the reason and time", async () => {
    const tournament = apTournament({
      rakeOverride: "20.00",
      prizePoolAdjustmentReason: "Low turnout",
      prizePoolAdjustedAt: "2026-10-23T08:04:00.000Z",
    });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("ap-override")).toHaveTextContent("$20");
    expect(screen.getByText(/Fixed at \$20 \(calculated \$230\)/)).toBeInTheDocument();
    expect(screen.getByTestId("ap-take")).toHaveTextContent("$20");
    expect(screen.getByTestId("net-source")).toHaveTextContent("AP fixed");
    // 9:04 pm in Auckland (the club's zone).
    expect(screen.getByTestId("ap-adjustment")).toHaveTextContent(/Changed by hand at 9:04\s?pm: Low turnout/i);
  });

  it("drops the reason for a total fixed by hand once a rates change has let it go (P4REV2-MONEY-02)", async () => {
    const tournament = apTournament({ rakeOverride: null, prizePoolAdjustmentReason: "Low turnout", prizePoolAdjustedAt: "2026-10-23T08:04:00.000Z" });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("net-source")).toHaveTextContent("Calculated");
    expect(screen.queryByTestId("ap-adjustment")).not.toBeInTheDocument();
    expect(screen.queryByText(/Low turnout/)).not.toBeInTheDocument();
  });

  it("says when the club adds money to a fixed prize pool", async () => {
    const tournament = apTournament({ manualPrizePool: "2500.00" });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("ap-take")).toHaveTextContent("$350");
    expect(screen.getByTestId("net-source")).toHaveTextContent("Pool fixed");
    expect(screen.getByText(/fixed by hand at \$2,500 \(the rates leave \$1,920\)/)).toBeInTheDocument();
    expect(screen.getByText("Added by the club")).toBeInTheDocument();
  });

  it("says what the club keeps of a prize pool fixed below what came in but above the money available", async () => {
    const tournament = apTournament({ manualPrizePool: "2000.00" });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    // $1,920 is available after the $230 AP: a $2,000 pool needs $80 more, so the club keeps $150 in all.
    expect(await screen.findByTestId("ap-added-by-club")).toHaveTextContent("−$80");
    expect(screen.getByTestId("ap-take")).toHaveTextContent("$150");
    expect(screen.getByText("The club keeps, in all")).toBeInTheDocument();
  });

  it("says what the club keeps of a prize pool fixed below the money available (round 5, item 16)", async () => {
    const tournament = apTournament({ manualPrizePool: "1800.00" });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    // $1,920 is available: the club keeps the $120 the fixed pool leaves, with its $230 AP.
    expect(await screen.findByTestId("ap-kept-by-club")).toHaveTextContent("+$120");
    expect(screen.getByText("Kept by the club")).toBeInTheDocument();
    expect(screen.getByTestId("ap-take")).toHaveTextContent("$350");
    expect(screen.getByText("The club keeps, in all")).toBeInTheDocument();
  });

  it("says what is carried over instead, and that it is not the club's (round 5, item 16)", async () => {
    const tournament = apTournament({ manualPrizePool: "1800.00", prizeDifference: "carry" });
    mockPanel({ tournament, carryTarget: "Winter League" });
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("ap-carried-over")).toHaveTextContent("$120");
    expect(screen.getByText("Carried over to Winter League")).toBeInTheDocument();
    expect(screen.getByText("Not the club's: a later tournament can add it to its prize pool")).toBeInTheDocument();
    expect(screen.getByTestId("ap-take")).toHaveTextContent("$230");
  });

  it("says what the club adds to prizes set above the money available, and what it puts in all told", async () => {
    const tournament = apTournament({ payoutStructure: "custom", customPayouts: '{"v":2,"places":[{"amountCents":150000},{"amountCents":100000}]}' });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    // $2,500 of prizes from $1,920 available: the club adds $580, $350 more than its $230 AP.
    expect(await screen.findByTestId("ap-added-by-club")).toHaveTextContent("−$580");
    expect(screen.getByTestId("ap-take")).toHaveTextContent("$350");
    expect(screen.getByText("The club puts in, in all")).toBeInTheDocument();
  });

  it("offers the money other tournaments carried over, adds it in one tap, and takes it out again", async () => {
    const offer = { id: "co1", fromTournamentId: "t0", fromName: "Test Wednesday", carriedAt: "2026-10-22T11:00:00.000Z", amountCents: 5_000, seasonName: "Winter League" };
    const entry = { carryOverId: "co1", fromTournamentId: "t0", fromName: "Test Wednesday", amountCents: 5_000 };
    let tournament = apTournament();
    const calls: string[] = [];
    mockPanel({ carryOvers: { available: [offer], carriedIn: [] } });
    server.use(
      http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(tournament, players))),
      http.post("/api/tournaments/t1/prize-pool/carry-overs/co1", () => {
        calls.push("add");
        tournament = apTournament({ carriedIn: [entry] });
        server.use(http.get("/api/tournaments/t1/prize-pool/carry-overs", () => HttpResponse.json({ available: [], carriedIn: [entry] })));
        return HttpResponse.json({ tournament, prizePool: prizePoolDto(tournament, players) });
      }),
      http.delete("/api/tournaments/t1/prize-pool/carry-overs/co1", () => {
        calls.push("take out");
        tournament = apTournament();
        return HttpResponse.json({ tournament, prizePool: prizePoolDto(tournament, players) });
      }),
    );
    screenWidth(390);
    const user = userEvent.setup();
    renderWithApp(<ApPanel tournament={tournament} />);

    const offered = await screen.findByTestId("carry-over-co1");
    expect(offered).toHaveTextContent("$50 from Test Wednesday");
    expect(offered).toHaveTextContent("Carried over to Winter League");
    const add = within(offered).getByRole("button", { name: "Add the $50 from Test Wednesday to this prize pool" });
    expect(add).toHaveClass("h-11");
    await user.click(add);

    expect(await screen.findByText("$50 added to the prize pool")).toBeInTheDocument();
    expect(screen.getByText("The prize pool is now $1,970.")).toBeInTheDocument();
    const held = await screen.findByTestId("carried-in-co1");
    expect(held).toHaveTextContent("In this prize pool");
    await user.click(within(held).getByRole("button", { name: "Take the $50 from Test Wednesday out of the prize pool" }));
    await waitFor(() => expect(calls).toEqual(["add", "take out"]));
    expect(await screen.findByText("$50 taken out of the prize pool")).toBeInTheDocument();
  });

  it("says why carried-over money could not be added, e.g. another tournament took it first", async () => {
    const offer = { id: "co1", fromTournamentId: "t0", fromName: "Test Wednesday", carriedAt: "2026-10-22T11:00:00.000Z", amountCents: 5_000, seasonName: null };
    mockPanel({ carryOvers: { available: [offer], carriedIn: [] } });
    server.use(http.post("/api/tournaments/t1/prize-pool/carry-overs/co1", () => apiError(409, "CONFLICT", "That money is already in Friday Night's prize pool")));
    const user = userEvent.setup();
    renderWithApp(<ApPanel tournament={apTournament()} />);

    await user.click(await screen.findByRole("button", { name: "Add the $50 from Test Wednesday to this prize pool" }));
    expect(await screen.findByText("Could not change the prize pool")).toBeInTheDocument();
    expect(screen.getByText("That money is already in Friday Night's prize pool")).toBeInTheDocument();
  });

  it("offers a visitor no carried-over money and asks for none", async () => {
    const tournament = apTournament({ viewer: VISITOR_VIEW, carriedIn: [{ carryOverId: "co1", fromTournamentId: "t0", fromName: "Test Wednesday", amountCents: 5_000 }] });
    let asked = false;
    mockPanel({ tournament });
    server.use(
      http.get("/api/tournaments/t1/prize-pool/carry-overs", () => {
        asked = true;
        return HttpResponse.json({ available: [], carriedIn: [] });
      }),
    );
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("carried-in-co1")).toHaveTextContent("$50 from Test Wednesday");
    expect(screen.queryByRole("button", { name: /out of the prize pool/ })).not.toBeInTheDocument();
    expect(asked).toBe(false);
  });

  it("shows the high hand's AP apart, as its own pot", async () => {
    const tournament = apTournament({ enableHighHand: true, highHandAmount: "5.00", highHandRakeType: "fixed", highHandRakeAmount: "10.00" });
    const registrations = players.map((registration) => ({ ...registration, enteringHighHands: true }));
    mockPanel({ tournament, registrations });
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByText("High hand (a separate pot)")).toBeInTheDocument();
    expect(screen.getByText("AP: $10")).toBeInTheDocument();
    expect(screen.getByTestId("ap-rake-high-hand")).toHaveTextContent("$10");
  });

  it("says when nobody is in the high hand, with the AP the server works out for it (P4REV2-MONEY-05)", async () => {
    const tournament = apTournament({ enableHighHand: true, highHandAmount: "5.00", highHandRakeType: "fixed", highHandRakeAmount: "20.00" });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    const highHand = prizePoolDto(tournament, players).breakdown.highHand;
    expect(await screen.findByTestId("ap-rake-high-hand")).toHaveTextContent(formatMoney(highHand.rake));
    expect(screen.getByText(/^Nobody is in the high hand yet/)).toBeInTheDocument();
  });

  it("shows the high-hand AP exactly as the server works it out, the figure the pool card and finalize use (P4REV4-R3-CQ-01)", async () => {
    const tournament = apTournament({ enableHighHand: true, highHandAmount: "5.00", highHandRakeType: "fixed", highHandRakeAmount: "20.00" });
    const pool = prizePoolDto(tournament, players);
    // One $5 entry against a $20 fixed AP: whatever the server makes of it is shown, not a figure of the panel's own.
    const breakdown = { ...pool.breakdown, highHand: { ...pool.breakdown.highHand, entrants: 1, gross: 500, rake: 2_000, net: -1_500 } };
    server.use(
      http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json({ ...pool, breakdown })),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto({ rakeLabel: "AP", viewer: MANAGER_VIEW }))),
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(players)),
    );
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("ap-rake-high-hand")).toHaveTextContent("$20");
  });

  it("offers the staff Adjust, Edit rates and Rename, and a visitor none of them", async () => {
    mockPanel();
    const { unmount } = renderWithApp(<ApPanel tournament={apTournament()} />);
    await screen.findByTestId("ap-take");
    expect(screen.getByRole("button", { name: "Adjust AP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit AP rates" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Rename AP" })).toBeInTheDocument();
    unmount();

    mockPanel({ club: clubDto({ rakeLabel: "AP" }) });
    renderWithApp(<ApPanel tournament={apTournament({ viewer: VISITOR_VIEW })} />);
    await screen.findByTestId("ap-take");
    expect(screen.queryByRole("button", { name: /Adjust|Edit|Rename/ })).not.toBeInTheDocument();
  });

  it("shows what finalize froze once completed, read-only, whatever the rates say now", async () => {
    const snapshot = prizePoolSnapshotDto({
      pool: {
        grossCents: 60_000,
        rakeCalculatedCents: 6_000,
        rakeOverrideCents: 2_000,
        manualPrizePoolCents: null,
        netCents: 58_000,
        netSource: "ap_override",
        impliedRakeCents: 2_000,
        structure: { requested: "standard", used: "standard", basisPoints: [5000, 3000, 2000] },
      },
      paid: [
        { position: 1, registrationId: "r1", playerId: "p-r1", playerName: "Player 1", basisPoints: 5000, amountCents: 29_000 },
        { position: 2, registrationId: "r2", playerId: "p-r2", playerName: "Player 2", basisPoints: 3000, amountCents: 17_400 },
        { position: 3, registrationId: "r3", playerId: "p-r3", playerName: "Player 3", basisPoints: 2000, amountCents: 11_600 },
      ],
    });
    const tournament = apTournament({ status: "completed", finalizedAt: "2026-10-23T11:00:00.000Z", prizePoolSnapshot: snapshot });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("ap-take")).toHaveTextContent("$20");
    expect(screen.getByText("Finalized — showing what was paid.")).toBeInTheDocument();
    expect(screen.getByTestId("ap-calculated")).toHaveTextContent("$60");
    expect(screen.getByText(/Fixed at \$20 \(calculated \$60\)/)).toBeInTheDocument();
    expect(screen.getByTestId("net-source")).toHaveTextContent("AP fixed");
    expect(screen.queryByRole("button", { name: /Adjust|Edit|Rename/ })).not.toBeInTheDocument();
  });

  it("still shows the high hand's own AP once finalized, so the club's take does not shrink (P4REV2R2-MONEY-03)", async () => {
    const snapshot = prizePoolSnapshotDto();
    const tournament = apTournament({
      status: "completed",
      finalizedAt: "2026-10-23T11:00:00.000Z",
      prizePoolSnapshot: snapshot,
      enableHighHand: true,
      highHandAmount: "5.00",
      highHandRakeType: "fixed",
      highHandRakeAmount: "10.00",
    });
    mockPanel({ tournament, registrations: players.map((registration) => ({ ...registration, enteringHighHands: true })) });
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("ap-take")).toHaveTextContent("$25");
    expect(screen.getByText("Finalized — showing what was paid.")).toBeInTheDocument();
    expect(screen.getByText("High hand (a separate pot)")).toBeInTheDocument();
    expect(screen.getByTestId("ap-rake-high-hand")).toHaveTextContent("$10");
  });

  it("says a cancelled tournament pays nothing", async () => {
    const tournament = apTournament({ status: "cancelled" });
    mockPanel({ tournament });
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByTestId("ap-cancelled")).toHaveTextContent("no prizes are paid");
    expect(screen.queryByRole("button", { name: /Adjust/ })).not.toBeInTheDocument();
  });

  it("says when the figures could not be loaded, and loads them on Try again", async () => {
    let calls = 0;
    const tournament = apTournament();
    server.use(
      http.get("/api/tournaments/t1/prize-pool", () => {
        calls += 1;
        return calls === 1 ? apiError(500, "INTERNAL", "Something went wrong") : HttpResponse.json(prizePoolDto(tournament, players));
      }),
      http.get("/api/clubs/c1", () => HttpResponse.json(clubDto({ rakeLabel: "AP", viewer: MANAGER_VIEW }))),
    );
    const user = userEvent.setup();
    renderWithApp(<ApPanel tournament={tournament} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The AP could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("ap-take")).toHaveTextContent("$230");
  });

  describe("No AP tonight (round 5, item 5)", () => {
    /** The panel as the TD's page shows it: for the tournament as it is cached, which every AP change answers. */
    function FollowedPanel() {
      const tournament = useTournament("t1");
      return tournament.data ? <ApPanel tournament={tournament.data} /> : null;
    }

    /** PUT …/adjustment answers the tournament as the body sets it; the bodies sent are kept, and the pool asked again is the new one. */
    function mockAdjust(initial: TournamentDetailDto = apTournament()) {
      const sent: unknown[] = [];
      let current = initial;
      server.use(
        http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(current, players))),
        http.get("/api/clubs/c1", () => HttpResponse.json(clubDto({ rakeLabel: "AP", viewer: MANAGER_VIEW }))),
        http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(players)),
        http.get("/api/tournaments/t1", () => HttpResponse.json(current)),
        http.put("/api/tournaments/t1/prize-pool/adjustment", async ({ request }) => {
          const body = (await request.json()) as { mode: string; amount?: string; reason?: string };
          sent.push(body);
          current = {
            ...current,
            rakeOverride: body.mode === "ap_override" ? (body.amount ?? null) : null,
            manualPrizePool: null,
            prizePoolAdjustmentReason: body.reason ?? null,
            prizePoolAdjustedAt: "2026-10-25T08:00:00.000Z",
          };
          return HttpResponse.json({ tournament: current, prizePool: prizePoolDto(current, players) });
        }),
      );
      return sent;
    }

    it("takes the AP off in one tap, says so, and puts it back", async () => {
      screenWidth(390);
      const sent = mockAdjust();
      const user = userEvent.setup();
      renderWithApp(<FollowedPanel />);

      const noAp = await screen.findByRole("button", { name: "No AP tonight" });
      // The one obvious action: the primary button, full width and 44 px tall on a phone.
      expect(noAp).toHaveClass("h-11", "w-full");
      expect(screen.getByRole("button", { name: "Adjust AP" })).toHaveClass("h-11");
      await user.click(noAp);

      await waitFor(() => expect(sent).toEqual([{ mode: "ap_override", amount: "0.00", reason: "No AP tonight" }]));
      expect(await screen.findByText("The prize pool is $2,150.")).toBeInTheDocument();
      expect(await screen.findByTestId("no-ap-tonight")).toHaveTextContent("AP: none tonight");
      expect(screen.queryByRole("button", { name: "No AP tonight" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Back to calculated" }));
      await waitFor(() => expect(sent[1]).toEqual({ mode: "calculated" }));
      expect(await screen.findByText("AP back to the calculated $230")).toBeInTheDocument();
    });

    it("asks first while the pool is locked, since its published payouts change", async () => {
      const locked = apTournament({ prizePoolLocked: true });
      const sent = mockAdjust(locked);
      const user = userEvent.setup();
      renderWithApp(<ApPanel tournament={locked} />);

      await user.click(await screen.findByRole("button", { name: "No AP tonight" }));
      const confirm = await screen.findByRole("alertdialog", { name: "No AP tonight?" });
      expect(confirm).toHaveTextContent("The prize pool is locked: its published payouts change, to a pool of $2,150 with no AP.");
      expect(sent).toEqual([]);
      await user.click(within(confirm).getByTestId("confirm-no-ap"));

      await waitFor(() => expect(sent).toEqual([{ mode: "ap_override", amount: "0.00", reason: "No AP tonight" }]));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    });

    it("asks first under a prize pool set by hand, saying it is replaced, and offers nothing over a guaranteed pool (R5REV1-AP-01)", async () => {
      // $2,150 collected, the pool set by hand to $2,000: the club keeps $150.
      const kept = apTournament({ manualPrizePool: "2000.00" });
      const sent = mockAdjust(kept);
      const user = userEvent.setup();
      const { unmount } = renderWithApp(<ApPanel tournament={kept} />);

      await user.click(await screen.findByRole("button", { name: "No AP tonight" }));
      const confirm = await screen.findByRole("alertdialog", { name: "No AP tonight?" });
      expect(confirm).toHaveTextContent("The prize pool is set by hand to $2,000. No AP tonight replaces it with everything collected: $2,150.");
      expect(sent).toEqual([]);
      await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
      expect(sent).toEqual([]);
      unmount();

      // A $2,500 guarantee: the club adds $350, so there is no AP to take off, and one tap must not drop the pool to $2,150.
      const guaranteed = apTournament({ manualPrizePool: "2500.00" });
      mockAdjust(guaranteed);
      renderWithApp(<ApPanel tournament={guaranteed} />);
      await screen.findByTestId("ap-take");
      expect(screen.queryByRole("button", { name: "No AP tonight" })).not.toBeInTheDocument();
    });

    it("shows the AP off tonight to everyone, and offers nothing to take off when the rates take none", async () => {
      const off = apTournament({ rakeOverride: "0.00", viewer: VISITOR_VIEW });
      mockPanel({ tournament: off, club: clubDto({ rakeLabel: "AP" }) });
      const { unmount } = renderWithApp(<ApPanel tournament={off} />);
      expect(await screen.findByTestId("no-ap-tonight")).toHaveTextContent("AP: none tonight");
      expect(screen.queryByRole("button", { name: "Back to calculated" })).not.toBeInTheDocument();
      unmount();

      const free = apTournament({ rakeType: "none", rebuyRakeType: "none", addonRakeType: "none" });
      mockPanel({ tournament: free });
      renderWithApp(<ApPanel tournament={free} />);
      await screen.findByTestId("ap-take");
      expect(screen.queryByRole("button", { name: "No AP tonight" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("no-ap-tonight")).not.toBeInTheDocument();
    });

    it("says why the AP could not be taken off", async () => {
      mockPanel();
      server.use(http.put("/api/tournaments/t1/prize-pool/adjustment", () => apiError(409, "TOURNAMENT_CLOSED", "This tournament is completed")));
      const user = userEvent.setup();
      renderWithApp(<ApPanel tournament={apTournament()} />);

      await user.click(await screen.findByRole("button", { name: "No AP tonight" }));
      expect(await screen.findByText("Could not take the AP off")).toBeInTheDocument();
      expect(screen.getByText("This tournament is completed")).toBeInTheDocument();
    });
  });

  it("opens the payout editor from Edit payouts", async () => {
    mockPanel();
    const user = userEvent.setup();
    renderWithApp(<ApPanel tournament={apTournament()} />);

    await user.click(await screen.findByRole("button", { name: "Edit payouts" }));
    expect(await screen.findByRole("dialog", { name: "Edit payouts" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /^Standard/ })).toBeChecked();
  });

  it("renames the club's AP for every tournament, and shows the new name", async () => {
    let sent: unknown;
    let stored = clubDto({ rakeLabel: null, viewer: MANAGER_VIEW });
    server.use(
      http.get("/api/clubs/c1", () => HttpResponse.json(stored)),
      http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(apTournament(), players, { rakeLabel: stored.rakeLabel ?? "Rake" }))),
      http.put("/api/clubs/c1", async ({ request }) => {
        sent = await request.json();
        stored = { ...stored, rakeLabel: "Admin fee" };
        return HttpResponse.json(stored);
      }),
    );
    const user = userEvent.setup();
    const { queryClient } = renderWithApp(<ApPanel tournament={apTournament()} />);

    await user.click(await screen.findByRole("button", { name: "Rename Rake" }));
    const dialog = await screen.findByRole("dialog", { name: "What does Central Stars call its rake?" });
    expect(within(dialog).getByText(/Applies to every tournament in Central Stars/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Admin fee" }));
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Admin fee");
    expect(within(dialog).getByRole("button", { name: "Admin fee" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toEqual({ rakeLabel: "Admin fee" }));
    expect(await screen.findByText("Now called Admin fee")).toBeInTheDocument();
    expect(queryClient.getQueryData(qk.clubs.detail("c1"))).toMatchObject({ rakeLabel: "Admin fee" });
    // The tournament's prize pool is asked for again, and heads the panel with the new name.
    expect(await within(panel()).findByRole("heading", { level: 2, name: "Admin fee" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends a blank name as none, which the club then shows as Rake", async () => {
    let sent: unknown;
    mockPanel();
    server.use(
      http.put("/api/clubs/c1", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(clubDto({ rakeLabel: null, viewer: MANAGER_VIEW }));
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<ApPanel tournament={apTournament()} />);

    await user.click(await screen.findByRole("button", { name: "Rename AP" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toEqual({ rakeLabel: null }));
    expect(await screen.findByText("Now called Rake")).toBeInTheDocument();
  });

  it("keeps the rename open with the server's reason when it is refused", async () => {
    mockPanel();
    server.use(http.put("/api/clubs/c1", () => apiError(403, "FORBIDDEN", "Only the club's staff can change it")));
    const user = userEvent.setup();
    renderWithApp(<ApPanel tournament={apTournament()} />);

    await user.click(await screen.findByRole("button", { name: "Rename AP" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Could not rename it")).toBeInTheDocument();
    expect(screen.getByText("Only the club's staff can change it")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
