import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, pendingActionDto, phoneLayout, tournamentDto } from "@test/helpers/f1-tournaments";
import { seatingDto } from "@test/helpers/seating-dto";
import { DESK_REFRESH_MS } from "../staff-hooks";
import AdminActionsPage from "./admin-actions";

const tournament = tournamentDto({ rebuyAmount: "20.00" });
const action = pendingActionDto("a1", "rebuy");

function renderPage() {
  return renderWithApp(<AdminActionsPage />, { path: "/admin/actions/t1", route: "/admin/actions/:tournamentId" });
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  server.use(http.get("/api/clubs/c1", () => HttpResponse.json(clubDto())));
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

  it("says a re-entry whose old seat was taken is waiting for a seat, with a way to seat them (TDN2-WAITING-NOT-FLAGGED)", async () => {
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournament)),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([action])),
      http.post("/api/pending-actions/a1/confirm", () =>
        HttpResponse.json({ success: true, registration: { id: "r1", player: { id: "p1", name: "Ann", imageUrl: null } }, reentered: true, target: null }),
      ),
      http.get("/api/tournaments/t1/seating", () =>
        HttpResponse.json(seatingDto({ tables: [{ id: "tb1", number: 1, seats: 9, seated: { 3: { id: "r2", name: "Bob" } } }], unseated: [{ id: "r1", name: "Ann" }] })),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(within(await screen.findByRole("table")).getByRole("button", { name: /Confirm/ }));
    const notifications = within(screen.getByTestId("notifications"));
    expect(await notifications.findByText("Ann is back in with the re-buy, waiting for a seat.")).toBeInTheDocument();
    expect(notifications.getByRole("button", { name: "Seat now" })).toBeInTheDocument();
  });

  it("handles each request's own answer when a second one is confirmed before the first answer came (P3REV0-PARITY-03)", async () => {
    const second = pendingActionDto("a2", "addon");
    let answerFirst: () => void = () => {};
    const firstAnswered = new Promise<void>((resolve) => {
      answerFirst = resolve;
    });
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ rebuyAmount: "20.00", addonAmount: "10.00" }))),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([action, second])),
      http.post("/api/pending-actions/a1/confirm", async () => {
        await firstAnswered;
        return apiError(409, "REBUY_BEFORE_ELIMINATION", "Ann asked for this re-buy before being knocked out.", {
          playerName: "Ann",
          requestedAt: "2026-10-23T08:00:00.000Z",
          eliminatedAt: "2026-10-23T08:20:00.000Z",
        });
      }),
      http.post("/api/pending-actions/a2/confirm", () =>
        HttpResponse.json({ success: true, registration: { id: "r2", player: { id: "p2", name: "Bob", imageUrl: null } }, reentered: false, target: null }),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    const table = await screen.findByRole("table");
    const [confirmFirst, confirmSecond] = within(table).getAllByRole("button", { name: /Confirm/ });
    await user.click(confirmFirst);
    await user.click(confirmSecond);

    expect(await screen.findByText("Player action has been confirmed.")).toBeInTheDocument();
    // The first request is still on its way: its buttons still wait for it.
    expect(confirmFirst).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("dismiss-action-a1")).toHaveAttribute("aria-disabled", "true");

    answerFirst();
    expect(await screen.findByTestId("reentry-question")).toHaveTextContent("Put Ann back in?");
  });

  it("names each request and what it costs, and who a knockout is claimed against", async () => {
    const knockout = pendingActionDto("a2", "knockout", { targetPlayerId: "p2", targetPlayer: { id: "p2", name: "Bob", imageUrl: null } });
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournament)),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([action, knockout])),
    );
    renderPage();

    const rows = within(await screen.findByRole("table", { name: "Player requests waiting" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Re-buy");
    expect(rows[1]).toHaveTextContent("$20.00");
    expect(rows[1]).toHaveTextContent("9:00 pm");
    expect(rows[2]).toHaveTextContent("Knockout");
    expect(rows[2]).toHaveTextContent("BobKnocked out");
    expect(screen.getByLabelText("2 waiting")).toBeInTheDocument();
  });

  it("takes a confirmed request off the list, and refreshes the tournament it changed", async () => {
    let pending = [action];
    let tournamentReads = 0;
    server.use(
      http.get("/api/tournaments/t1", () => {
        tournamentReads++;
        return HttpResponse.json(tournament);
      }),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json(pending)),
      http.post("/api/pending-actions/a1/confirm", () => {
        pending = [];
        return HttpResponse.json({ success: true, registration: { id: "r1", player: { id: "p1", name: "Ann", imageUrl: null } }, reentered: false, target: null });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Player action has been confirmed.")).toBeInTheDocument();
    expect(await screen.findByText("No pending actions")).toBeInTheDocument();
    expect(tournamentReads).toBe(2);
  });

  it("shows each request once on a phone", async () => {
    phoneLayout();
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournament)),
      http.get("/api/tournaments/t1/pending-actions", () => HttpResponse.json([action])),
    );
    renderPage();

    expect(await screen.findAllByRole("button", { name: "Confirm" })).toHaveLength(1);
    expect(screen.getAllByTestId("dismiss-action-a1")).toHaveLength(1);
    // The buttons close the card in their own wrapping row, not inside the label/value grid, whose value
    // column they used to widen past a 375 px screen (MA-REV-01).
    const dismiss = screen.getByTestId("dismiss-action-a1");
    expect(dismiss.closest("dl")).toBeNull();
    expect(dismiss.closest("li")).not.toBeNull();
    expect(dismiss.parentElement).toHaveClass("flex-wrap");
  });

  it("tells someone who does not run the club so, without asking for the requests", async () => {
    let asked = false;
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ viewer: { canManage: false, canOwn: false } }))),
      http.get("/api/tournaments/t1/pending-actions", () => {
        asked = true;
        return HttpResponse.json([]);
      }),
    );
    renderPage();

    expect(await screen.findByRole("heading", { name: "Access Denied" })).toBeInTheDocument();
    expect(asked).toBe(false);
  });

  it("counts the requests only once they are in: never a 0 beside a list still loading (P3REV3-CQ-05)", async () => {
    let answer: () => void = () => {};
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournament)),
      http.get("/api/tournaments/t1/pending-actions", async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return HttpResponse.json([action, pendingActionDto("a2", "addon")]);
      }),
    );
    renderPage();

    const count = await screen.findByTestId("pending-actions-count");
    expect(count).toHaveTextContent("Loading");
    expect(count).not.toHaveTextContent("0");
    expect(count).not.toHaveAttribute("aria-label");
    answer();
    await waitFor(() => expect(count).toHaveTextContent("2"));
    expect(count).toHaveAttribute("aria-label", "2 waiting");
  });

  it("says the requests could not be loaded rather than that there are none", async () => {
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json(tournament)),
      http.get("/api/tournaments/t1/pending-actions", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("The player requests could not be loaded");
    expect(screen.queryByText("No pending actions")).not.toBeInTheDocument();
  });

  it("frames its not-found state in the page's own inset, once (P3REV5-CQ-04)", async () => {
    server.use(http.get("/api/tournaments/t1", () => apiError(404, "NOT_FOUND", "Tournament not found")));
    renderPage();

    const heading = await screen.findByRole("heading", { name: "Tournament not found" });
    const state = heading.parentElement;
    expect(state?.parentElement).toHaveClass("px-4", "py-6");
    expect(state).not.toHaveClass("mx-4");
  });

  it("stops asking, and says why, once the server refuses the desk for good (P3REV4-PERF-D)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let allowed = true;
      let asked = 0;
      server.use(
        http.get("/api/tournaments/t1", () => HttpResponse.json(tournament)),
        http.get("/api/tournaments/t1/pending-actions", () => {
          asked += 1;
          return allowed ? HttpResponse.json([action]) : apiError(403, "FORBIDDEN", "Only this club's staff can do that");
        }),
      );
      renderPage();
      await screen.findByRole("table");

      allowed = false;
      await vi.advanceTimersByTimeAsync(DESK_REFRESH_MS + 100);
      await waitFor(() => expect(screen.getAllByRole("status").some((status) => /Only this club's staff can do that/.test(status.textContent ?? ""))).toBe(true));
      const refused = asked;

      await vi.advanceTimersByTimeAsync(DESK_REFRESH_MS * 4);
      expect(asked).toBe(refused);
      expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

