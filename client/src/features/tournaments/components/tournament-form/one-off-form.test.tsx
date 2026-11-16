/**
 * One-off games and free tournaments in the tournament form (round 7, items 7 and 8), on a phone
 * (390 px): "No season (one-off game)" in the season menu, which takes the points system and the
 * points switch with it; the points switch only with a points system; and the hint under a $0 buy-in.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { pointsSystemDto, seasonDto } from "@test/helpers/dto";
import { clubDto, noBankDetails, recordBodies, screenWidth, tournamentDto } from "@test/helpers/f1-tournaments";
import type { TournamentDetailDto } from "@shared/api/tournaments";
import { CreateTournamentDialog } from "../create-tournament-dialog";
import { EditTournamentDialog } from "../edit-tournament-dialog";

const spring = seasonDto({ id: "s1", name: "Spring League", clubId: "c1" });
const league = pointsSystemDto({ id: "ps1", seasonId: "s1", name: "League Points" });

/** The club's one season and its points system; every create and save recorded. */
function mockForm() {
  const sent = recordBodies();
  server.use(
    http.get("/api/clubs", () => HttpResponse.json([clubDto()])),
    noBankDetails(),
    http.get("/api/seasons", () => HttpResponse.json([spring])),
    http.get("/api/seasons/s1/points-systems", () => HttpResponse.json([league])),
    http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([])),
    http.post("/api/tournaments", async ({ request }) => {
      await sent.record(request);
      return HttpResponse.json(tournamentDto(), { status: 201 });
    }),
    http.put("/api/tournaments/t1", async ({ request }) => {
      await sent.record(request);
      return HttpResponse.json(tournamentDto());
    }),
  );
  return sent.bodies;
}

type User = ReturnType<typeof userEvent.setup>;

async function choose(user: User, trigger: HTMLElement, option: string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

/** The create dialog, open in the viewer's only club, with the other required fields filled in. */
async function openCreate() {
  const user = userEvent.setup();
  renderWithApp(<CreateTournamentDialog open onOpenChange={() => {}} />);
  // The dialog waits for the viewer's clubs (and its lazy parts) before it opens.
  await screen.findByRole("dialog", { name: "Create New Tournament" }, { timeout: 5000 });
  await user.type(screen.getByTestId("tournament-name"), "Charity Night");
  fireEvent.change(screen.getByTestId("start-datetime"), { target: { value: "2026-11-20T19:30" } });
  await user.type(screen.getByTestId("max-players"), "30");
  return user;
}

function openEdit(tournament: TournamentDetailDto) {
  const user = userEvent.setup();
  renderWithApp(<EditTournamentDialog tournament={tournament} club={clubDto()} open onOpenChange={() => {}} />);
  return user;
}

/** The edit panel once the club's seasons are in, showing the tournament's season. */
const seasonShown = (name: string) => waitFor(() => expect(screen.getByTestId("season-select")).toHaveTextContent(name), { timeout: 5000 });

const pointsSwitch = () => screen.getByRole("checkbox", { name: "Track Player Points" });

beforeEach(() => {
  screenWidth(390);
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("a one-off game in the tournament form", () => {
  it("is what a new tournament is until a season is chosen: no points system and no points", async () => {
    const sent = mockForm();
    const user = await openCreate();
    await user.type(screen.getByTestId("buyin-amount"), "40");

    expect(screen.getByTestId("season-select")).toHaveTextContent("No season (one-off game)");
    expect(screen.getByTestId("points-system-select")).toHaveTextContent("No points — one-off game");
    expect(screen.getByTestId("points-system-select")).toBeDisabled();
    expect(pointsSwitch()).not.toBeChecked();
    expect(pointsSwitch()).toBeDisabled();
    expect(pointsSwitch()).toHaveAccessibleDescription("No points — one-off game");
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ name: "Charity Night", seasonId: null, pointsSystemId: null, trackPoints: false });
  });

  it("scores points once a season and its points system are chosen, and stops again for a one-off", async () => {
    const sent = mockForm();
    const user = await openCreate();
    await user.type(screen.getByTestId("buyin-amount"), "40");

    await choose(user, screen.getByTestId("season-select"), "Spring League");
    expect(pointsSwitch()).toBeDisabled();
    expect(pointsSwitch()).toHaveAccessibleDescription("Choose a points system to track points");
    await choose(user, screen.getByTestId("points-system-select"), "League Points");
    expect(pointsSwitch()).toBeEnabled();
    expect(pointsSwitch()).toBeChecked();

    await choose(user, screen.getByTestId("season-select"), "No season (one-off game)");
    expect(screen.getByTestId("points-system-select")).toHaveTextContent("No points — one-off game");
    expect(pointsSwitch()).not.toBeChecked();
    await choose(user, screen.getByTestId("season-select"), "Spring League");
    await choose(user, screen.getByTestId("points-system-select"), "League Points");
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ seasonId: "s1", pointsSystemId: "ps1", trackPoints: true });
  });

  it("takes a game off its season on edit, sending the points system and points off with it", async () => {
    const sent = mockForm();
    const user = openEdit(tournamentDto({ status: "registration", seasonId: "s1", pointsSystemId: "ps1", trackPoints: true }));
    await seasonShown("Spring League");
    expect(pointsSwitch()).toBeChecked();

    await choose(user, screen.getByTestId("season-select"), "No season (one-off game)");
    await user.click(screen.getByTestId("save-tournament"));

    await waitFor(() => expect(sent).toEqual([{ seasonId: null, pointsSystemId: null, trackPoints: false }]));
  });

  it("keeps a finished game's season as it was scored", async () => {
    mockForm();
    openEdit(tournamentDto({ status: "completed", seasonId: "s1", pointsSystemId: "ps1", trackPoints: true }));

    await seasonShown("Spring League");
    expect(screen.getByTestId("season-select")).toBeDisabled();
    expect(screen.getByTestId("points-system-select")).toBeDisabled();
    expect(screen.getByTestId("money-locked-note")).toHaveTextContent("season and points settings stay as they were paid and scored");
  });
});

describe("a free tournament ($0 buy-in)", () => {
  it("says the club sets the prize pool, and sends the $0 buy-in", async () => {
    const sent = mockForm();
    const user = await openCreate();

    await user.type(screen.getByTestId("buyin-amount"), "40");
    expect(screen.queryByTestId("free-tournament-hint")).not.toBeInTheDocument();
    await user.clear(screen.getByTestId("buyin-amount"));
    await user.type(screen.getByTestId("buyin-amount"), "0");
    expect(screen.getByTestId("free-tournament-hint")).toHaveTextContent("Free tournament — set the prize pool the club puts up");
    expect(screen.getByTestId("buyin-amount")).toHaveAccessibleDescription(expect.stringContaining("Free tournament"));
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ buyInAmount: "0.00" });
  });

  it("starts with the hint when editing a free tournament", () => {
    mockForm();
    openEdit(tournamentDto({ status: "registration", buyInAmount: "0.00", rakeType: "none", rakeAmount: "0.00" }));

    expect(screen.getByTestId("free-tournament-hint")).toBeInTheDocument();
  });
});
