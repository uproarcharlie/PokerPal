import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { clubDto, OWNER_VIEW } from "@test/helpers/dto";
import { screenWidth } from "@test/helpers/f1-tournaments";
import { recordRequests } from "@test/helpers/requests";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { ClubTableDefaultsFields, tableDefaultsChanges } from "./club-table-defaults-fields";

const club = clubDto({ viewer: OWNER_VIEW });

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Olive Owner", email: "olive@club.test", role: "full_member" });
});

/** PUT /api/clubs/c1 answers `answer(body)`, recording the bodies sent. */
const recordClubSaves = (answer: (body: Record<string, unknown>) => Response) =>
  recordRequests([["put", "/api/clubs/c1"]], (sent) => answer(sent.body as Record<string, unknown>), (sent) => sent.body);

describe("ClubTableDefaultsFields", () => {
  it("saves the club's table defaults, only what changed (Central Stars: rectangles), at 390 px", async () => {
    screenWidth(390);
    const bodies = recordClubSaves((body) => HttpResponse.json({ ...club, ...body }));
    const user = userEvent.setup();
    renderWithApp(<ClubTableDefaultsFields club={club} />);

    const card = screen.getByTestId("club-table-defaults");
    expect(within(card).getByLabelText("Seats per table")).toHaveValue("9");
    expect(card).toHaveTextContent("Not chosen yet: tables have 9 seats.");
    expect(within(card).getByRole("radio", { name: /Oval/ })).toBeChecked();
    await user.click(within(card).getByRole("radio", { name: /Rectangle/ }));
    await user.click(within(card).getByRole("button", { name: "Save table defaults" }));

    await waitFor(() => expect(bodies).toEqual([{ defaultTableShape: "rectangle" }]));
    expect(await screen.findByText("Table defaults saved")).toBeInTheDocument();
  });

  it("clears the club's choices back to the app's defaults", async () => {
    const chosen = clubDto({ viewer: OWNER_VIEW, defaultSeatsPerTable: 9, defaultTableShape: "rectangle" });
    const bodies = recordClubSaves((body) => HttpResponse.json({ ...chosen, ...body }));
    const user = userEvent.setup();
    renderWithApp(<ClubTableDefaultsFields club={chosen} />);

    expect(screen.getByRole("radio", { name: /Rectangle/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Use the app's defaults" }));

    await waitFor(() => expect(bodies).toEqual([{ defaultSeatsPerTable: null, defaultTableShape: null }]));
    expect(await screen.findByText("Table defaults cleared")).toBeInTheDocument();
  });

  it("says when nothing changed, and shows a refusal", async () => {
    const bodies = recordClubSaves(() => apiError(403, "FORBIDDEN", "Only the club's owner can change this"));
    const user = userEvent.setup();
    renderWithApp(<ClubTableDefaultsFields club={club} />);

    await user.click(screen.getByRole("button", { name: "Save table defaults" }));
    expect(await screen.findByText("Nothing to save")).toBeInTheDocument();
    expect(bodies).toEqual([]);

    await user.click(screen.getByRole("button", { name: "6 seats" }));
    await user.click(screen.getByRole("button", { name: "Save table defaults" }));
    expect(await screen.findByText("Could not save the table defaults")).toBeInTheDocument();
    expect(bodies).toEqual([{ defaultSeatsPerTable: 6 }]);
  });
});

describe("tableDefaultsChanges", () => {
  it("sends a value only when it moves off what is in force", () => {
    const none = { defaultSeatsPerTable: null, defaultTableShape: null };
    expect(tableDefaultsChanges(none, { defaultSeatsPerTable: 9, defaultTableShape: "oval" })).toEqual({});
    expect(tableDefaultsChanges(none, { defaultSeatsPerTable: 10, defaultTableShape: "round" })).toEqual({ defaultSeatsPerTable: 10, defaultTableShape: "round" });
    expect(tableDefaultsChanges({ defaultSeatsPerTable: 9, defaultTableShape: "rectangle" }, { defaultSeatsPerTable: 9, defaultTableShape: "rectangle" })).toEqual({});
  });
});
