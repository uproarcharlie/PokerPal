import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClubPlayer } from "@shared/api/players";
import { server } from "@test/msw/server";
import { installFakeXhr, type FakeXhr } from "@test/helpers/fake-xhr";
import { clubDto, clubPlayer, visitingPlayer } from "@test/helpers/f5-dto";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import PlayersPage from "./players";

const ADMIN = { id: "a1", name: "Ada Admin", email: "ada@lovepoker.test", role: "admin" } as const;
const OWNER = { id: "u1", name: "Olly Owner", email: "olly@club.test", role: "full_member" } as const;

const PHOTO_A = "/uploads/player_avatar/0b9f6a6e-1d2c-4c39-9a4e-2f6f5e0c1a11/512.webp";
const PHOTO_B = "/uploads/player_avatar/1c2e3f40-5a6b-4c7d-8e9f-a0b1c2d3e4f5/512.webp";

const aroha = clubPlayer({ id: "p1-0000-0000", name: "Aroha Smith", imageUrl: PHOTO_A });
const ben = clubPlayer({ id: "p2-0000-0000", name: "Ben Ngata", email: null, phone: null, imageUrl: PHOTO_B });
const vic = visitingPlayer();

/** GET /api/players answering `players`, recording each query string it was asked with. */
function servePlayers(players: () => ClubPlayer[]) {
  const asked: string[] = [];
  server.use(
    http.get("/api/players", ({ request }) => {
      asked.push(new URL(request.url).search);
      return HttpResponse.json(players());
    }),
  );
  return asked;
}

const rowOf = (name: string) => screen.getByRole("cell", { name: new RegExp(name) }).closest("tr") as HTMLElement;

