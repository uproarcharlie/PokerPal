import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { qk } from "@/lib/api/query-keys";
import { registrationDto } from "@test/helpers/f1-tournaments";
import { AwardHighHandDialog } from "./award-high-hand-dialog";

/** The pot was fetched when the dialog opened, so the amount shown is current. */
const potChecked = { potCheck: "current", onCheckPot: () => {} } as const;

const entrant = (id: string, name: string, extra: Parameters<typeof registrationDto>[3] = {}) =>
  registrationDto(id, name, 1, { enteringHighHands: true, ...extra });

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("AwardHighHandDialog (TN2-04)", () => {
  it("records a tie once every prize is awarded: the new winner shares a winner's prize, half each", async () => {
    let sent: unknown;
    server.use(
      http.put("/api/registrations/:id", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({});
      }),
    );
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "30.00" }), entrant("r2", "Bea")];
    const user = userEvent.setup();
    renderWithApp(<AwardHighHandDialog open onOpenChange={() => {}} tournamentId="t1" registrations={registrations} nextAwardCents={null} {...potChecked} />);

    // With every prize awarded, nothing can be assigned until the tie is chosen.
    await user.click(screen.getByRole("combobox", { name: "Player" }));
    await user.click(await screen.findByRole("option", { name: "Bea" }));
    expect(screen.getByTestId("assign-high-hand")).toBeDisabled();

    await user.click(screen.getByTestId("split-with"));
    await user.click(await screen.findByRole("option", { name: "Split with Ann ($30)" }));
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("15.00");
    await user.click(screen.getByTestId("assign-high-hand"));

    await waitFor(() => expect(sent).toEqual({ highHandWinner: true, highHandSplitWith: "r1" }));
  });

  it("refreshes the tournament after an award: a tie adds a prize, which the next award is worked out from (P2REV1-03)", async () => {
    server.use(http.put("/api/registrations/:id", () => HttpResponse.json({})));
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "100.00" }), entrant("r2", "Bea")];
    const user = userEvent.setup();
    const { queryClient } = renderWithApp(
      <AwardHighHandDialog open onOpenChange={() => {}} tournamentId="t1" registrations={registrations} nextAwardCents={null} {...potChecked} />,
    );
    queryClient.setQueryData(qk.tournaments.detail("t1"), { id: "t1", highHandPayouts: 2 });

    await user.click(screen.getByRole("combobox", { name: "Player" }));
    await user.click(await screen.findByRole("option", { name: "Bea" }));
    await user.click(screen.getByTestId("split-with"));
    await user.click(await screen.findByRole("option", { name: "Split with Ann ($100)" }));
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("50.00");
    await user.click(screen.getByTestId("assign-high-hand"));

    await waitFor(() => expect(queryClient.getQueryState(qk.tournaments.detail("t1"))?.isInvalidated).toBe(true));
  });

  it("awards the next prize by default while prizes are left", async () => {
    let sent: unknown;
    server.use(
      http.put("/api/registrations/:id", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({});
      }),
    );
    const registrations = [entrant("r1", "Ann", { highHandWinner: true, highHandAmount: "15.00" }), entrant("r2", "Bea")];
    const user = userEvent.setup();
    renderWithApp(<AwardHighHandDialog open onOpenChange={() => {}} tournamentId="t1" registrations={registrations} nextAwardCents={1500} {...potChecked} />);

    await user.click(screen.getByRole("combobox", { name: "Player" }));
    await user.click(await screen.findByRole("option", { name: "Bea" }));
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("15.00");
    await user.click(screen.getByTestId("assign-high-hand"));

    await waitFor(() => expect(sent).toEqual({ highHandWinner: true }));
  });

  describe("the amount is worked out from the pot as it is now (P3REV-PERF-HIGHHAND-STALE-AMOUNT)", () => {
    const registrations = [entrant("r1", "Ann"), entrant("r2", "Bea")];

    it("says it is checking the pot, shows no amount and holds Assign until the pot is in", async () => {
      const user = userEvent.setup();
      renderWithApp(
        <AwardHighHandDialog open onOpenChange={() => {}} tournamentId="t1" registrations={registrations} nextAwardCents={1500} potCheck="checking" onCheckPot={() => {}} />,
      );

      await user.click(screen.getByRole("combobox", { name: "Player" }));
      await user.click(await screen.findByRole("option", { name: "Bea" }));

      expect(screen.getByTestId("high-hand-amount")).toHaveValue("");
      expect(screen.getByTestId("high-hand-amount")).toHaveAccessibleDescription(expect.stringContaining("Checking the pot as it is now…"));
      expect(screen.getByTestId("assign-high-hand")).toHaveAttribute("aria-disabled", "true");
    });

    it("says an amount may be out of date when the pot could not be checked, and checks again", async () => {
      let sent: unknown;
      server.use(
        http.put("/api/registrations/:id", async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({});
        }),
      );
      const onCheckPot = vi.fn();
      const user = userEvent.setup();
      renderWithApp(
        <AwardHighHandDialog open onOpenChange={() => {}} tournamentId="t1" registrations={registrations} nextAwardCents={1500} potCheck="failed" onCheckPot={onCheckPot} />,
      );

      expect(screen.getByTestId("high-hand-amount")).toHaveValue("15.00");
      expect(screen.getByTestId("high-hand-amount")).toHaveAccessibleDescription(expect.stringContaining("may be out of date"));
      await user.click(screen.getByRole("button", { name: "Check again" }));
      expect(onCheckPot).toHaveBeenCalledTimes(1);

      // The server decides what is paid, so the award can still be made.
      await user.click(screen.getByRole("combobox", { name: "Player" }));
      await user.click(await screen.findByRole("option", { name: "Bea" }));
      await user.click(screen.getByTestId("assign-high-hand"));
      await waitFor(() => expect(sent).toEqual({ highHandWinner: true }));
    });
  });
});
