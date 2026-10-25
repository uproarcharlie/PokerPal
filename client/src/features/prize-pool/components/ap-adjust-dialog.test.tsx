import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { apTournament, apUpdateResponse, entrants, prizePoolDto } from "@test/helpers/ap-dto";
import { qk } from "@/lib/api/query-keys";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { ApAdjustDialog } from "./ap-adjust-dialog";

// A low turnout: 6 buy-ins of $100 with 10% AP. $600 in, $60 AP, $540 to pay (270 / 162 / 108).
const players = entrants(6);

function mockRegistrations() {
  server.use(http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(players)));
}

/** The prize pool GET answers: the tournament as the last PUT left it. */
let current = apTournament();
const mockPrizePool = () =>
  server.use(http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(current, players, { carryTarget: "Winter League" }))));

/** PUT …/adjustment answers the tournament as `changed` makes it (and the pool asked again is that one); the body sent is kept. */
function mockAdjust(changed: Partial<TournamentDetailDto>) {
  const request: { body?: unknown } = {};
  server.use(
    http.put("/api/tournaments/t1/prize-pool/adjustment", async ({ request: sent }) => {
      request.body = await sent.json();
      current = apTournament({ ...changed, prizePoolAdjustedAt: "2026-10-23T08:04:00.000Z" });
      return HttpResponse.json(apUpdateResponse(current, players));
    }),
  );
  return request;
}

function renderDialog(tournament = apTournament()) {
  const onOpenChange = vi.fn();
  const rendered = renderWithApp(<ApAdjustDialog open onOpenChange={onOpenChange} tournament={tournament} label="AP" />);
  return { ...rendered, onOpenChange, user: userEvent.setup() };
}

const amountBox = () => screen.getByTestId("adjust-amount");

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  mockRegistrations();
  current = apTournament();
  mockPrizePool();
  // A TD runs the game from a phone.
  screenWidth(390);
});