describe("Players page, as an admin", () => {
  it("lists every player with their photo or initials, contact details, and Edit only for players they may edit", async () => {
    mockSignedIn(ADMIN);
    const asked = servePlayers(() => [aroha, ben, vic]);
    renderWithApp(<PlayersPage />, { path: "/players" });

    expect(await screen.findByRole("heading", { name: "All Players" })).toBeInTheDocument();
    expect(asked).toEqual([""]);
    expect(screen.getByText("3 players registered")).toBeInTheDocument();
    expect(within(rowOf("Aroha Smith")).getByText(/aroha@example.com/)).toBeInTheDocument();
    expect(within(rowOf("Ben Ngata")).getByText("No contact info")).toBeInTheDocument();
    expect(within(rowOf("Vic Visitor")).getByText("Visiting from another club")).toBeInTheDocument();
    expect(within(rowOf("Vic Visitor")).getByText("VV")).toBeInTheDocument();
    expect(within(rowOf("Vic Visitor")).queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Aroha Smith" })).toBeInTheDocument();
    expect(within(rowOf("Aroha Smith")).getByText("4 Mar 2026")).toBeInTheDocument();
    // The old page's Export and View buttons did nothing.
    expect(screen.queryByRole("button", { name: /Export|View/ })).not.toBeInTheDocument();
  });

  it("says when the players could not be loaded, and loads them on a retry", async () => {
    mockSignedIn(ADMIN);
    let fail = true;
    server.use(
      http.get("/api/players", () =>
        fail ? apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.") : HttpResponse.json([aroha]),
      ),
    );
    renderWithApp(<PlayersPage />, { path: "/players" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Players could not be loaded");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Aroha Smith")).toBeInTheDocument();
  });
});

describe("Players page, for a club's staff", () => {

  it("asks them to start a club when they run none", async () => {
    mockSignedIn(OWNER);
    server.use(http.get("/api/clubs", () => HttpResponse.json([clubDto({ viewer: { canManage: false, canOwn: false } })])));
    renderWithApp(<PlayersPage />, { path: "/players" });

    expect(await screen.findByRole("heading", { name: "No Clubs Yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Your First Club" })).toHaveAttribute("href", "/clubs");
  });

  it("lists the players of the club they choose, from that club's own list", async () => {
    mockSignedIn(OWNER);
    server.use(
      http.get("/api/clubs", () =>
        HttpResponse.json([clubDto(), clubDto({ id: "c2", name: "Other Club", viewer: { canManage: false, canOwn: false } })]),
      ),
    );
    const asked = servePlayers(() => [aroha]);
    renderWithApp(<PlayersPage />, { path: "/players" });

    expect(await screen.findByRole("heading", { name: "Select a Club" })).toBeInTheDocument();
    expect(asked).toEqual([]);
    await userEvent.click(screen.getByRole("combobox", { name: "Select Club" }));
    expect(screen.queryByRole("option", { name: "Other Club" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "Central Stars" }));

    expect(await screen.findByRole("heading", { name: "Players - Central Stars" })).toBeInTheDocument();
    expect(asked).toEqual(["?clubId=c1"]);
    expect(screen.getByText("Aroha Smith")).toBeInTheDocument();
  });

  it("says when a club has no players yet", async () => {
    mockSignedIn(OWNER);
    server.use(http.get("/api/clubs", () => HttpResponse.json([clubDto()])));
    servePlayers(() => []);
    renderWithApp(<PlayersPage />, { path: "/players" });

    await userEvent.click(await screen.findByRole("combobox", { name: "Select Club" }));
    await userEvent.click(screen.getByRole("option", { name: "Central Stars" }));

    expect(await screen.findByRole("heading", { name: "No Players Yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a Tournament" })).toHaveAttribute("href", "/tournaments");
  });
});

describe("Players page: editing a player", () => {
  let uploads: FakeXhr[];
  beforeEach(() => {
    uploads = installFakeXhr();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("really removes a cleared email, phone and photo (CA-24, img-04), and refreshes the list", async () => {
    mockSignedIn(ADMIN);
    let saved = aroha;
    servePlayers(() => [saved]);
    let body: unknown;
    server.use(
      http.put("/api/players/:id", async ({ request, params }) => {
        body = await request.json();
        expect(params.id).toBe(aroha.id);
        saved = { ...aroha, email: null, phone: null, imageUrl: null };
        return HttpResponse.json(saved);
      }),
    );
    renderWithApp(<PlayersPage />, { path: "/players" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Aroha Smith" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    expect(within(sheet).getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", PHOTO_A);
    await userEvent.clear(within(sheet).getByLabelText("Email Address"));
    await userEvent.clear(within(sheet).getByLabelText("Phone Number"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Player" })).not.toBeInTheDocument());
    expect(body).toEqual({ name: "Aroha Smith", email: null, phone: null, imageUrl: null });
    expect(await within(rowOf("Aroha Smith")).findByText("No contact info")).toBeInTheDocument();
    expect(screen.getByText("Player updated")).toBeInTheDocument();
  });

  it("lets staff give a player one of the avatars instead of a photo, with the same three choices (round 5, item 8)", async () => {
    mockSignedIn(ADMIN);
    let saved: typeof aroha = { ...aroha, imageUrl: null };
    servePlayers(() => [saved]);
    let body: unknown;
    server.use(
      http.put("/api/players/:id", async ({ request }) => {
        body = await request.json();
        saved = { ...saved, imageUrl: "/avatars/cowboy.svg" };
        return HttpResponse.json(saved);
      }),
    );
    renderWithApp(<PlayersPage />, { path: "/players" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Aroha Smith" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    const photo = within(sheet).getByRole("group", { name: "Player Photo" });
    expect(within(photo).getAllByRole("button").map((button) => button.textContent)).toEqual(["Take a photo", "Upload a photo", "Pick an avatar"]);
    await userEvent.click(within(photo).getByRole("button", { name: "Pick an avatar" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Pick an avatar" })).getByRole("button", { name: "Cowboy hat" }));
    expect(within(sheet).getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", "/avatars/cowboy.svg");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Player" })).not.toBeInTheDocument());
    expect(body).toMatchObject({ imageUrl: "/avatars/cowboy.svg" });
    expect(uploads).toHaveLength(0);
    await waitFor(() => expect(rowOf("Aroha Smith").querySelector("img")).toHaveAttribute("src", "/avatars/cowboy.svg"));
  });

  it("starts each edit from the player opened, photo included (img-03)", async () => {
    mockSignedIn(ADMIN);
    servePlayers(() => [aroha, ben]);
    renderWithApp(<PlayersPage />, { path: "/players" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Aroha Smith" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Edit Player" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Edit Ben Ngata" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    expect(within(sheet).getByLabelText("Player Name*")).toHaveValue("Ben Ngata");
    expect(within(sheet).getByLabelText("Email Address")).toHaveValue("");
    expect(within(sheet).getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", PHOTO_B);
  });

  it("words a name that is too long as every form does, before sending anything (P3REV2-CQ-03)", async () => {
    mockSignedIn(ADMIN);
    servePlayers(() => [aroha]);
    renderWithApp(<PlayersPage />, { path: "/players" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Aroha Smith" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    const name = within(sheet).getByLabelText("Player Name*");
    await userEvent.clear(name);
    await userEvent.click(name);
    await userEvent.paste("A".repeat(101));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }));

    expect(await within(sheet).findByText("Must be 100 characters or fewer")).toBeInTheDocument();
    expect(within(sheet).queryByText(/String must contain/)).not.toBeInTheDocument();
  });

  it("puts a phone number another player has under the phone field and keeps the panel open", async () => {
    mockSignedIn(ADMIN);
    servePlayers(() => [aroha]);
    server.use(
      http.put("/api/players/:id", () => apiError(409, "PHONE_TAKEN", "That phone number is already registered to another player.")),
    );
    renderWithApp(<PlayersPage />, { path: "/players" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Aroha Smith" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }));

    expect(await within(sheet).findByText("That phone number is already registered to another player.")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Phone Number")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps Save disabled while a new photo uploads, then saves the uploaded one", async () => {
    mockSignedIn(ADMIN);
    servePlayers(() => [ben]);
    let body: unknown;
    server.use(
      http.put("/api/players/:id", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(ben);
      }),
    );
    renderWithApp(<PlayersPage />, { path: "/players" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Ben Ngata" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    const input = sheet.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(64)], "me.jpg", { type: "image/jpeg" })] } });
    await userEvent.click(await screen.findByRole("button", { name: "Use this" }));

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(within(sheet).getByRole("button", { name: /Uploading image/ })).toBeDisabled();
    act(() =>
      uploads[0].respond(201, { kind: "player_avatar", url: PHOTO_A, variants: {}, width: 512, height: 512, dominantColor: null }),
    );

    const save = await within(sheet).findByRole("button", { name: "Save Changes" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(body).toMatchObject({ imageUrl: PHOTO_A }));
  });
});
