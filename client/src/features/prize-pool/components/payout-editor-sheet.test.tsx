import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { apTournament, apUpdateResponse, entrants, prizePoolDto } from "@test/helpers/ap-dto";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { qk } from "@/lib/api/query-keys";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { PayoutEditorSheet } from "./payout-editor-sheet";

// Eight $100 buy-ins with 10% AP: $800 in, $80 AP, a $720 pool (Standard: $360 / $216 / $144).
const players = entrants(8);

/**
 * The pool as the server works it out for `tournament`, and the PUT …/payouts answer as `changed` makes
 * it (asked again afterwards, the pool and the tournament are the changed ones); the bodies sent are kept.
 */
function mockEditor(tournament: TournamentDetailDto = apTournament(), changed: Partial<TournamentDetailDto> = {}) {
  const sent: unknown[] = [];
  let current = tournament;
  server.use(
    http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(current, players))),
    http.get("/api/tournaments/t1", () => HttpResponse.json(current)),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(players)),
    http.put("/api/tournaments/t1/prize-pool/payouts", async ({ request }) => {
      sent.push(await request.json());
      current = { ...tournament, ...changed };
      return HttpResponse.json(apUpdateResponse(current, players));
    }),
  );
  return sent;
}

function renderSheet(tournament: TournamentDetailDto = apTournament()) {
  const onOpenChange = vi.fn();
  const rendered = renderWithApp(<PayoutEditorSheet open onOpenChange={onOpenChange} tournament={tournament} />);
  return { ...rendered, onOpenChange, user: userEvent.setup() };
}

const place = (n: number) => screen.getByTestId(`payout-place-${n}`);
const box = (name: string) => screen.getByRole("textbox", { name });
const save = () => screen.getByTestId("save-payouts");

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  // A TD runs the game from a phone.
  screenWidth(390);
});

