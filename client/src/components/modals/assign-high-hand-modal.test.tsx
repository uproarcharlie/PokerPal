import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import { AssignHighHandModal } from "./assign-high-hand-modal";

const entrant = (id: string, name: string, extra: object = {}) => ({
  id,
  playerId: `p-${id}`,
  player: { name },
  enteringHighHands: true,
  ...extra,
});

beforeAll(() => {
  // jsdom has no pointer capture or scrollIntoView, which Radix's Select calls when it opens.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("AssignHighHandModal (TN2-04)", () => {
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
    renderWithApp(<AssignHighHandModal open onOpenChange={() => {}} tournamentId="t1" registrations={registrations} nextAwardCents={null} />);

    // With every prize awarded, nothing can be assigned until the tie is chosen.
    await user.click(screen.getByRole("combobox", { name: "Player*" }));
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
    renderWithApp(<AssignHighHandModal open onOpenChange={() => {}} tournamentId="t1" registrations={registrations} nextAwardCents={null} />);
    // The modal invalidates through the app's own client, as the tournament page reads it.
    appQueryClient.setQueryData(["/api/tournaments", "t1"], { id: "t1", highHandPayouts: 2 });

    await user.click(screen.getByRole("combobox", { name: "Player*" }));
    await user.click(await screen.findByRole("option", { name: "Bea" }));
    await user.click(screen.getByTestId("split-with"));
    await user.click(await screen.findByRole("option", { name: "Split with Ann ($100)" }));
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("50.00");
    await user.click(screen.getByTestId("assign-high-hand"));

    await waitFor(() => expect(appQueryClient.getQueryState(["/api/tournaments", "t1"])?.isInvalidated).toBe(true));
    appQueryClient.removeQueries({ queryKey: ["/api/tournaments", "t1"] });
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
    renderWithApp(<AssignHighHandModal open onOpenChange={() => {}} tournamentId="t1" registrations={registrations} nextAwardCents={1500} />);

    await user.click(screen.getByRole("combobox", { name: "Player*" }));
    await user.click(await screen.findByRole("option", { name: "Bea" }));
    expect(screen.getByTestId("high-hand-amount")).toHaveValue("15.00");
    await user.click(screen.getByTestId("assign-high-hand"));

    await waitFor(() => expect(sent).toEqual({ highHandWinner: true }));
  });
});
