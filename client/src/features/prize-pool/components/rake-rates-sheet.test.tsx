import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { apTournament, apUpdateResponse, entrants } from "@test/helpers/ap-dto";
import { MANAGER_VIEW, tournamentDto } from "@test/helpers/dto";
import { qk } from "@/lib/api/query-keys";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { RakeRatesSheet } from "./rake-rates-sheet";

// 20 buy-ins ($2,000, 10% AP), 4 re-buys and 2 add-ons ($150, $5 AP each): $2,150 in, $230 AP, $1,920 to pay.
const players = entrants(20, { rebuys: 4, addons: 2 });

/** PUT …/rates answers the tournament as `changed` makes it; the body sent is kept. */
function mockRates(changed: Partial<TournamentDetailDto>) {
  const request: { body?: unknown } = {};
  server.use(
    http.put("/api/tournaments/t1/prize-pool/rates", async ({ request: sent }) => {
      request.body = await sent.json();
      return HttpResponse.json(apUpdateResponse(apTournament(changed), players));
    }),
  );
  return request;
}

function renderSheet(tournament = apTournament()) {
  const onOpenChange = vi.fn();
  const rendered = renderWithApp(<RakeRatesSheet open onOpenChange={onOpenChange} tournament={tournament} label="AP" />);
  return { ...rendered, onOpenChange, user: userEvent.setup() };
}

const box = (name: string) => screen.getByRole("textbox", { name });

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  server.use(http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(players)));
});