describe("ApAdjustDialog", () => {
  it("fixes the AP total for a low turnout, showing what it pays first, and shows the answer at once", async () => {
    const sent = mockAdjust({ rakeOverride: "20.00", prizePoolAdjustmentReason: "Low turnout" });
    const { user, queryClient, onOpenChange } = renderDialog();

    expect(await screen.findByRole("radio", { name: "Calculated (AP $60)" })).toBeChecked();
    // Full screen on a phone, Save and Cancel 44 px and always in view.
    expect(screen.getByTestId("ap-adjust")).toHaveClass("w-full", "h-dvh");
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("h-11");
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $540 (unchanged)");

    await user.click(screen.getByRole("radio", { name: "Set AP total" }));
    expect(screen.getByRole("textbox", { name: "AP total" })).toHaveValue("60.00");
    await user.clear(amountBox());
    await user.type(amountBox(), "20");
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $580 (now $540)");
    expect(screen.getByTestId("preview-ap")).toHaveTextContent("AP $20");
    expect(screen.getByTestId("preview-places")).toHaveTextContent("1st $290 · 2nd $174 · 3rd $116");

    const reasons = screen.getByRole("group", { name: "Common reasons" });
    await user.click(within(reasons).getByRole("button", { name: "Low turnout" }));
    expect(within(reasons).getByRole("button", { name: "Low turnout" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Reason (optional)" })).toHaveValue("Low turnout");
    expect(screen.getByText("Only the club's staff see it, in the activity feed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent.body).toEqual({ mode: "ap_override", amount: "20.00", reason: "Low turnout" }));
    expect(await screen.findByText("AP fixed at $20")).toBeInTheDocument();
    expect(queryClient.getQueryData(qk.tournaments.prizePool("t1"))).toMatchObject({ breakdown: { rake: { override: 2000 }, net: 58_000 } });
    expect(queryClient.getQueryData(qk.tournaments.detail("t1"))).toMatchObject({ rakeOverride: "20.00" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("waives, halves and steps the AP total by $5 in one tap", async () => {
    const { user } = renderDialog();
    await user.click(await screen.findByRole("radio", { name: "Set AP total" }));
    const quick = screen.getByRole("group", { name: "Quick amounts" });

    await user.click(within(quick).getByRole("button", { name: "Waive ($0)" }));
    expect(amountBox()).toHaveValue("0.00");
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $600 (now $540)");
    await user.click(within(quick).getByRole("button", { name: "Half" }));
    expect(amountBox()).toHaveValue("30.00");
    await user.click(within(quick).getByRole("button", { name: "+$5" }));
    expect(amountBox()).toHaveValue("35.00");
    await user.click(within(quick).getByRole("button", { name: "−$5" }));
    await user.click(within(quick).getByRole("button", { name: "−$5" }));
    expect(amountBox()).toHaveValue("25.00");
  });

  it("refuses an AP total over what was taken in before sending it", async () => {
    let called = false;
    server.use(
      http.put("/api/tournaments/t1/prize-pool/adjustment", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const { user } = renderDialog();
    await user.click(await screen.findByRole("radio", { name: "Set AP total" }));
    await user.clear(amountBox());
    await user.type(amountBox(), "700");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The AP cannot be more than the $600 taken in")).toBeInTheDocument();
    expect(amountBox()).toHaveAttribute("aria-invalid", "true");
    expect(called).toBe(false);
  });

  it("puts the server's AP_EXCEEDS_GROSS on the amount, and fetches the figures again", async () => {
    server.use(
      http.put("/api/tournaments/t1/prize-pool/adjustment", () =>
        apiError(400, "AP_EXCEEDS_GROSS", "The AP cannot be more than the $500 taken in", { grossCents: 50_000 }),
      ),
    );
    const { user, queryClient } = renderDialog();
    queryClient.setQueryData(qk.tournaments.detail("t1"), apTournament());
    await user.click(await screen.findByRole("radio", { name: "Set AP total" }));
    await user.clear(amountBox());
    await user.type(amountBox(), "550");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The AP cannot be more than the $500 taken in")).toBeInTheDocument();
    expect(amountBox()).toHaveAttribute("aria-invalid", "true");
    expect(queryClient.getQueryState(qk.tournaments.detail("t1"))?.isInvalidated).toBe(true);
  });

  it("says inside the dialog when the tournament has finished meanwhile", async () => {
    server.use(
      http.put("/api/tournaments/t1/prize-pool/adjustment", () =>
        apiError(409, "TOURNAMENT_CLOSED", "This tournament has finished, so its prize pool can no longer change"),
      ),
    );
    const { user, onOpenChange } = renderDialog();
    await user.click(await screen.findByRole("radio", { name: "Set AP total" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "This tournament has finished, so its prize pool can no longer change",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("fixes the prize pool, a guarantee the club tops up, rounding down to $10 in one tap", async () => {
    const sent = mockAdjust({ manualPrizePool: "1000.00" });
    const { user } = renderDialog();
    await user.click(await screen.findByRole("radio", { name: "Set prize pool" }));
    expect(screen.getByRole("textbox", { name: "Prize pool" })).toHaveValue("540.00");

    await user.clear(amountBox());
    await user.type(amountBox(), "547");
    await user.click(screen.getByRole("button", { name: "Round down to $10" }));
    expect(amountBox()).toHaveValue("540.00");

    await user.clear(amountBox());
    await user.type(amountBox(), "1000");
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $1,000 (now $540)");
    expect(screen.getByTestId("preview-ap")).toHaveTextContent("AP $60");
    expect(screen.getByTestId("preview-difference")).toHaveTextContent(
      "The prizes add up to $1,000, $460 more than the $540 available for prizes: the club adds $460.",
    );
    // A guarantee leaves nothing over: there is nothing to choose.
    expect(screen.queryByTestId("difference-choice")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent.body).toEqual({ mode: "manual_pool", amount: "1000.00", prizeDifference: "club" }));
    expect(await screen.findByText("Prize pool fixed at $1,000")).toBeInTheDocument();
  });

  it("asks where a pool fixed below the money available leaves the rest, the club keeping it by default (round 5, item 16)", async () => {
    const sent = mockAdjust({ manualPrizePool: "500.00", prizeDifference: "carry" });
    const { user } = renderDialog();
    await user.click(await screen.findByRole("radio", { name: "Set prize pool" }));

    await user.clear(amountBox());
    await user.type(amountBox(), "500");
    const choice = screen.getByTestId("difference-choice");
    expect(choice).toHaveTextContent("Where does the $40 left over go?");
    expect(within(choice).getByRole("radio", { name: /^Club keeps it/ })).toBeChecked();
    expect(screen.getByTestId("preview-difference")).toHaveTextContent("The prizes add up to $500, $40 less than the $540 available for prizes: the club keeps it.");
    expect(within(choice).getByRole("radio", { name: /^Add it to 1st.*1st pays \$290/ })).toBeInTheDocument();

    await user.click(within(choice).getByRole("radio", { name: /^Add it to 1st/ }));
    expect(screen.getByTestId("preview-places")).toHaveTextContent("1st $290 · 2nd $150 · 3rd $100");
    await user.click(within(choice).getByRole("radio", { name: /^Carry it over/ }));
    expect(within(choice).getByRole("radio", { name: /^Carry it over.*To Winter League/ })).toBeChecked();
    expect(screen.getByTestId("preview-difference")).toHaveTextContent("it is carried over to Winter League.");
    expect(screen.getByTestId("preview-places")).toHaveTextContent("1st $250 · 2nd $150 · 3rd $100");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent.body).toEqual({ mode: "manual_pool", amount: "500.00", prizeDifference: "carry" }));
    expect(await screen.findByText("Prize pool fixed at $500")).toBeInTheDocument();
    expect(screen.getByText("$40 left over: it is carried over to the next tournament.")).toBeInTheDocument();
  });

  it("leaves nothing to choose for a pool fixed at exactly the money available", async () => {
    const { user } = renderDialog();
    await user.click(await screen.findByRole("radio", { name: "Set prize pool" }));
    await user.clear(amountBox());
    await user.type(amountBox(), "540");
    expect(screen.queryByTestId("preview-difference")).not.toBeInTheDocument();
    expect(screen.queryByTestId("difference-choice")).not.toBeInTheDocument();
  });

  it("goes back to the calculated AP", async () => {
    const sent = mockAdjust({});
    const { user } = renderDialog(apTournament({ rakeOverride: "20.00" }));

    expect(await screen.findByRole("radio", { name: "Set AP total" })).toBeChecked();
    expect(amountBox()).toHaveValue("20.00");
    await user.click(screen.getByRole("radio", { name: "Calculated (AP $60)" }));
    expect(screen.queryByTestId("adjust-amount")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $540 (now $580)");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent.body).toEqual({ mode: "calculated" }));
    expect(await screen.findByText("AP back to the calculated $60")).toBeInTheDocument();
  });

  it("warns that published payouts change once the pool is locked, only for a change that moves the pool (P4REV2R3-MONEY-01)", async () => {
    const { user } = renderDialog(apTournament({ prizePoolLocked: true }));
    // Calculated, as it is now: the pool is unchanged, and so are the payouts players were shown.
    expect(await screen.findByTestId("preview-pool")).toHaveTextContent("Prize pool $540 (unchanged)");
    expect(screen.queryByTestId("locked-warning")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Set AP total" }));
    await user.clear(amountBox());
    await user.type(amountBox(), "20");
    expect(screen.getByTestId("locked-warning")).toHaveTextContent("Prize pool is locked — published payouts will change.");
  });

  it("says a pool of $0 pays no places, not that nobody has entered (P4REV2R3-MONEY-01)", async () => {
    const { user } = renderDialog();
    await user.click(await screen.findByRole("radio", { name: "Set AP total" }));
    await user.clear(amountBox());
    await user.type(amountBox(), "600");

    expect(screen.getByTestId("preview-pool")).toHaveTextContent("Prize pool $0 (now $540)");
    expect(screen.getByTestId("preview-no-places")).toHaveTextContent("The prize pool is $0 or less, so no places are paid.");
  });

  it("says Save is busy while the change is sent", async () => {
    server.use(
      http.put("/api/tournaments/t1/prize-pool/adjustment", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const { user } = renderDialog();
    await user.click(await screen.findByRole("radio", { name: "Set AP total" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true"));
  });

  it("says when the players behind the preview could not be loaded", async () => {
    server.use(http.get("/api/tournaments/t1/registrations", () => apiError(500, "INTERNAL", "Something went wrong")));
    renderDialog();
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("The players could not be loaded");
  });
});
