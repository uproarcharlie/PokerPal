import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { installFakeXhr } from "@test/helpers/fake-xhr";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { clubDto, LOGO_URL, MANAGER_VIEW, seasonDto } from "@test/helpers/f3-clubs";
import type { ClubDto } from "@shared/api/public";
import ClubsPage from "./clubs";

const mine = clubDto({ viewer: MANAGER_VIEW });
const other = clubDto({ id: "c2", name: "Other Club", slug: "other-club" });

let clubs: ClubDto[];
let clubListRequests = 0;

beforeEach(() => {
  mockSignedIn({ id: "u1", name: "Olive Owner", email: "olive@club.test", role: "full_member" });
  clubs = [mine, other];
  clubListRequests = 0;
  server.use(
    http.get("/api/clubs", () => {
      clubListRequests += 1;
      return HttpResponse.json(clubs);
    }),
    http.get("/api/clubs/member-counts", () => HttpResponse.json({ c1: 12 })),
    // Counted by the server: the page never downloads every tournament to count them (P3REV3-CQ-12).
    http.get("/api/tournaments/counts", () => HttpResponse.json({ clubs: { c1: { total: 2, active: 1 }, c2: { total: 1, active: 1 } }, seasons: {} })),
    http.get("/api/seasons", () => HttpResponse.json([seasonDto({ name: "Summer 2026" }), seasonDto({ id: "s2", clubId: "c2", isActive: false })])),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  return renderWithApp(<ClubsPage />, { path: "/clubs" });
}

const card = async (id: string) => screen.findByTestId(`club-card-${id}`);
const figure = (inCard: HTMLElement, label: string) => within(inCard).getByText(label).nextElementSibling as HTMLElement;

describe("ClubsPage", () => {
  it("lists the clubs with their figures, and links to each", async () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Club Management" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    const central = await card("c1");
    await waitFor(() => expect(figure(central, "Members")).toHaveTextContent("12"));
    expect(figure(central, "Active Tournaments")).toHaveTextContent("1");
    expect(figure(central, "Total Tournaments")).toHaveTextContent("2");
    expect(figure(central, "Active Season")).toHaveTextContent("Summer 2026");
    expect(within(central).getByText("Est. 15 Jan 2026")).toBeInTheDocument();
    expect(within(central).getByRole("link", { name: "View" })).toHaveAttribute("href", "/clubs/c1");
    expect(within(central).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/clubs/c1/settings");

    const others = await card("c2");
    expect(figure(others, "Members")).toHaveTextContent("0");
    expect(figure(others, "Active Season")).toHaveTextContent("None");
    // Only the people who run a club see its Settings.
    expect(within(others).queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("shows its club logos whole, and initials for a club without one", async () => {
    clubs = [clubDto({ imageUrl: LOGO_URL, viewer: MANAGER_VIEW }), other];
    renderPage();

    const central = await card("c1");
    expect(central.querySelector("img")).toHaveAttribute("src", LOGO_URL);
    expect(central.querySelector("img")).toHaveClass("object-contain");
    expect(within(await card("c2")).getByText("OC")).toBeInTheDocument();
  });

  it("never shows a figure as 0 before it is known, or when it could not be loaded", async () => {
    server.use(
      http.get("/api/clubs/member-counts", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
      http.get("/api/tournaments/counts", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")),
    );
    renderPage();

    const central = await card("c1");
    expect(within(figure(central, "Members")).getByText("Loading")).toBeInTheDocument();
    await waitFor(() => expect(figure(central, "Total Tournaments")).toHaveTextContent("–"));
    expect(figure(central, "Active Tournaments")).toHaveTextContent("–");
    expect(figure(central, "Active Season")).toHaveTextContent("Summer 2026");
  });

  it("cuts a long description to two lines until Show more", async () => {
    clubs = [clubDto({ description: `<p>${"Friday nights at Club 2020. ".repeat(6)}</p>`, viewer: MANAGER_VIEW })];
    const user = userEvent.setup();
    renderPage();

    const toggle = await within(await card("c1")).findByRole("button", { name: /Show more/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(within(await card("c1")).getByRole("button", { name: /Show less/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("offers to create the first club when there are none", async () => {
    clubs = [];
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("No Clubs Found")).toBeInTheDocument();
    await user.click(screen.getByTestId("create-first-club"));

    expect(await screen.findByRole("dialog", { name: "Create New Club" })).toBeInTheDocument();
  });

  it("says when the clubs could not be loaded, and tries again", async () => {
    let fail = true;
    server.use(http.get("/api/clubs", () => (fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json([mine]))));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Your clubs could not be loaded");
    expect(screen.queryByText("No Clubs Found")).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await card("c1")).toBeInTheDocument();
  });
});

describe("Create New Club", () => {
  async function openForm() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId("create-club-button"));
    return { user, form: await screen.findByRole("dialog", { name: "Create New Club" }) };
  }

  it("creates the club from its name and the slug made from it, then lists it", async () => {
    let sent: unknown;
    server.use(
      http.post("/api/clubs", async ({ request }) => {
        sent = await request.json();
        const created = clubDto({ id: "c3", name: "Club 2020", slug: "club-2020", viewer: { canManage: true, canOwn: true } });
        clubs = [...clubs, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const { user, form } = await openForm();
    const listed = clubListRequests;

    await user.type(within(form).getByTestId("club-name"), "Club 2020");
    expect(within(form).getByLabelText("URL Slug*")).toHaveValue("club-2020");
    expect(within(form).getByLabelText("Time zone")).toHaveValue("Pacific/Auckland");
    await user.click(within(form).getByTestId("create-club-final"));

    expect(await screen.findByText("Club created successfully!")).toBeInTheDocument();
    expect(sent).toEqual({ name: "Club 2020", slug: "club-2020", description: null, imageUrl: null, address: null, timezone: "Pacific/Auckland", rakeLabel: null });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create New Club" })).not.toBeInTheDocument());
    expect(await card("c3")).toHaveTextContent("Club 2020");
    expect(clubListRequests).toBeGreaterThan(listed);
  });

  it("asks for a name and a usable slug before sending anything", async () => {
    const posted = vi.fn();
    server.use(http.post("/api/clubs", () => posted()));
    const { user, form } = await openForm();

    await user.click(within(form).getByTestId("create-club-final"));

    expect(await within(form).findByText("Required")).toBeInTheDocument();
    expect(within(form).getByText("Use at least 2 characters")).toBeInTheDocument();
    expect(posted).not.toHaveBeenCalled();
  });

  it("puts a taken slug under the slug field", async () => {
    server.use(http.post("/api/clubs", () => apiError(409, "SLUG_TAKEN", "That club URL is already taken")));
    const { user, form } = await openForm();

    await user.type(within(form).getByTestId("club-name"), "Central Stars");
    await user.click(within(form).getByTestId("create-club-final"));

    expect(await within(form).findByText("That club URL is already taken")).toBeInTheDocument();
    expect(within(form).getByLabelText("URL Slug*")).toHaveAttribute("aria-invalid", "true");
  });

  it("says why the server refused anything else", async () => {
    server.use(
      http.post("/api/clubs", () =>
        apiError(409, "CLUB_LIMIT_REACHED", "You already own 10 clubs, the most one account can open. Ask an admin if you need another."),
      ),
    );
    const { user, form } = await openForm();

    await user.type(within(form).getByTestId("club-name"), "Eleventh Club");
    await user.click(within(form).getByTestId("create-club-final"));

    expect(await screen.findByText("You already own 10 clubs, the most one account can open. Ask an admin if you need another.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Create New Club" })).toBeInTheDocument();
  });

  it("keeps Create disabled while the logo uploads, and sends the uploaded logo (img-15)", async () => {
    const uploads = installFakeXhr();
    let sent: { imageUrl?: unknown } = {};
    server.use(
      http.post("/api/clubs", async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json(clubDto({ id: "c3" }), { status: 201 });
      }),
    );
    const { user, form } = await openForm();
    await user.type(within(form).getByTestId("club-name"), "Club 2020");

    const input = form.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(64)], "logo.png", { type: "image/png" }));
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(within(form).getByTestId("create-club-final")).toBeDisabled();
    expect(within(form).getByTestId("create-club-final")).toHaveTextContent("Uploading image…");

    uploads[0].respond(201, { kind: "club_logo", url: LOGO_URL, variants: {}, width: 512, height: 512, dominantColor: null });
    await waitFor(() => expect(within(form).getByTestId("create-club-final")).toBeEnabled());
    await user.click(within(form).getByTestId("create-club-final"));

    await waitFor(() => expect(sent.imageUrl).toBe(LOGO_URL));
  });
});