describe("RakeRatesSheet", () => {
  it("says its reason is kept for the staff, as the rates change is logged (P4REV2-MONEY-03)", async () => {
    renderSheet();
    expect(await screen.findByText("Kept in the staff activity log; players do not see it.")).toBeInTheDocument();
    expect(screen.queryByText(/public activity feed/)).not.toBeInTheDocument();
  });

  it("says that under a pool fixed by hand the rates change neither the pool nor the club's take (P4REV2-MONEY-04)", async () => {
    renderSheet(apTournament({ manualPrizePool: "2000.00" }));
    expect(await screen.findByTestId("pool-stays")).toHaveTextContent(
      "The prize pool is fixed at $2,000: the rates change neither the pool nor what the club keeps until the pool goes back to the calculated amount.",
    );
  });

  it("changes a rate, shows what the pool becomes, sends only the rate changed and shows the answer at once", async () => {
    const sent = mockRates({ rakeAmount: "5.00" });
    const { user, queryClient, onOpenChange } = renderSheet();

    expect(await screen.findByRole("dialog", { name: "Edit AP rates" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Buy-ins AP Type" })).toHaveValue("percentage");
    expect(box("Buy-ins AP Percentage")).toHaveValue("10");
    expect(screen.getByRole("combobox", { name: "Re-buys AP Type" })).toHaveValue("fixed");
    expect(box("Re-buys AP Per Entry")).toHaveValue("5.00");
    expect(box("Add-ons AP Per Entry")).toHaveValue("5.00");
    expect(screen.queryByRole("combobox", { name: "High hand AP Type" })).not.toBeInTheDocument();

    await user.clear(box("Buy-ins AP Percentage"));
    await user.type(box("Buy-ins AP Percentage"), "5");
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $2,020 (now $1,920)");
    expect(screen.getByTestId("preview-ap")).toHaveTextContent("AP $130");
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    await waitFor(() =>
      expect(sent.body).toEqual({
        rakeType: "percentage",
        rakeAmount: "5.00",
        keepOverride: false,
      }),
    );
    expect(await screen.findByText("AP rates saved")).toBeInTheDocument();
    expect(queryClient.getQueryData(qk.tournaments.prizePool("t1"))).toMatchObject({ breakdown: { rake: { calculated: 13_000 } } });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("empties the amount when the type changes, so 10% never silently becomes $10 per entry", async () => {
    let called = false;
    server.use(
      http.put("/api/tournaments/t1/prize-pool/rates", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const { user } = renderSheet();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Buy-ins AP Type" }), "fixed");
    expect(box("Buy-ins AP Per Entry")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    expect(box("Buy-ins AP Per Entry")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Fix the rates above to see the prize pool.");
    expect(called).toBe(false);

    await user.selectOptions(screen.getByRole("combobox", { name: "Buy-ins AP Type" }), "percentage");
    expect(box("Buy-ins AP Percentage")).toHaveValue("10");
  });

  it("says a percentage over 100 on its box before sending", async () => {
    const { user } = renderSheet();
    await user.clear(await screen.findByRole("textbox", { name: "Buy-ins AP Percentage" }));
    await user.type(box("Buy-ins AP Percentage"), "150");
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    expect(await screen.findByText("A percentage cannot be over 100")).toBeInTheDocument();
    expect(box("Buy-ins AP Percentage")).toHaveAttribute("aria-invalid", "true");
  });

  it("puts the server's refusal under the rate it names", async () => {
    server.use(
      http.put("/api/tournaments/t1/prize-pool/rates", () =>
        apiError(400, "AMOUNT_REQUIRED", "Enter an amount for that rate", { field: "rebuyRakeAmount" }),
      ),
    );
    const { user } = renderSheet();
    await user.clear(await screen.findByRole("textbox", { name: "Re-buys AP Per Entry" }));
    await user.type(box("Re-buys AP Per Entry"), "4");
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    expect(await screen.findByText("Enter an amount for that rate")).toBeInTheDocument();
    expect(box("Re-buys AP Per Entry")).toHaveAttribute("aria-invalid", "true");
  });

  it("goes back to the calculated AP when a buy-in rate changes, unless the fixed AP total is kept", async () => {
    const sent = mockRates({ rakeOverride: "20.00" });
    const { user } = renderSheet(apTournament({ rakeOverride: "20.00" }));

    await user.clear(await screen.findByRole("textbox", { name: "Buy-ins AP Percentage" }));
    await user.type(box("Buy-ins AP Percentage"), "5");
    const keep = await screen.findByRole("checkbox", { name: "Keep the fixed AP total ($20)" });
    expect(keep).not.toBeChecked();
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $2,020 (now $2,130)");
    await user.click(keep);
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $2,130 (unchanged)");
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    await waitFor(() => expect(sent.body).toEqual({ rakeType: "percentage", rakeAmount: "5.00", keepOverride: true }));
  });

  it("keeps a fixed low-turnout AP total when only the high hand's rate changes (MONEY-AP-01)", async () => {
    const sent = mockRates({ rakeOverride: "20.00", highHandRakeType: "fixed", highHandRakeAmount: "10.00" });
    const { user } = renderSheet(apTournament({ rakeOverride: "20.00", enableHighHand: true, highHandAmount: "5.00" }));

    await user.selectOptions(await screen.findByRole("combobox", { name: "High hand AP Type" }), "fixed");
    await user.type(box("High hand AP Amount"), "10");
    // The high hand is a separate pot: nothing here can let the fixed AP total go.
    expect(screen.queryByRole("checkbox", { name: /Keep the fixed AP total/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("override-stays")).toHaveTextContent("The AP total stays fixed at $20");
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    await waitFor(() => expect(sent.body).toEqual({ highHandRakeType: "fixed", highHandRakeAmount: "10.00", keepOverride: true }));
  });

  it("sends nothing, and says so, when the rates were saved as they were (MONEY-AP-01)", async () => {
    let called = false;
    server.use(
      http.put("/api/tournaments/t1/prize-pool/rates", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const { user, onOpenChange } = renderSheet(apTournament({ rakeOverride: "20.00" }));
    // Retyped as it was: the same rate.
    await user.clear(await screen.findByRole("textbox", { name: "Buy-ins AP Percentage" }));
    await user.type(box("Buy-ins AP Percentage"), "10.0");
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    expect(await screen.findByText("The AP rates are unchanged")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(called).toBe(false);
  });

  it("offers the high hand's rate when it has one, and only the buy-in's for a freezeout", async () => {
    const freezeout = tournamentDto({ viewer: MANAGER_VIEW, enableHighHand: true, highHandAmount: "5.00" });
    renderSheet(freezeout);

    expect(await screen.findByRole("combobox", { name: "High hand AP Type" })).toHaveValue("none");
    expect(screen.getByRole("combobox", { name: "Buy-ins AP Type" })).toHaveValue("none");
    expect(screen.queryByRole("combobox", { name: "Re-buys AP Type" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Add-ons AP Type" })).not.toBeInTheDocument();
    expect(screen.getByText(/never part of the fixed AP total/)).toBeInTheDocument();
  });

  it("says why the rates could not change, and Save is busy while they are sent", async () => {
    server.use(
      http.put("/api/tournaments/t1/prize-pool/rates", async () => {
        await delay(50);
        return apiError(409, "TOURNAMENT_CLOSED", "This tournament has finished, so its rates can no longer change");
      }),
    );
    const { user } = renderSheet();
    await user.clear(await screen.findByRole("textbox", { name: "Buy-ins AP Percentage" }));
    await user.type(box("Buy-ins AP Percentage"), "5");
    await user.click(screen.getByRole("button", { name: "Save rates" }));

    expect(screen.getByRole("button", { name: "Save rates" })).toHaveAttribute("aria-disabled", "true");
    expect(await screen.findByText("Could not change the AP rates")).toBeInTheDocument();
    expect(screen.getByText("This tournament has finished, so its rates can no longer change")).toBeInTheDocument();
  });
});