describe("PayoutEditorSheet", () => {
  it("opens full screen on the structure paid now, each place's prize from the pool, with nothing to save yet", async () => {
    mockEditor();
    renderSheet();

    const sheet = await screen.findByRole("dialog", { name: "Edit payouts" });
    expect(sheet).toHaveClass("w-full");
    expect(await screen.findByRole("radio", { name: /^Standard/ })).toBeChecked();
    expect(screen.getByTestId("payout-pool")).toHaveTextContent("Available for prizes $720");
    // Standard shares all of it in whole dollars: nothing is left over.
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Adds up to the $720 available for prizes exactly");
    expect(place(1)).toHaveTextContent("1st 50%$360");
    expect(place(3)).toHaveTextContent("3rd 20%$144");
    expect(save()).toBeDisabled();
    expect(save()).toHaveTextContent("No changes to save");
    // Every control a thumb taps is 44 px.
    for (const option of screen.getAllByRole("radio")) expect(option.closest("label")).toHaveClass("min-h-11");
    expect(screen.getByTestId("customise-payouts")).toHaveClass("h-11");
  });

  it("switches to a preset and saves it, showing the answer at once", async () => {
    const sent = mockEditor(apTournament(), { payoutStructure: "top5" });
    const { user, queryClient, onOpenChange } = renderSheet();

    await user.click(await screen.findByRole("radio", { name: /^Top 5/ }));
    expect(place(1)).toHaveTextContent("$288");
    expect(place(5)).toHaveTextContent("5th 5%$36");
    await user.click(save());

    await waitFor(() => expect(sent).toEqual([{ payoutStructure: "top5" }]));
    expect(await screen.findByText("Payouts saved")).toBeInTheDocument();
    expect(screen.getByText("Top 5 (40/25/20/10/5)")).toBeInTheDocument();
    expect(queryClient.getQueryData(qk.tournaments.prizePool("t1"))).toMatchObject({ breakdown: { structure: { used: "top5" } } });
    expect(queryClient.getQueryData(qk.tournaments.detail("t1"))).toMatchObject({ payoutStructure: "top5" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sets custom places as a percentage or a fixed amount, with what each pays and the live sum, on number keypads", async () => {
    const sent = mockEditor();
    const { user } = renderSheet();

    await user.click(await screen.findByTestId("customise-payouts"));
    expect(screen.getByRole("radio", { name: /^Custom/ })).toBeChecked();
    expect(box("1st place")).toHaveValue("50");
    expect(box("1st place")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Adds up to the $720 available for prizes exactly");

    // 2nd as a fixed amount keeps what it paid.
    const second = within(place(2)).getByRole("group", { name: "How 2nd place is set" });
    await user.click(within(second).getByRole("button", { name: "Fixed amount" }));
    expect(within(second).getByRole("button", { name: "Fixed amount" })).toHaveAttribute("aria-pressed", "true");
    expect(within(second).getByRole("button", { name: "Fixed amount" })).toHaveClass("h-11", "w-11");
    expect(box("2nd place")).toHaveValue("216");
    expect(screen.getByTestId("payout-pays-2")).toHaveTextContent("$216 (fixed)");

    // 3rd down to 10%: the $72 left over goes to the club's fee (round 7), and nobody is asked where.
    await user.clear(box("3rd place"));
    await user.type(box("3rd place"), "10");
    expect(screen.getByTestId("payout-pays-3")).toHaveTextContent("= $72");
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Leftover $72 → AP");
    expect(screen.getByTestId("payout-pays-1")).toHaveTextContent("= $360");
    expect(screen.queryByRole("radio", { name: /Add it to 1st|Carry it over/ })).not.toBeInTheDocument();

    await user.click(screen.getByTestId("add-payout-place"));
    expect(box("4th place")).toHaveValue("5");
    expect(screen.getByTestId("payout-pays-4")).toHaveTextContent("= $36");
    expect(screen.getByTestId("payout-pays-1")).toHaveTextContent("= $360");
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Leftover $36 → AP");
    await user.click(within(screen.getByRole("group", { name: "Common reasons" })).getByRole("button", { name: "Short field" }));
    // A leftover is the club's fee: Save asks nothing more.
    await user.click(save());

    await waitFor(() =>
      expect(sent).toEqual([
        {
          payoutStructure: "custom",
          places: [
            { kind: "percent", percent: 50 },
            { kind: "amount", amount: "216.00" },
            { kind: "percent", percent: 10 },
            { kind: "percent", percent: 5 },
          ],
          reason: "Short field",
        },
      ]),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Custom: 1st 50%, 2nd $216, 3rd 10%, 4th 5%")).toBeInTheDocument();
  });

  it("starts Custom from the places stored before, whatever a leftover was once set to do", async () => {
    // A choice stored before round 7 ("carry") is no longer read: the leftover is the club's fee.
    const stored = apTournament({ payoutStructure: "top3", customPayouts: '{"v":2,"places":[{"amountCents":50000},{"percent":20}]}' });
    mockEditor(stored);
    const { user } = renderSheet(stored);

    await user.click(await screen.findByRole("radio", { name: /^Custom/ }));
    expect(box("1st place")).toHaveValue("500");
    expect(box("2nd place")).toHaveValue("20");
    expect(screen.getByTestId("payout-pays-1")).toHaveTextContent("$500 (fixed)");
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Leftover $76 → AP");
  });

  it("pays prizes above the money available as set, saving them once the TD has read what the club adds", async () => {
    const sent = mockEditor();
    const { user } = renderSheet();

    await user.click(await screen.findByTestId("customise-payouts"));
    await user.click(within(place(1)).getByRole("button", { name: "Fixed amount" }));
    await user.clear(box("1st place"));
    await user.type(box("1st place"), "600");

    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Added by the club: $240");
    expect(screen.getByTestId("added-by-club")).toHaveTextContent(
      "Added by the club: $240. The prizes add up to $960, $240 more than the $720 available for prizes: the club adds $240.",
    );
    expect(screen.getByTestId("payout-pays-1")).toHaveTextContent("$600 (fixed)");
    await user.click(save());
    const confirm = await screen.findByRole("alertdialog", { name: "The club adds $240" });
    expect(confirm).toHaveTextContent("They are paid as set and the club adds $240");
    expect(sent).toEqual([]);

    // "Change the prizes" goes back to the boxes, nothing sent.
    await user.click(within(confirm).getByRole("button", { name: "Change the prizes" }));
    expect(sent).toEqual([]);
    await user.click(save());
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save: the club adds $240" }));
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("pays exact prizes as typed, the rest going to the AP with nothing to ask (round 7)", async () => {
    const sent = mockEditor();
    const { user } = renderSheet();

    await user.click(await screen.findByTestId("customise-payouts"));
    for (const [n, amount] of [[1, "400"], [2, "150"], [3, "50"]] as const) {
      await user.click(within(place(n)).getByRole("button", { name: "Fixed amount" }));
      await user.clear(box(`${["1st", "2nd", "3rd"][n - 1]} place`));
      await user.type(box(`${["1st", "2nd", "3rd"][n - 1]} place`), amount);
    }
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Leftover $120 → AP");
    expect(screen.getByTestId("payout-pays-1")).toHaveTextContent("$400 (fixed)");
    expect(screen.queryByTestId("added-by-club")).not.toBeInTheDocument();

    await user.click(save());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(sent[0]).toEqual({ payoutStructure: "custom", places: [{ kind: "amount", amount: "400.00" }, { kind: "amount", amount: "150.00" }, { kind: "amount", amount: "50.00" }] });
  });

  it("says what a prize pool set by hand below the money available leaves to the AP, on a standard structure", async () => {
    const manual = apTournament({ manualPrizePool: "600.00" });
    const sent = mockEditor(manual, { payoutStructure: "top5" });
    const { user } = renderSheet(manual);

    expect(await screen.findByTestId("payout-pool")).toHaveTextContent("Prize pool set at $600 · $720 available");
    expect(place(1)).toHaveTextContent("$300");
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Leftover $120 → AP");
    await user.click(screen.getByRole("radio", { name: /^Top 5/ }));
    expect(place(1)).toHaveTextContent("$240");
    await user.click(save());

    await waitFor(() => expect(sent).toEqual([{ payoutStructure: "top5" }]));
    expect(await screen.findByText("Top 5 (40/25/20/10/5); Leftover $120 → AP")).toBeInTheDocument();
  });

  it("says what is wrong with a place, on that place, before sending", async () => {
    const sent = mockEditor();
    const { user } = renderSheet();

    await user.click(await screen.findByTestId("customise-payouts"));
    await user.clear(box("2nd place"));
    await user.tab();
    expect(await within(place(2)).findByText("Enter a percentage, e.g. 25 or 12.5")).toBeInTheDocument();
    expect(box("2nd place")).toHaveAttribute("aria-invalid", "true");

    await user.type(box("2nd place"), "60");
    await user.click(save());
    expect(await within(place(2)).findByText("Place 2 pays a bigger share than a place above it")).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("says when the percentages add up to more than 100%, until they no longer do", async () => {
    const sent = mockEditor();
    const { user } = renderSheet();

    await user.click(await screen.findByTestId("customise-payouts"));
    await user.clear(box("1st place"));
    await user.type(box("1st place"), "60");
    await user.clear(box("2nd place"));
    await user.type(box("2nd place"), "50");
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("The places add up to $936, $216 more than the $720 available for prizes");
    expect(screen.queryByTestId("added-by-club")).not.toBeInTheDocument();
    await user.click(save());

    expect(await screen.findByTestId("payout-places-error")).toHaveTextContent("The percentages add up to 130%, over 100%");
    await user.clear(box("2nd place"));
    await user.type(box("2nd place"), "20");
    expect(screen.queryByTestId("payout-places-error")).not.toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("puts the server's refusal of a place on that place", async () => {
    server.use(
      http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(apTournament(), players))),
      http.put("/api/tournaments/t1/prize-pool/payouts", () =>
        apiError(400, "VALIDATION", "Invalid request", [{ path: ["places", 1], message: "Place 2 must be an amount above $0 and at most $1,000,000" }]),
      ),
    );
    const { user } = renderSheet();

    await user.click(await screen.findByTestId("customise-payouts"));
    await user.clear(box("3rd place"));
    await user.type(box("3rd place"), "10");
    await user.click(save());

    expect(await within(place(2)).findByText("Place 2 must be an amount above $0 and at most $1,000,000")).toBeInTheDocument();
    expect(box("2nd place")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog", { name: "Edit payouts" })).toBeInTheDocument();
  });

  it("keeps the editor open with the server's reason once the tournament has closed", async () => {
    server.use(
      http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(apTournament(), players))),
      http.put("/api/tournaments/t1/prize-pool/payouts", () => apiError(409, "TOURNAMENT_CLOSED", "This tournament is completed: its payouts cannot change")),
      http.get("/api/tournaments/t1", () => HttpResponse.json(apTournament({ status: "completed" }))),
    );
    const { user, onOpenChange } = renderSheet();

    await user.click(await screen.findByRole("radio", { name: /^Top 3/ }));
    await user.click(save());

    expect(await screen.findByText("This tournament is completed: its payouts cannot change")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("warns that a locked pool's published payouts will change", async () => {
    const locked = apTournament({ prizePoolLocked: true });
    mockEditor(locked);
    const { user } = renderSheet(locked);

    await screen.findByRole("radio", { name: /^Standard/ });
    expect(screen.queryByTestId("payouts-locked-warning")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /^Top 8/ }));
    expect(screen.getByTestId("payouts-locked-warning")).toHaveTextContent("Prize pool is locked — published payouts will change.");
  });

  it("removes a place, never the last, moving focus to the place now in its spot", async () => {
    mockEditor();
    const { user } = renderSheet();

    await user.click(await screen.findByTestId("customise-payouts"));
    await user.click(screen.getByRole("button", { name: "Remove 2nd place" }));
    expect(screen.queryByRole("textbox", { name: "3rd place" })).not.toBeInTheDocument();
    expect(box("2nd place")).toHaveValue("20");
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 2nd place" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Remove 2nd place" }));
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("payout-sum")).toHaveTextContent("Leftover $360 → AP");
  });

  it("says when more places are paid than players have paid", async () => {
    server.use(http.get("/api/tournaments/t1/prize-pool", () => HttpResponse.json(prizePoolDto(apTournament(), entrants(2)))));
    const { user } = renderSheet();

    await user.click(await screen.findByRole("radio", { name: /^Top 5/ }));
    expect(screen.getByText("Only 2 players have paid: places below 2nd are paid only once more players pay. Until then, what they would pay goes to AP.")).toBeInTheDocument();
  });
});
