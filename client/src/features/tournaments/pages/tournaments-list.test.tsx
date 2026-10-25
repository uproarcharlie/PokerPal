import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, listItemDto, phoneLayout } from "@test/helpers/f1-tournaments";
import TournamentsListPage from "./tournaments-list";

const ours = listItemDto({ id: "t1", name: "Friday Freezeout", status: "registration", buyInAmount: "50.00", maxPlayers: 30, confirmedPlayerCount: 3, registeredCount: 5 });
const theirs = listItemDto({ id: "t2", name: "Visitors Cup", clubId: "c2", status: "cancelled", confirmedPlayerCount: null, registeredCount: 7 });
const visitors = clubDto({ id: "c2", name: "Visitors Club", viewer: { canManage: false, canOwn: false } });

function mockList(answer: (url: URL) => Response = () => HttpResponse.json([ours, theirs])) {
  const asked: string[] = [];
  server.use(
    http.get("/api/tournaments", ({ request }) => {
      const url = new URL(request.url);
      asked.push(url.search);
      return answer(url);
    }),
    http.get("/api/clubs", () => HttpResponse.json([clubDto(), visitors])),
  );
  return asked;
}

function renderList() {
  return renderWithApp(<TournamentsListPage />, { path: "/tournaments" });
}

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});

