/**
 * The Register player sheet's high hands (round 10): the TD ticks the ones the player enters, each
 * with its fee (paid at the door), or "All high hands"; a game with one high hand has its one switch.
 * On a host's phone (390 × 844).
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import type { AutoSeatResultDto } from "@shared/api/seating";
import { highHandsOf } from "@shared/domain/high-hands";
import type { Cents } from "@shared/domain/money";
import { tournamentDto } from "@test/helpers/dto";
import { hostPhone, TWO_HALVES } from "@test/helpers/r10-high-hands";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { RegisterPlayerDialog } from "./register-player-dialog";

const SEATED: AutoSeatResultDto = { status: "seated", seat: { tableId: "tb1", tableNumber: 1, tableName: "Table 1", seatNumber: 4 } };
const SAM = { id: "p-sam", name: "Sam Taylor", imageUrl: null };

function mockDesk(): unknown[] {
  const registered: unknown[] = [];
  server.use(
    http.get("/api/public/tournaments/t1/players", () => HttpResponse.json([SAM])),
    http.post("/api/tournaments/t1/registrations", async ({ request }) => {
      registered.push(await request.json());
      return HttpResponse.json({ id: "r9", playerId: SAM.id, player: SAM, paymentConfirmed: false, seating: SEATED }, { status: 201 });
    }),
  );
  return registered;
}

async function registerSam(highHands: ReturnType<typeof highHandsOf>, tick: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) {
  const user = userEvent.setup();
  renderWithApp(<RegisterPlayerDialog open onOpenChange={() => {}} tournamentId="t1" buyInCents={5000 as Cents} rakeLabel="AP" highHands={highHands} />);
  await user.type(screen.getByTestId("player-search"), "Sam");
  await user.click(await screen.findByRole("button", { name: "Sam Taylor" }));
  await tick(user);
  await user.click(screen.getByTestId("register-player-final"));
  expect(await screen.findByText(/Sam Taylor is in/)).toBeInTheDocument();
}

beforeEach(() => {
  hostPhone();
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("Register player: the high hands (round 10)", () => {
  it("registers a player for the second half only", async () => {
    const registered = mockDesk();
    await registerSam(TWO_HALVES, async (user) => {
      expect(screen.getByRole("checkbox", { name: /First half high hand/ })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /All high hands/ })).toHaveAccessibleName(expect.stringContaining("$10.00"));
      await user.click(screen.getByRole("checkbox", { name: /Second half high hand/ }));
    });
    expect(registered).toEqual([{ playerId: "p-sam", buyIns: 1, rebuys: 0, addons: 0, enteringHighHands: true, highHandIds: ["hh2"] }]);
  });

  it("enters every high hand with All high hands, and none with it unticked", async () => {
    const registered = mockDesk();
    await registerSam(TWO_HALVES, async (user) => {
      await user.click(screen.getByRole("checkbox", { name: /All high hands/ }));
      expect(screen.getByRole("checkbox", { name: /First half high hand/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Second half high hand/ })).toBeChecked();
    });
    expect(registered).toEqual([expect.objectContaining({ enteringHighHands: true, highHandIds: ["hh1", "hh2"] })]);
  });

  it("has one switch for a game with one high hand, and sends it by the legacy id", async () => {
    const registered = mockDesk();
    const legacy = highHandsOf(tournamentDto({ enableHighHand: true, highHandAmount: "10.00" }));
    await registerSam(legacy, async (user) => {
      expect(screen.getByText("$10.00, paid at the door")).toBeInTheDocument();
      await user.click(screen.getByTestId("register-high-hand"));
    });
    expect(registered).toEqual([expect.objectContaining({ enteringHighHands: true, highHandIds: ["legacy"] })]);
  });

  it("says nothing of high hands in a game without one", async () => {
    const registered = mockDesk();
    await registerSam([], async () => {
      expect(screen.queryByTestId("high-hand-choices")).not.toBeInTheDocument();
      expect(screen.queryByTestId("register-high-hand")).not.toBeInTheDocument();
    });
    expect(registered).toEqual([{ playerId: "p-sam", buyIns: 1, rebuys: 0, addons: 0 }]);
  });
});
