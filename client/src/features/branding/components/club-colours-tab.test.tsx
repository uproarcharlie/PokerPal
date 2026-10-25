import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { clubDto, MANAGER_VIEW } from "@test/helpers/dto";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import type { ClubDto } from "@shared/api/public";
import { CENTRAL_STARS_THEME, themeVariables, type ClubTheme } from "@shared/domain/theme";
import { useClub } from "@/features/clubs/hooks";
import { qk } from "@/lib/api/query-keys";
import { ClubColoursTab } from "./club-colours-tab";

let club: ClubDto;
let sent: Record<string, unknown>[];

/** The club as the server holds it: PUT merges into it and answers with it, as the API does. */
function serveClub(theme: ClubTheme | null) {
  club = clubDto({ viewer: MANAGER_VIEW, theme });
  server.use(
    http.get("/api/clubs/c1", () => HttpResponse.json(club)),
    http.put("/api/clubs/c1", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push(body);
      club = { ...club, ...body } as ClubDto;
      return HttpResponse.json(club);
    }),
  );
}

const realMatchMedia = window.matchMedia;
const realWidth = window.innerWidth;
const realHeight = window.innerHeight;

/** A 390 × 844 phone: the width media queries see, and the window's size. */
function phoneViewport() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  window.matchMedia = (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = (max ? 390 <= Number(max[1]) : true) && (min ? 390 >= Number(min[1]) : true) && Boolean(max || min);
    return { ...realMatchMedia(query), matches, media: query };
  };
}

beforeEach(() => {
  sent = [];
  phoneViewport();
  mockSignedIn({ id: "u1", name: "Tess Director", email: "tess@club.test", role: "full_member" });
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: realWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: realHeight });
});

/** As club settings mounts it: with the club from the cache that a save updates. */
function Settings() {
  const loaded = useClub("c1");
  return loaded.data ? <ClubColoursTab club={loaded.data} /> : null;
}

async function renderTab(theme: ClubTheme | null = null) {
  serveClub(theme);
  const rendered = renderWithApp(<Settings />);
  await screen.findByRole("heading", { name: "Club colours" });
  return rendered;
}

const saveButton = () => screen.getByRole("button", { name: /Save colours|Saving/ });
const preset = (name: RegExp) => screen.getByRole("button", { name });
const hexBox = (label: string) => screen.getByLabelText(label);

