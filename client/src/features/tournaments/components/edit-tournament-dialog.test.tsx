import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, noBankDetails, recordBodies, registrationDto, tournamentDto } from "@test/helpers/f1-tournaments";
import type { PublicRegistration } from "@shared/api/public";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { hostPhone, listedTournament } from "@test/helpers/r10-high-hands";
import { EditTournamentDialog } from "./edit-tournament-dialog";

function mockSave(answer?: (body: unknown) => Response, registrations: PublicRegistration[] = []) {
  const saved = recordBodies();
  server.use(
    http.get("/api/seasons", () => HttpResponse.json([])),
    noBankDetails(),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json(registrations)),
    http.put("/api/tournaments/t1", async ({ request }) => {
      const body = await saved.record(request);
      return answer ? answer(body) : HttpResponse.json(tournamentDto());
    }),
  );
  return saved.bodies;
}

function renderEdit(tournament: TournamentDetailDto = tournamentDto({ status: "registration" }), club = clubDto()) {
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  renderWithApp(<EditTournamentDialog tournament={tournament} club={club} open onOpenChange={onOpenChange} />);
  return { user, onOpenChange };
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("EditTournamentDialog (CA-14)", () => {
  it("starts from the tournament's settings and sends only what was changed", async () => {
    const saved = mockSave();
    const { user, onOpenChange } = renderEdit();

    expect(screen.getByRole("dialog", { name: "Edit Tournament" })).toBeInTheDocument();
    expect(screen.getByTestId("tournament-name")).toHaveValue("Friday Freezeout");
    expect(screen.getByLabelText("Club")).toHaveValue("Central Stars");
    expect(screen.getByTestId("buyin-amount")).toHaveValue("100.00");
    expect(screen.getByTestId("rake-amount")).toHaveValue("5.00");

    await user.clear(screen.getByTestId("tournament-name"));
    await user.type(screen.getByTestId("tournament-name"), "Friday Deepstack");
    await user.clear(screen.getByTestId("max-players"));
    await user.type(screen.getByTestId("max-players"), "40");
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() => expect(saved).toEqual([{ name: "Friday Deepstack", maxPlayers: 40 }]));
    expect(await screen.findByText("Tournament updated")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows and reads the start on the club's clock, as the page shows it, wherever the device is (P3REV-PARITY-TZ-01)", async () => {
    const saved = mockSave();
    const { user } = renderEdit(
      tournamentDto({ status: "registration", startDateTime: "2026-10-24T06:30:00.000Z" }),
      clubDto({ timezone: "Australia/Sydney" }),
    );

    // 06:30 UTC is 5:30 pm in Sydney, the club's zone, and the field says which zone it is in.
    const start = screen.getByLabelText("Start Date & Time*");
    expect(start).toHaveValue("2026-10-24T17:30");
    expect(start).toHaveAccessibleDescription(expect.stringContaining("Australia/Sydney"));

    fireEvent.change(start, { target: { value: "2026-10-24T19:30" } });
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() => expect(saved).toEqual([{ startDateTime: "2026-10-24T08:30:00.000Z" }]));
  });

  it("sends a new AP type together with its amount", async () => {
    const saved = mockSave();
    const { user } = renderEdit();

    await user.selectOptions(screen.getByTestId("rake-type"), "Percentage (%)");
    await user.clear(screen.getByTestId("rake-amount"));
    await user.type(screen.getByTestId("rake-amount"), "10");
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() => expect(saved).toEqual([{ rakeType: "percentage", rakeAmount: "10.00" }]));
  });

  it("sends nothing when nothing was changed", async () => {
    const saved = mockSave();
    const { user, onOpenChange } = renderEdit();

    await user.click(screen.getByTestId("save-tournament"));

    expect(await screen.findByText("Nothing to save")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(saved).toEqual([]);
  });

  it("keeps a finished tournament's money settings as they were paid, but lets it be renamed", async () => {
    const saved = mockSave();
    const { user } = renderEdit(tournamentDto({ status: "completed" }));

    expect(screen.getByTestId("money-locked-note")).toHaveTextContent("stay as they were paid and scored");
    expect(screen.getByTestId("buyin-amount")).toBeDisabled();
    expect(screen.getByTestId("rake-type")).toBeDisabled();
    expect(screen.getByTestId("add-high-hand")).toBeDisabled();
    await user.clear(screen.getByTestId("tournament-name"));
    await user.type(screen.getByTestId("tournament-name"), "Friday Final");
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() => expect(saved).toEqual([{ name: "Friday Final" }]));
  });

  it("shows the server's refusal and stays open", async () => {
    mockSave(() => apiError(409, "AP_EXCEEDS_GROSS", "The manual AP total is more than the money taken in"));
    const { user, onOpenChange } = renderEdit();

    // $6 still covers the $5 AP per buy-in (a lower price is refused on its box first: R4-CQ-07).
    await user.clear(screen.getByTestId("buyin-amount"));
    await user.type(screen.getByTestId("buyin-amount"), "6");
    await user.click(screen.getByTestId("save-tournament"));

    expect(await screen.findByText("The manual AP total is more than the money taken in")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  describe("never re-prices entries already recorded without saying so (P3REV0-PARITY-EDIT-REPRICE)", () => {
    const withRebuys = () => tournamentDto({ status: "in_progress", rebuyAmount: "25.00", addonAmount: "20.00" });

    it("keeps re-buys and add-ons on while players have them, and points to the pool lock", async () => {
      mockSave(undefined, [registrationDto("r1", "Ann", 1, { rebuys: 2, addons: 0 }), registrationDto("r2", "Bo", 1, { rebuys: 1, addons: 0 })]);
      renderEdit(withRebuys());

      await waitFor(() => expect(screen.getByTestId("enable-rebuys")).toBeDisabled());
      expect(screen.getByTestId("enable-rebuys")).toBeChecked();
      expect(screen.getByTestId("enable-rebuys")).toHaveAccessibleDescription(
        "3 re-buys are recorded, so re-buys stay on. To stop taking more, lock the prize pool.",
      );
      // No add-ons are recorded yet, so add-ons can still be switched off.
      expect(screen.getByTestId("enable-addons")).toBeEnabled();
    });

    it("keeps the high hand on the list while players are in it: their entry fees are in its pot", async () => {
      mockSave(undefined, [registrationDto("r1", "Ann", 1, { enteringHighHands: true }), registrationDto("r2", "Bo", 1, { enteringHighHands: false })]);
      renderEdit(tournamentDto({ status: "in_progress", enableHighHand: true, highHandAmount: "5.00" }));

      await waitFor(() => expect(screen.getByTestId("remove-high-hand-0")).toBeDisabled());
      expect(screen.getByTestId("remove-high-hand-0")).toHaveAccessibleDescription(
        "1 player is in the High hand: take them out of it first (Fix on their entry).",
      );
    });

    it("refuses a re-buy price cleared while re-buys are recorded, on its box, and sends nothing", async () => {
      const saved = mockSave(undefined, [registrationDto("r1", "Ann", 1, { rebuys: 2, addons: 0 })]);
      const { user, onOpenChange } = renderEdit(withRebuys());
      await waitFor(() => expect(screen.getByTestId("enable-rebuys")).toBeDisabled());

      await user.clear(screen.getByTestId("rebuy-amount"));
      await user.click(screen.getByTestId("save-tournament"));

      const price = screen.getByTestId("rebuy-amount");
      await waitFor(() => expect(price).toHaveAccessibleDescription(expect.stringContaining("2 re-buys are recorded: enter the re-buy price.")));
      expect(price).toHaveFocus();
      expect(saved).toEqual([]);
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("leaves a price alone that the edit did not touch, even with entries recorded at it", async () => {
      const saved = mockSave(undefined, [registrationDto("r1", "Ann", 1, { rebuys: 2, addons: 0 })]);
      const { user } = renderEdit(withRebuys());
      await waitFor(() => expect(screen.getByTestId("enable-rebuys")).toBeDisabled());

      await user.clear(screen.getByTestId("tournament-name"));
      await user.type(screen.getByTestId("tournament-name"), "Friday Rebuy");
      await user.click(screen.getByTestId("save-tournament"));

      await waitFor(() => expect(saved).toEqual([{ name: "Friday Rebuy" }]));
    });

    it("puts the server's refusal to switch re-buys off under the switch, and stays open", async () => {
      const saved = mockSave(() =>
        apiError(409, "REBUYS_RECORDED", "3 re-buys are recorded: take them off the players before removing the re-buy price."),
      );
      const { user, onOpenChange } = renderEdit(withRebuys());

      await user.click(screen.getByTestId("enable-rebuys"));
      await user.click(screen.getByTestId("save-tournament"));

      await waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0]).toMatchObject({ rebuyAmount: null });
      expect(screen.getByTestId("enable-rebuys")).toHaveAccessibleDescription(expect.stringContaining("3 re-buys are recorded"));
      expect(screen.getByTestId("enable-rebuys")).toHaveFocus();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("asks before new prices re-price what is recorded, then sends them confirmed", async () => {
      const message = "This re-prices what is already recorded: 3 re-buys from $25 to $20. The prize pool and what players owe change with it.";
      const saved = mockSave((body) =>
        (body as { repriceEntries?: boolean }).repriceEntries === true
          ? HttpResponse.json(tournamentDto())
          : apiError(409, "ENTRIES_REPRICED", message),
      );
      const { user, onOpenChange } = renderEdit(withRebuys());

      await user.clear(screen.getByTestId("rebuy-amount"));
      await user.type(screen.getByTestId("rebuy-amount"), "20");
      await user.click(screen.getByTestId("save-tournament"));

      const confirm = await screen.findByRole("alertdialog", { name: "Re-price recorded entries?" });
      expect(confirm).toHaveTextContent(message);
      expect(onOpenChange).not.toHaveBeenCalled();
      await user.click(within(confirm).getByRole("button", { name: "Re-price and save" }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(saved).toEqual([{ rebuyAmount: "20.00" }, { rebuyAmount: "20.00", repriceEntries: true }]);
      expect(await screen.findByText("Tournament updated")).toBeInTheDocument();
    });

    it("saves nothing when the TD keeps the old prices", async () => {
      const saved = mockSave(() => apiError(409, "ENTRIES_REPRICED", "This re-prices what is already recorded."));
      const { user, onOpenChange } = renderEdit(withRebuys());

      await user.clear(screen.getByTestId("rebuy-amount"));
      await user.type(screen.getByTestId("rebuy-amount"), "20");
      await user.click(screen.getByTestId("save-tournament"));
      const confirm = await screen.findByRole("alertdialog", { name: "Re-price recorded entries?" });
      await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(saved).toHaveLength(1);
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });
});

describe("EditTournamentDialog: the high hands (round 10, on a host's phone)", () => {
  const legacy = () => tournamentDto({ status: "registration", enableHighHand: true, highHandAmount: "10.00" });

  it("opens a game's one high hand of before as the first card, and resends nothing while it is left alone", async () => {
    hostPhone();
    const saved = mockSave();
    const { user } = renderEdit(legacy());

    expect(screen.getByTestId("high-hand-name-0")).toHaveValue("High hand");
    expect(screen.getByTestId("high-hand-fee-0")).toHaveValue("10.00");
    await user.clear(screen.getByTestId("tournament-name"));
    await user.type(screen.getByTestId("tournament-name"), "Friday Halves");
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() => expect(saved).toEqual([{ name: "Friday Halves" }]));
  });

  it("turns it into two high hands at $5 each, keeping the first by its id with its players, and sends the list alone", async () => {
    hostPhone();
    const saved = mockSave();
    const { user } = renderEdit(legacy());

    await user.click(screen.getByRole("button", { name: "Two high hands at $5 each" }));
    expect(screen.getByTestId("high-hand-name-0")).toHaveValue("First half");
    expect(screen.getByTestId("high-hand-name-1")).toHaveValue("Second half");
    expect(screen.getByTestId("all-high-hands-total")).toHaveTextContent("All high hands$10.00");
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() =>
      expect(saved).toEqual([
        {
          highHands: [
            { id: "legacy", name: "First half", entryFee: "5.00", winners: 1, rakeType: "none", note: "Before the break" },
            { name: "Second half", entryFee: "5.00", winners: 1, rakeType: "none", note: "After the break" },
          ],
        },
      ]),
    );
  });

  it("sets each high hand's prizes, AP and order, and checks each card's fee", async () => {
    hostPhone();
    const saved = mockSave();
    const { user } = renderEdit(listedTournament({ status: "registration" }));

    await user.click(within(screen.getByTestId("high-hand-card-0")).getByRole("radio", { name: "2 winners" }));
    await user.clear(screen.getByTestId("high-hand-fee-1"));
    await user.click(screen.getByTestId("save-tournament"));
    expect(await screen.findByTestId("high-hand-fee-1")).toHaveAccessibleDescription(expect.stringContaining("Enter an amount"));

    await user.type(screen.getByTestId("high-hand-fee-1"), "6");
    await user.selectOptions(screen.getByTestId("high-hand-rake-type-1"), "Fixed amount ($)");
    await user.type(screen.getByTestId("high-hand-rake-amount-1"), "2");
    await user.click(screen.getByRole("button", { name: "Move the Second half high hand up" }));
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() =>
      expect(saved).toEqual([
        {
          highHands: [
            { id: "hh2", name: "Second half", entryFee: "6.00", winners: 1, rakeType: "fixed", rakeAmount: "2.00", note: "After the break" },
            { id: "hh1", name: "First half", entryFee: "5.00", winners: 2, rakeType: "percentage", rakeAmount: "10.00", note: "Before the break" },
          ],
        },
      ]),
    );
  });

  it("puts the server's refusal about one high hand's awards on its card, and stays open", async () => {
    hostPhone();
    mockSave(() =>
      apiError(409, "HIGH_HAND_AWARDED", "First half high hand: every prize is awarded, so its pot cannot change", { highHandId: "hh1", name: "First half", awardedCents: 900, potCents: 900 }),
    );
    const { user, onOpenChange } = renderEdit(listedTournament({ status: "in_progress" }));

    await user.clear(screen.getByTestId("high-hand-fee-0"));
    await user.type(screen.getByTestId("high-hand-fee-0"), "6");
    await user.click(screen.getByTestId("save-tournament"));

    expect(await screen.findByTestId("high-hand-problem-0")).toHaveTextContent("every prize is awarded");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("asks before a new fee re-prices players already in a high hand, naming it", async () => {
    hostPhone();
    const message = "This re-prices what is already recorded: 2 entries in the First half high hand from $5 to $6.";
    const saved = mockSave((body) =>
      (body as { repriceEntries?: boolean }).repriceEntries
        ? HttpResponse.json(listedTournament())
        : apiError(409, "ENTRIES_REPRICED", message, { changes: [{ highHandId: "hh1", name: "First half", count: 2, fromCents: 500, toCents: 600 }] }),
    );
    const { user } = renderEdit(listedTournament({ status: "in_progress" }));

    await user.clear(screen.getByTestId("high-hand-fee-0"));
    await user.type(screen.getByTestId("high-hand-fee-0"), "6");
    await user.click(screen.getByTestId("save-tournament"));

    const ask = await screen.findByTestId("confirm-reprice");
    expect(within(ask).getByTestId("repricing-lines")).toHaveTextContent("2 entries in the First half high hand from $5.00 to $6.00");
    await user.click(within(ask).getByRole("button", { name: "Re-price and save" }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]).toMatchObject({ repriceEntries: true, highHands: [{ id: "hh1", entryFee: "6.00" }, { id: "hh2" }] });
  });

  it("says a page loaded before the high hands were listed is out of date, and offers to reload", async () => {
    hostPhone();
    mockSave(() => apiError(409, "HIGH_HAND_LISTED", "This game lists its high hands now: reload the page."));
    const { user } = renderEdit(legacy());

    await user.clear(screen.getByTestId("high-hand-fee-0"));
    await user.type(screen.getByTestId("high-hand-fee-0"), "12");
    await user.click(screen.getByTestId("save-tournament"));

    expect(await screen.findByText("This page is out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
