import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { AdminActionsPage } from "./admin-actions-page";

const tournament = { id: "t1", name: "Friday Freezeout", rebuyAmount: "20.00", addonAmount: null, viewer: { canManage: true, canOwn: true } };
const action = {
  id: "a1",
  tournamentId: "t1",
  playerId: "p1",
  actionType: "rebuy",
  targetPlayerId: null,
  timestamp: "2026-10-23T08:00:00.000Z",
  player: { id: "p1", name: "Ann", imageUrl: null },
  targetPlayer: null,
};

function renderPage() {
  return renderWithApp(<AdminActionsPage />, { path: "/admin/actions/t1", route: "/admin/actions/:tournamentId" });
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("AdminActionsPage (TN2-02)", () => {
  it("shows why the server refused a request beside it, and dismisses it from the list", async () => {
    let pending = [action];
    let dismissed: string | undefined;
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournament)),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json(pending)),
      http.post("/api/pending-actions/a1/confirm", () => apiError(409, "MAX_REBUYS_REACHED", "This tournament allows at most 1 re-buy per player")),
      http.delete("/api/pending-actions/:id", ({ params }) => {
        dismissed = String(params.id);
        pending = [];
        return HttpResponse.json({ success: true });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: /Confirm/ }));
    expect(await screen.findByTestId("refusal-a1")).toHaveTextContent("This tournament allows at most 1 re-buy per player");

    await user.click(screen.getByTestId("dismiss-action-a1"));
    await waitFor(() => expect(dismissed).toBe("a1"));
    expect(await screen.findAllByText("No pending actions")).not.toHaveLength(0);
  });

  it("asks whether a re-buy asked for before the player went out puts them back in, and sends the answer (TN-RV2-01)", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournament)),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([action])),
      http.post("/api/pending-actions/a1/confirm", async ({ request }) => {
        const text = await request.text();
        const body: unknown = text ? JSON.parse(text) : undefined;
        bodies.push(body);
        if (body === undefined) {
          return apiError(409, "REBUY_BEFORE_ELIMINATION", "Ann asked for this re-buy before being knocked out.", {
            playerName: "Ann",
            requestedAt: "2026-10-23T08:00:00.000Z",
            eliminatedAt: "2026-10-23T08:20:00.000Z",
          });
        }
        return HttpResponse.json({
          success: true,
          registration: { id: "r1", player: { id: "p1", name: "Ann", imageUrl: null } },
          reentered: false,
          target: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: /Confirm/ }));
    const question = await screen.findByTestId("reentry-question");
    expect(question).toHaveTextContent("Put Ann back in?");
    expect(question).toHaveTextContent(/while still in, and was knocked out at/);
    expect(screen.queryByTestId("refusal-a1")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("reentry-record-only"));
    await waitFor(() => expect(bodies).toEqual([undefined, { reenter: false }]));
    await waitFor(() => expect(screen.queryByTestId("reentry-question")).not.toBeInTheDocument());
  });
});
