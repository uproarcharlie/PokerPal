import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MANAGER_VIEW, tournamentDto } from "@test/helpers/dto";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { recordRequests } from "@test/helpers/requests";
import { mockSeating, seatingDto } from "@test/helpers/seating-dto";
import { settingsChanges, settingsSummary } from "./seating-settings-sheet";
import { SeatingPanel } from "./seating-panel";

const tournament = tournamentDto({ status: "in_progress", viewer: MANAGER_VIEW, maxPlayers: 40 });
const seating = seatingDto({ tables: [{ id: "tA", number: 1, seats: 9, seated: { 1: { id: "r1", name: "Alice" } } }] });

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
  mockSeating(seating);
});
afterEach(() => window.localStorage.clear());

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  return screen.findByRole("dialog", { name: "Seating settings" });
}

describe("Seating settings", () => {
  it("starts from the settings in force, and saves only what the TD changed (at 390 px)", async () => {
    screenWidth(390);
    const sent = recordPut();
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const sheet = await openSettings(user);
    expect(within(sheet).getByLabelText("Seats per table")).toHaveValue("9");
    expect(within(sheet).getByLabelText("Start with")).toHaveValue("2");
    expect(within(sheet).getByRole("button", { name: "When full (9)" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByRole("radio", { name: /When they register/ })).toBeChecked();
    expect(within(sheet).getByRole("radio", { name: /Oval/ })).toBeChecked();
    expect(within(sheet).getByTestId("settings-summary")).toHaveTextContent("Up to 5 tables of 9 for 40 players. Start with 2 tables; open Table 3 when both are full.");

    // Six-handed: the threshold that was "when full" stays when full.
    await user.click(within(sheet).getByRole("button", { name: "6 seats" }));
    expect(within(sheet).getByRole("button", { name: "When full (6)" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(sheet).getByRole("radio", { name: /Once they've paid/ }));
    await user.click(within(sheet).getByRole("radio", { name: /Rectangle/ }));
    expect(within(sheet).getByTestId("settings-summary")).toHaveTextContent("Up to 7 tables of 6 for 40 players.");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toEqual([{ seatsPerTable: 6, autoSeat: "once_paid", tableShape: "rectangle" }]));
    expect(await screen.findByText("Seating settings saved")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Seating settings" })).not.toBeInTheDocument();
  });

  it("opens the next table earlier when asked, and refuses a threshold above the seats before sending", async () => {
    const sent = recordPut();
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const sheet = await openSettings(user);
    await user.click(within(sheet).getByRole("button", { name: "Fewer players" }));
    expect(within(sheet).getByLabelText("Open the next table when every table has")).toHaveValue("8");
    await user.clear(within(sheet).getByLabelText("Open the next table when every table has"));
    await user.type(within(sheet).getByLabelText("Open the next table when every table has"), "10");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    expect(await within(sheet).findByText("Open the next table at 9 players or fewer (the seats per table)")).toBeInTheDocument();
    expect(sent).toEqual([]);

    await user.clear(within(sheet).getByLabelText("Open the next table when every table has"));
    await user.type(within(sheet).getByLabelText("Open the next table when every table has"), "8");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([{ openTableAt: 8 }]));
  });

  it("puts the server's refusal on its field", async () => {
    recordPut(() => apiError(400, "VALIDATION", "Open the next table at 6 players or fewer (the seats per table)", [{ path: ["openTableAt"], message: "Open the next table at 6 players or fewer (the seats per table)" }]));
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const sheet = await openSettings(user);
    await user.click(within(sheet).getByRole("button", { name: "Fewer players" }));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    expect(await within(sheet).findByText("Open the next table at 6 players or fewer (the seats per table)")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Open the next table when every table has")).toHaveAttribute("aria-invalid", "true");
  });

  it("closes without asking the server when nothing changed", async () => {
    const sent = recordPut();
    const user = userEvent.setup();
    renderWithApp(<SeatingPanel tournament={tournament} registrations={[]} />);

    const sheet = await openSettings(user);
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Seating settings" })).not.toBeInTheDocument());
    expect(sent).toEqual([]);
  });
});

describe("settingsChanges", () => {
  const settings = seating.settings;
  const stored = { seatsPerTable: null, startingTables: null, openTableAt: null, autoSeat: null, tableShape: null };
  const values = { seatsPerTable: 9, startingTables: 2, openTableAt: 9, autoSeat: "on_register", tableShape: "oval" } as const;

  it("sends nothing for settings left as they are, so they keep following the club", () => {
    expect(settingsChanges(settings, stored, values)).toEqual({});
  });

  it("stores “when full” as no threshold, and a threshold below the seats as itself", () => {
    expect(settingsChanges(settings, { ...stored, openTableAt: 7 }, values)).toEqual({ openTableAt: null });
    expect(settingsChanges(settings, stored, { ...values, openTableAt: 7 })).toEqual({ openTableAt: 7 });
    expect(settingsChanges(settings, stored, { ...values, seatsPerTable: 6, openTableAt: 6 })).toEqual({ seatsPerTable: 6 });
  });
});

describe("settingsSummary", () => {
  it("says what the settings do in one sentence", () => {
    expect(settingsSummary({ seatsPerTable: "9", startingTables: "1", openTableAt: "8", autoSeat: "on_register", tableShape: "oval" }, 18)).toBe(
      "Up to 2 tables of 9 for 18 players. Start with 1 table; open Table 2 when it has 8 players.",
    );
    expect(settingsSummary({ seatsPerTable: "", startingTables: "2", openTableAt: "9", autoSeat: "on_register", tableShape: "oval" }, 18)).toBeNull();
  });
});

/** PUT /api/tournaments/t1 answers the tournament (or `respond()`), recording the bodies sent. */
function recordPut(respond: () => Response = () => HttpResponse.json(tournament)): unknown[] {
  return recordRequests([["put", "/api/tournaments/t1"]], () => respond(), (sent) => sent.body ?? null);
}
