import { useState } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { installFakeXhr } from "@test/helpers/fake-xhr";
import { seasonDto } from "@test/helpers/dto";
import { clubDto, recordBodies, tournamentDto } from "@test/helpers/f1-tournaments";
import { CreateTournamentDialog } from "./create-tournament-dialog";

const otherClub = clubDto({ id: "c2", name: "Visitors Club", rakeLabel: null, viewer: { canManage: false, canOwn: false } });

function mockForm({ seasonsOf = {} as Record<string, Array<{ id: string; name: string }>> } = {}) {
  const created = recordBodies();
  server.use(
    http.get("/api/clubs", () => HttpResponse.json([clubDto(), otherClub, clubDto({ id: "c3", name: "Second Club", rakeLabel: null })])),
    http.get("/api/seasons", ({ request }) => {
      const clubId = new URL(request.url).searchParams.get("clubId") ?? "";
      return HttpResponse.json((seasonsOf[clubId] ?? []).map((season) => ({ ...season, clubId, startDate: "2026-01-01T00:00:00.000Z", endDate: null, isActive: true, createdAt: null })));
    }),
    http.get("/api/seasons/:id/points-systems", () => HttpResponse.json([])),
    http.post("/api/tournaments", async ({ request }) => {
      await created.record(request);
      return HttpResponse.json(tournamentDto(), { status: 201 });
    }),
  );
  return created.bodies;
}

/** The dialog, open once the viewer's clubs are in. */
async function renderDialog() {
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  renderWithApp(<CreateTournamentDialog open onOpenChange={onOpenChange} />);
  await screen.findByRole("dialog", { name: "Create New Tournament" });
  return { onOpenChange, user, dialog: () => screen.getByRole("dialog", { name: "Create New Tournament" }) };
}