describe("ClubColoursTab", () => {
  it("starts a club without a theme on the LovePoker purple, with nothing to save", async () => {
    await renderTab();

    expect(screen.getByTestId("colours-now")).toHaveTextContent("Now: the LovePoker purple (the app's own colours)");
    expect(preset(/^LovePoker purple/)).toHaveAttribute("aria-pressed", "true");
    expect(preset(/^Central Stars/)).toHaveAttribute("aria-pressed", "false");
    expect(hexBox("Main colour")).toHaveValue("#6B46C1");
    expect(hexBox("Accent colour")).toHaveValue("#F59E0B");
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.queryByRole("button", { name: /Reset to LovePoker/ })).not.toBeInTheDocument();
  });

  it("puts Central Stars' blue and gold on the club with two taps: the preset, then Save", async () => {
    const user = userEvent.setup();
    const { queryClient } = await renderTab();

    await user.click(preset(/^Central Stars/));

    expect(preset(/^Central Stars/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Colours (Central Stars)" })).toBeInTheDocument();
    expect(hexBox("Main colour")).toHaveValue("#1E7BFF");
    expect(hexBox("Glow")).toHaveValue("#3FA9FF");
    const notes = within(screen.getByTestId("readability-notes")).getAllByRole("listitem");
    expect(notes.map((note) => note.textContent)).toEqual([
      expect.stringMatching(/^Main colour: deepened to #[0-9A-F]{6} on light pages, so links and button words stay readable\.$/),
      expect.stringMatching(/^Accent as text \(prize money, antes\): deepened to #[0-9A-F]{6} on light pages, so it reads on white\.$/),
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");

    await user.click(saveButton());

    await waitFor(() => expect(sent).toEqual([{ theme: CENTRAL_STARS_THEME }]));
    expect(await screen.findByText("Club colours saved")).toBeInTheDocument();
    expect(screen.getByText("Central Stars now wears Central Stars.")).toBeInTheDocument();
    expect(queryClient.getQueryData<ClubDto>(qk.clubs.detail("c1"))?.theme).toEqual(CENTRAL_STARS_THEME);
    expect(saveButton()).toBeDisabled();
  });

  it("shows a public page and the TV in the colours being edited, each in its own scheme", async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(preset(/^Central Stars/));

    const light = within(screen.getByTestId("theme-preview-light")).getByText("Sign up").closest("[aria-hidden]") as HTMLElement;
    const dark = within(screen.getByTestId("theme-preview-dark")).getByText("Sign up").closest("[aria-hidden]") as HTMLElement;
    expect(screen.getByTestId("theme-preview-light")).toHaveTextContent("Public pages");
    expect(screen.getByTestId("theme-preview-dark")).toHaveTextContent("TV clock and dark mode");
    expect(light.style.getPropertyValue("--primary")).toBe(themeVariables(CENTRAL_STARS_THEME, "light")["--primary"]);
    expect(light.style.getPropertyValue("--background")).toBe("243 244 246");
    expect(light).not.toHaveClass("dark");
    expect(dark).toHaveClass("dark");
    expect(dark.style.getPropertyValue("--primary")).toBe(themeVariables(CENTRAL_STARS_THEME, "dark")["--primary"]);
    expect(within(light).getByText("Central Stars")).toBeInTheDocument();
  });

  it("saves the club's own colours, typed or picked, tidied to #RRGGBB", async () => {
    const user = userEvent.setup();
    await renderTab();

    await user.clear(hexBox("Main colour"));
    await user.type(hexBox("Main colour"), "c0392b");
    fireEvent.change(screen.getByLabelText("Pick the accent colour"), { target: { value: "#f1c40f" } });
    await user.tab();

    expect(hexBox("Main colour")).toHaveValue("#C0392B");
    expect(hexBox("Accent colour")).toHaveValue("#F1C40F");
    expect(screen.getByRole("heading", { name: "Your own colours" })).toBeInTheDocument();
    expect(preset(/^LovePoker purple/)).toHaveAttribute("aria-pressed", "false");
    // The LovePoker glow went with its purple, so the TV shows the club's red, not a purple glow.
    expect(hexBox("Glow")).toHaveValue("");
    expect(hexBox("Glow")).toHaveAttribute("placeholder", "Same as the main colour");

    await user.click(saveButton());

    await waitFor(() => expect(sent).toEqual([{ theme: { v: 1, preset: null, colors: { primary: "#C0392B", accent: "#F1C40F" } } }]));
    expect(await screen.findByText("Central Stars now wears your own colours.")).toBeInTheDocument();
    expect(screen.getByTestId("colours-now")).toHaveTextContent("Now: your own colours");
  });

  it("says what is wrong with a colour that does not read, and sends nothing", async () => {
    const user = userEvent.setup();
    await renderTab();

    await user.clear(hexBox("Main colour"));
    await user.type(hexBox("Main colour"), "#12");
    expect(screen.queryByText("Main colour: use a colour like #1E7BFF")).not.toBeInTheDocument();
    await user.tab();

    expect(screen.getByText("Main colour: use a colour like #1E7BFF")).toBeInTheDocument();
    expect(hexBox("Main colour")).toHaveAttribute("aria-invalid", "true");
    expect(hexBox("Main colour")).toHaveAccessibleDescription(expect.stringContaining("use a colour like #1E7BFF"));

    await user.click(saveButton());
    expect(sent).toEqual([]);

    await user.clear(hexBox("Main colour"));
    await user.type(hexBox("Main colour"), "#abc");
    await user.tab();
    expect(screen.queryByText("Main colour: use a colour like #1E7BFF")).not.toBeInTheDocument();
    expect(hexBox("Main colour")).toHaveValue("#AABBCC");
  });

  it("puts the server's refusal on the colour it is about", async () => {
    const user = userEvent.setup();
    await renderTab();
    server.use(
      http.put("/api/clubs/c1", () =>
        apiError(400, "VALIDATION", "Invalid request", [{ path: ["theme", "colors", "accent"], message: "Accent colour: use a colour like #1E7BFF" }]),
      ),
    );

    await user.click(preset(/^Central Stars/));
    await user.click(saveButton());

    expect(await screen.findByText("Accent colour: use a colour like #1E7BFF")).toBeInTheDocument();
    expect(hexBox("Accent colour")).toHaveAttribute("aria-invalid", "true");
  });

  it("says when the colours could not be saved for another reason", async () => {
    const user = userEvent.setup();
    await renderTab();
    server.use(http.put("/api/clubs/c1", () => apiError(403, "FORBIDDEN", "Only the club's staff can change it")));

    await user.click(preset(/^Central Stars/));
    await user.click(saveButton());

    expect(await screen.findByText("Could not save the colours")).toBeInTheDocument();
    expect(screen.getByText("Only the club's staff can change it")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  });

  it("resets the club to the LovePoker purple after asking", async () => {
    const user = userEvent.setup();
    await renderTab(CENTRAL_STARS_THEME);
    expect(screen.getByTestId("colours-now")).toHaveTextContent("Now: Central Stars");
    expect(preset(/^Central Stars/)).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Reset to LovePoker purple" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reset to LovePoker purple?" });
    await user.click(within(dialog).getByRole("button", { name: "Reset colours" }));

    await waitFor(() => expect(sent).toEqual([{ theme: null }]));
    expect(await screen.findByText("Colours reset")).toBeInTheDocument();
    expect(screen.getByTestId("colours-now")).toHaveTextContent("Now: the LovePoker purple");
    expect(preset(/^LovePoker purple/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Reset to LovePoker purple" })).not.toBeInTheDocument();
  });

  it("stores no theme when the LovePoker preset is saved untouched, so the club wears the app's own look", async () => {
    const user = userEvent.setup();
    await renderTab(CENTRAL_STARS_THEME);

    await user.click(preset(/^LovePoker purple/));
    await user.click(saveButton());

    await waitFor(() => expect(sent).toEqual([{ theme: null }]));
  });

  it("lets the glow be cleared, so it follows the main colour", async () => {
    const user = userEvent.setup();
    await renderTab(CENTRAL_STARS_THEME);

    await user.click(screen.getByText("Glow and shade (optional)"));
    await user.click(screen.getByRole("button", { name: "Clear the glow" }));

    expect(hexBox("Glow")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear the glow" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pick the glow")).toHaveValue("#1e7bff");
    await user.click(saveButton());
    await waitFor(() => expect(sent).toEqual([{ theme: { v: 1, preset: null, colors: { primary: "#1E7BFF", accent: "#F2C14E", accentDeep: "#B8862B" } } }]));
  });

  it("gives every control a 44 px target on a phone, and the save a full-width button", async () => {
    await renderTab(CENTRAL_STARS_THEME);

    for (const name of [/^LovePoker purple/, /^Central Stars/]) expect(preset(name)).toHaveClass("min-h-11");
    for (const label of ["Main colour", "Accent colour", "Glow", "Accent shade"]) expect(hexBox(label)).toHaveClass("h-11");
    for (const label of ["Pick the main colour", "Pick the accent colour"]) expect(screen.getByLabelText(label)).toHaveClass("h-11", "w-11");
    expect(screen.getByRole("button", { name: "Clear the glow" })).toHaveClass("h-11", "w-11");
    expect(saveButton()).toHaveClass("h-11", "w-full");
    expect(screen.getByRole("button", { name: "Reset to LovePoker purple" })).toHaveClass("h-11", "w-full");
    expect(screen.getByText("Glow and shade (optional)")).toHaveClass("min-h-11");
  });
});