describe("TournamentsListPage", () => {
  it("lists each tournament with its club, status, buy-in, players and start in the club's time zone", async () => {
    mockList();
    renderList();

    const row = await screen.findByTestId("tournament-row-t1");
    expect(row).toHaveTextContent("Friday Freezeout");
    expect(row).toHaveTextContent("Central Stars");
    expect(row).toHaveTextContent("Registration Open");
    expect(row).toHaveTextContent("$50.00");
    expect(row).toHaveTextContent("3/30");
    expect(row).toHaveTextContent("Fri, 23 Oct 2026, 8:00 pm");
    // Another club's game counts everyone registered: who has paid is that club's bookkeeping.
    expect(screen.getByTestId("tournament-row-t2")).toHaveTextContent("7/20");
    expect(screen.getByTestId("tournament-row-t2")).toHaveTextContent("Cancelled");
    // Named with its tournament, so a screen reader's list of links tells the rows apart (MA-P3REV1-07).
    expect(within(row).getByRole("link", { name: "Manage Friday Freezeout" })).toHaveAttribute("href", "/admin/tournaments/t1");
    expect(within(row).getByRole("link", { name: "Manage Friday Freezeout" })).toHaveClass("h-10");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("counts the field against Max players and the waiting list behind it apart (round 5, item 15)", async () => {
    // The club's staff see who has paid; anyone else the field: never "19/18".
    const full = listItemDto({ id: "t1", name: "Friday Freezeout", maxPlayers: 18, confirmedPlayerCount: 18, registeredCount: 20, waitingListCount: 2 });
    const elsewhere = listItemDto({ id: "t2", name: "Visitors Cup", clubId: "c2", maxPlayers: 18, confirmedPlayerCount: null, registeredCount: 19, waitingListCount: 1 });
    mockList(() => HttpResponse.json([full, elsewhere]));
    renderList();

    expect(await screen.findByTestId("tournament-row-t1")).toHaveTextContent("18/18 · 2 waiting");
    expect(screen.getByTestId("tournament-row-t2")).toHaveTextContent("18/18 · 1 waiting");
    expect(screen.getByTestId("tournament-row-t2")).not.toHaveTextContent("19/18");
  });

  it("shows each row once on a phone, as a card", async () => {
    phoneLayout();
    mockList();
    renderList();

    expect(await screen.findAllByTestId("tournament-row-t1")).toHaveLength(1);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Manage / })).toHaveLength(2);
  });

  it("offers Edit only for a club the viewer runs, and opens the tournament's settings (CA-14)", async () => {
    mockList();
    server.use(
      http.get("/api/seasons", () => HttpResponse.json([])),
      // The panel reads the re-buys and add-ons already recorded, which keep those parts on.
      http.get("/api/tournaments/t1/registrations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "More for Visitors Cup" }));
    expect(screen.queryByTestId("edit-tournament-t2")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "More for Friday Freezeout" }));
    await user.click(await screen.findByTestId("edit-tournament-t1"));

    expect(await screen.findByRole("dialog", { name: "Edit Tournament" })).toBeInTheDocument();
    expect(screen.getByTestId("tournament-name")).toHaveValue("Friday Freezeout");

    // Closing it gives focus back to the row's menu, not to the top of the page (MA-P3REV1-02).
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "More for Friday Freezeout" })).toHaveFocus());
  });

  it("filters by club and status on the server", async () => {
    const asked = mockList((url) => HttpResponse.json(url.searchParams.get("status") === "completed" ? [] : [ours, theirs]));
    const user = userEvent.setup();
    renderList();
    await screen.findByTestId("tournament-row-t1");

    await user.click(screen.getByTestId("club-filter"));
    await user.click(await screen.findByRole("option", { name: "Central Stars" }));
    await user.click(screen.getByTestId("status-filter"));
    await user.click(await screen.findByRole("option", { name: "Completed" }));

    expect(await screen.findByText("No tournaments match these filters")).toBeInTheDocument();
    expect(asked.at(-1)).toBe("?clubId=c1&status=completed");
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(await screen.findByTestId("tournament-row-t1")).toBeInTheDocument();
  });

  it("invites the first tournament when there are none", async () => {
    mockList(() => HttpResponse.json([]));
    server.use(http.get("/api/seasons", () => HttpResponse.json([])));
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByTestId("create-first-tournament"));

    expect(await screen.findByRole("dialog", { name: "Create New Tournament" })).toBeInTheDocument();
  });

  it("opens Create Tournament with the club chosen from a club page's link, then drops the link's query (CA-31)", async () => {
    mockList();
    server.use(http.get("/api/seasons", () => HttpResponse.json([])));
    const user = userEvent.setup();
    const { location } = renderWithApp(<TournamentsListPage />, { path: "/tournaments?create=c1" });

    const dialog = await screen.findByRole("dialog", { name: "Create New Tournament" });
    await waitFor(() => expect(within(dialog).getByTestId("club-select")).toHaveTextContent("Central Stars"));

    await user.click(within(dialog).getByTestId("cancel-tournament"));
    await waitFor(() => expect(location()).toBe("/tournaments"));
  });

  it("ignores a club in the link that the viewer does not run", async () => {
    mockList();
    // Two clubs of their own to choose from: their only club would be chosen for them (P3REV6-CQ-03).
    server.use(http.get("/api/clubs", () => HttpResponse.json([clubDto(), clubDto({ id: "c3", name: "Second Club" }), visitors])));
    renderWithApp(<TournamentsListPage />, { path: "/tournaments?create=c2" });

    const dialog = await screen.findByRole("dialog", { name: "Create New Tournament" });
    await screen.findByTestId("tournament-row-t1");
    expect(within(dialog).getByTestId("club-select")).toHaveTextContent("Select a club");
  });

  it("draws the rows once the clubs are in: never an Unknown Club, the wrong zone or a missing Edit while they load (P3REV6-CQ-01)", async () => {
    mockList();
    let release: () => void = () => {};
    server.use(
      http.get("/api/clubs", async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return HttpResponse.json([clubDto(), visitors]);
      }),
    );
    renderList();

    await waitFor(() => expect(screen.getByTestId("club-filter")).toBeDisabled());
    expect(screen.queryByTestId("tournament-row-t1")).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown Club")).not.toBeInTheDocument();

    release();
    expect(await screen.findByTestId("tournament-row-t1")).toHaveTextContent("Central Stars");
    expect(screen.getByTestId("club-filter")).toBeEnabled();
  });

  it("says the clubs could not be loaded, rather than showing every row's club as unknown, and tries again (P3REV6-CQ-01)", async () => {
    mockList();
    let fail = true;
    server.use(
      http.get("/api/clubs", () => (fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json([clubDto(), visitors]))),
    );
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent("Your clubs could not be loaded");
    expect(screen.queryByText("Unknown Club")).not.toBeInTheDocument();
    expect(screen.getByTestId("club-filter")).toBeDisabled();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("tournament-row-t1")).toHaveTextContent("Central Stars");
  });

  it("says the list could not be loaded instead of showing it empty, and tries again", async () => {
    let fail = true;
    mockList(() => (fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json([ours])));
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent("The tournaments could not be loaded");
    expect(screen.queryByText("No Tournaments Found")).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("tournament-row-t1")).toBeInTheDocument();
  });

  describe("copying a link", () => {
    afterEach(() => {
      Reflect.deleteProperty(navigator, "clipboard");
    });

    it("says it was copied only when it was", async () => {
      mockList();
      const user = userEvent.setup();
      // The second copy is refused; jsdom has no execCommand to fall back on, like a browser that refuses.
      const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      renderList();

      await user.click(await screen.findByRole("button", { name: "More for Friday Freezeout" }));
      await user.click(await screen.findByTestId("copy-registration-link-t1"));
      expect(await screen.findByText("Registration link copied to the clipboard")).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/register/t1`);

      await user.click(screen.getByRole("button", { name: "More for Friday Freezeout" }));
      await user.click(await screen.findByTestId("copy-qr-link-t1"));
      // The same words as every other copy of a link (P3REV3-CQ-08).
      expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument();
      expect(screen.getByText(`Select it and copy it yourself: ${window.location.origin}/qr/t1`)).toBeInTheDocument();
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/qr/t1`));
    });
  });
});