async function choose(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("tournament-name"), "Thursday Deepstack");
  await choose(user, screen.getByTestId("club-select"), "Central Stars");
  fireEvent.change(screen.getByTestId("start-datetime"), { target: { value: "2026-10-24T19:30" } });
  await user.type(screen.getByTestId("buyin-amount"), "50");
  await user.clear(screen.getByTestId("min-players"));
  await user.type(screen.getByTestId("min-players"), "4");
  await user.type(screen.getByTestId("max-players"), "30");
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("CreateTournamentDialog", () => {
  it("creates an open tournament in a club the viewer runs, with the settings as the API stores them", async () => {
    const created = mockForm();
    const { user, onOpenChange } = await renderDialog();

    await fillRequired(user);
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      name: "Thursday Deepstack",
      clubId: "c1",
      status: "registration",
      buyInAmount: "50.00",
      minPlayers: 4,
      maxPlayers: 30,
      rakeType: "none",
      rakeAmount: null,
      rebuyAmount: null,
      payoutStructure: "standard",
      trackPoints: true,
      // Read in the club's zone (Pacific/Auckland, NZDT), not the test machine's (P3REV-PARITY-TZ-01).
      startDateTime: "2026-10-24T06:30:00.000Z",
    });
    expect(await screen.findByText("Tournament created successfully!")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("fills in Central Stars' One Life Line format in one tap: $100 in, one $25 re-buy and a $25 add-on", async () => {
    const created = mockForm();
    const { user } = await renderDialog();

    await user.type(screen.getByTestId("tournament-name"), "One Life Line #21");
    await choose(user, screen.getByTestId("club-select"), "Central Stars");
    fireEvent.change(screen.getByTestId("start-datetime"), { target: { value: "2026-10-30T19:00" } });
    await user.type(screen.getByTestId("max-players"), "40");
    const formats = screen.getByTestId("format-presets");
    expect(formats).toHaveTextContent("One life line: one $25 re-buy or one $25 add-on (120,000), not both · Early-bird bonus 25,000 · Cash entry");
    await user.click(within(formats).getByRole("button", { name: "Use the Central Stars · One Life Line format" }));

    expect(await screen.findByText("Central Stars · One Life Line format filled in")).toBeInTheDocument();
    expect(screen.getByTestId("buyin-amount")).toHaveValue("100.00");
    expect(screen.getByTestId("rebuy-amount")).toHaveValue("25.00");
    expect(screen.getByTestId("max-rebuys")).toHaveValue("1");
    expect(screen.getByTestId("rebuy-period")).toHaveValue("135");
    expect(screen.getByTestId("addon-amount")).toHaveValue("25.00");
    // Its house rules come with it, so the server enforces them (TDN4-HOUSE-RULES-UNSET).
    expect(screen.getByTestId("max-addons")).toHaveValue("1");
    expect(screen.getByRole("checkbox", { name: /Re-buys OR add-ons, not both/ })).toBeChecked();
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      buyInAmount: "100.00",
      rebuyAmount: "25.00",
      maxRebuys: 1,
      rebuyPeriodMinutes: 135,
      addonAmount: "25.00",
      maxAddons: 1,
      rebuyOrAddon: true,
    });
  });

  it("saves a draft as scheduled", async () => {
    const created = mockForm();
    const { user } = await renderDialog();

    await fillRequired(user);
    await user.click(screen.getByTestId("save-draft-tournament"));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ status: "scheduled" });
    expect(await screen.findByText("Tournament saved as draft successfully!")).toBeInTheDocument();
  });

  it("offers only the clubs the viewer runs", async () => {
    mockForm();
    const { user } = await renderDialog();

    await user.click(screen.getByTestId("club-select"));

    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Central Stars", "Second Club"]);
  });

  it("names the missing fields and sends nothing", async () => {
    const created = mockForm();
    const { user } = await renderDialog();

    await user.click(screen.getByTestId("create-tournament-final"));

    expect(await screen.findByText("Choose a club")).toBeInTheDocument();
    expect(screen.getByText("Choose the start date and time")).toBeInTheDocument();
    expect(screen.getAllByText("Required").length).toBeGreaterThanOrEqual(2);
    expect(created).toEqual([]);
  });

  it("labels the rates with the club's name for rake, and checks a percentage before sending", async () => {
    const created = mockForm();
    const { user } = await renderDialog();
    await fillRequired(user);

    await user.selectOptions(screen.getByTestId("rake-type"), "Percentage (%)");
    expect(screen.getByText("AP Type")).toBeInTheDocument();
    await user.type(screen.getByTestId("rake-amount"), "120");
    await user.click(screen.getByTestId("create-tournament-final"));

    expect(await screen.findByText("A percentage cannot be over 100")).toBeInTheDocument();
    expect(screen.getByLabelText("AP Percentage")).toHaveAttribute("aria-invalid", "true");
    expect(created).toEqual([]);
  });

  it("forgets a season of the club chosen first when the club changes (CA-15)", async () => {
    const created = mockForm({ seasonsOf: { c1: [{ id: "s1", name: "Spring" }], c3: [{ id: "s3", name: "Autumn" }] } });
    const { user } = await renderDialog();
    await fillRequired(user);
    await choose(user, screen.getByTestId("season-select"), "Spring");

    await choose(user, screen.getByTestId("club-select"), "Second Club");
    expect(screen.getByTestId("season-select")).toHaveTextContent("Select a season");
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ clubId: "c3", seasonId: null });
  });

  it("does not send a re-buy price typed before re-buys were switched off again (CA-15)", async () => {
    const created = mockForm();
    const { user } = await renderDialog();
    await fillRequired(user);

    await user.click(screen.getByTestId("enable-rebuys"));
    await user.type(screen.getByTestId("rebuy-amount"), "25");
    await user.click(screen.getByTestId("enable-rebuys"));
    await user.click(screen.getByTestId("create-tournament-final"));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ rebuyAmount: null, rebuyRakeType: "none", maxRebuys: null });
  });

  it("puts a season the server refuses on the season field", async () => {
    mockForm({ seasonsOf: { c1: [{ id: "s1", name: "Spring" }] } });
    server.use(http.post("/api/tournaments", () => apiError(400, "SEASON_NOT_IN_CLUB", "That season belongs to another club")));
    const { user, onOpenChange } = await renderDialog();
    await fillRequired(user);
    await choose(user, screen.getByTestId("season-select"), "Spring");

    await user.click(screen.getByTestId("create-tournament-final"));

    expect(await screen.findByText("That season belongs to another club")).toBeInTheDocument();
    expect(screen.getByTestId("season-select")).toHaveAttribute("aria-invalid", "true");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows any other refusal in a toast, and keeps what was typed", async () => {
    mockForm();
    server.use(
      http.post("/api/tournaments", () =>
        apiError(409, "TOURNAMENT_LIMIT_REACHED", "A club can have at most 100 upcoming tournaments: finish, cancel or delete some first"),
      ),
    );
    const { user } = await renderDialog();
    await fillRequired(user);

    await user.click(screen.getByTestId("create-tournament-final"));

    expect(await screen.findByText(/at most 100 upcoming tournaments/)).toBeInTheDocument();
    expect(screen.getByTestId("tournament-name")).toHaveValue("Thursday Deepstack");
  });

  it("says the club's seasons are loading, or could not be loaded, never that it has none (P3REV3-CQ-02)", async () => {
    mockForm();
    let answer: () => void = () => {};
    let asked = 0;
    server.use(
      http.get("/api/seasons", async () => {
        asked += 1;
        if (asked === 1) {
          await new Promise<void>((resolve) => (answer = resolve));
          return apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now");
        }
        return HttpResponse.json([seasonDto({ id: "s1", name: "Spring", clubId: "c1" })]);
      }),
    );
    const { user } = await renderDialog();

    await choose(user, screen.getByTestId("club-select"), "Central Stars");
    await user.click(screen.getByTestId("season-select"));
    expect(await screen.findByRole("option", { name: "Loading seasons…" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "No seasons available for this club" })).toBeNull();
    await user.keyboard("{Escape}");

    answer();
    expect(await screen.findByText(/The club's seasons could not be loaded/)).toBeInTheDocument();
    await user.click(screen.getByTestId("season-select"));
    expect(await screen.findByRole("option", { name: "Seasons could not be loaded" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await choose(user, screen.getByTestId("season-select"), "Spring");
    expect(screen.getByTestId("season-select")).toHaveTextContent("Spring");
  });

  describe("which club it starts in (P3REV6-CQ-03)", () => {
    it("opens once the viewer's clubs are in, already in their only club, with its seasons", async () => {
      mockForm({ seasonsOf: { c1: [{ id: "s1", name: "Spring" }] } });
      let release: () => void = () => {};
      server.use(
        http.get("/api/clubs", async () => {
          await new Promise<void>((resolve) => (release = resolve));
          return HttpResponse.json([clubDto(), otherClub]);
        }),
      );
      renderWithApp(<CreateTournamentDialog open onOpenChange={() => {}} />);

      // Nothing to show until the clubs are known: no menu that reads "Loading clubs…" or "none".
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      release();
      const dialog = await screen.findByRole("dialog", { name: "Create New Tournament" });
      expect(within(dialog).getByTestId("club-select")).toHaveTextContent("Central Stars");
      const user = userEvent.setup();
      await choose(user, within(dialog).getByTestId("season-select"), "Spring");
    });

    it("starts afresh each time it opens, as Create Season does", async () => {
      mockForm();
      function Page() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              New tournament
            </button>
            <CreateTournamentDialog open={open} onOpenChange={setOpen} />
          </>
        );
      }
      const user = userEvent.setup();
      renderWithApp(<Page />);

      await user.click(screen.getByRole("button", { name: "New tournament" }));
      await user.type(await screen.findByTestId("tournament-name"), "Half typed");
      await user.click(screen.getByTestId("cancel-tournament"));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "New tournament" }));

      expect(await screen.findByTestId("tournament-name")).toHaveValue("");
    });
  });

  describe("with a tournament image", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("keeps Create and Save as Draft disabled until the image is stored (img-15)", async () => {
      const sent = installFakeXhr();
      mockForm();
      const { user, dialog } = await renderDialog();
      await fillRequired(user);

      const input = dialog().querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File([new Uint8Array(64)], "banner.png", { type: "image/png" })] } });
      await user.click(await screen.findByRole("button", { name: "Use this" }));
      await waitFor(() => expect(sent).toHaveLength(1));

      expect(within(dialog()).getByTestId("create-tournament-final")).toBeDisabled();
      expect(within(dialog()).getByTestId("save-draft-tournament")).toBeDisabled();
      act(() =>
        sent[0].respond(201, { kind: "tournament_banner", url: "/uploads/tournament_banner/abc/800.webp", variants: {}, width: 800, height: 450, dominantColor: null }),
      );
      await waitFor(() => expect(within(dialog()).getByTestId("create-tournament-final")).toBeEnabled());
    });
  });
});
