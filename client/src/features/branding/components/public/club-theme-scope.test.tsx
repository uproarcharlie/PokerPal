import { useState } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { clubDto } from "@test/helpers/dto";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { CENTRAL_STARS_THEME, themeVariables, type ClubTheme } from "@shared/domain/theme";
import { DisplayLayout } from "@/app/layouts/display-layout";
import { PublicLayout } from "@/app/layouts/public-layout";
import { ThemeScope, useTheme, type ThemeLayer } from "@/app/theme";
import { ClubThemeScope } from "./club-theme-scope";

const root = document.documentElement;
const STAFF: ThemeLayer = { colorScheme: "preference", surface: "admin" };
const LIGHT = themeVariables(CENTRAL_STARS_THEME, "light");
const DARK = themeVariables(CENTRAL_STARS_THEME, "dark");

const primary = () => root.style.getPropertyValue("--primary");

beforeEach(() => {
  window.localStorage.clear();
  mockSignedOut();
});
afterEach(() => {
  root.className = "";
  root.removeAttribute("style");
  delete root.dataset.surface;
});

/** GET /api/clubs/c1, counted; answered at once, or when `release` is called. */
function serveClub(theme: ClubTheme | null, { held = false } = {}) {
  const reads = { count: 0, release: () => {} };
  const gate = new Promise<void>((resolve) => {
    reads.release = resolve;
  });
  server.use(
    http.get("/api/clubs/c1", async () => {
      reads.count += 1;
      if (held) await gate;
      return HttpResponse.json(clubDto({ theme }));
    }),
  );
  return reads;
}

describe("ClubThemeScope", () => {
  it("dresses the club's public pages in its colours, worked out for the light page", async () => {
    renderWithApp(
      <PublicLayout>
        <ClubThemeScope theme={CENTRAL_STARS_THEME} scheme="light">
          <h1>Central Stars</h1>
        </ClubThemeScope>
      </PublicLayout>,
    );

    expect(await screen.findByRole("heading", { name: "Central Stars" })).toBeInTheDocument();
    expect(root).not.toHaveClass("dark");
    expect(root.dataset.surface).toBe("public");
    for (const [name, value] of Object.entries(LIGHT)) expect(root.style.getPropertyValue(name), name).toBe(value);
  });

  it("works the colours out for the dark TV, keeping the display layout's scheme and surface when no scheme is given", async () => {
    renderWithApp(
      <DisplayLayout>
        <ClubThemeScope theme={CENTRAL_STARS_THEME}>
          <h1>Tournament clock</h1>
        </ClubThemeScope>
      </DisplayLayout>,
    );

    expect(await screen.findByRole("heading", { name: "Tournament clock" })).toBeInTheDocument();
    expect(root).toHaveClass("dark");
    expect(root.dataset.surface).toBe("display");
    expect(primary()).toBe(DARK["--primary"]);
    expect(root.style.getPropertyValue("--accent-text")).toBe(DARK["--accent-text"]);
    // The light page's purple tints are not set on the dark screen.
    expect(root.style.getPropertyValue("--muted")).toBe("");
  });

  it("follows the person's light or dark choice on the club's tournament pages for staff", async () => {
    window.localStorage.setItem("theme", "dark");
    function Toggle() {
      const { preference, setPreference } = useTheme();
      return <button onClick={() => setPreference(preference === "dark" ? "light" : "dark")}>{`Scheme: ${preference}`}</button>;
    }
    renderWithApp(
      <ThemeScope layer={STAFF}>
        <ClubThemeScope theme={CENTRAL_STARS_THEME} scheme="preference">
          <Toggle />
        </ClubThemeScope>
      </ThemeScope>,
    );

    expect(root).toHaveClass("dark");
    expect(root.dataset.surface).toBe("admin");
    expect(primary()).toBe(DARK["--primary"]);

    await userEvent.click(screen.getByRole("button", { name: "Scheme: dark" }));

    expect(root).not.toHaveClass("dark");
    expect(primary()).toBe(LIGHT["--primary"]);
    expect(root.style.getPropertyValue("--muted")).toBe(LIGHT["--muted"]);
  });

  it("reads the club by id when the page knows only that, without remounting the page when the colours arrive", async () => {
    const reads = serveClub(CENTRAL_STARS_THEME, { held: true });
    renderWithApp(
      <PublicLayout>
        <ClubThemeScope clubId="c1" scheme="light">
          <label>
            Name
            <input />
          </label>
        </ClubThemeScope>
      </PublicLayout>,
    );
    await userEvent.type(await screen.findByLabelText("Name"), "Alice");
    expect(primary()).toBe("");

    await act(async () => reads.release());

    await waitFor(() => expect(primary()).toBe(LIGHT["--primary"]));
    expect(screen.getByLabelText("Name")).toHaveValue("Alice");
    expect(reads.count).toBe(1);
  });

  it("asks for nothing when the page passes the theme, even null", async () => {
    const reads = serveClub(CENTRAL_STARS_THEME);
    renderWithApp(
      <PublicLayout>
        <ClubThemeScope theme={null} clubId="c1" scheme="light">
          <h1>Seats</h1>
        </ClubThemeScope>
      </PublicLayout>,
    );

    expect(await screen.findByRole("heading", { name: "Seats" })).toBeInTheDocument();
    expect(reads.count).toBe(0);
  });

  it.each([
    ["has no theme", null],
    ["holds a theme that does not read", { v: 2, colors: { primary: "blue" } } as unknown as ClubTheme],
  ])("keeps the LovePoker look for a club that %s", async (_, theme) => {
    const reads = serveClub(theme);
    renderWithApp(
      <PublicLayout>
        <ClubThemeScope clubId="c1" scheme="light">
          <h1>Central Stars</h1>
        </ClubThemeScope>
      </PublicLayout>,
    );

    await waitFor(() => expect(reads.count).toBe(1));
    expect(await screen.findByRole("heading", { name: "Central Stars" })).toBeInTheDocument();
    expect(root.getAttribute("style") ?? "").not.toContain("--");
    expect(root.dataset.surface).toBe("public");
  });

  it("puts the layout's own look back when the person leaves the club's page", async () => {
    function App() {
      const [onClub, setOnClub] = useState(true);
      return (
        <PublicLayout>
          <button onClick={() => setOnClub(false)}>Home</button>
          {onClub ? <ClubThemeScope theme={CENTRAL_STARS_THEME}>club page</ClubThemeScope> : "home page"}
        </PublicLayout>
      );
    }
    renderWithApp(<App />);
    expect(await screen.findByText("club page")).toBeInTheDocument();
    expect(primary()).toBe(LIGHT["--primary"]);

    await userEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(screen.getByText("home page")).toBeInTheDocument();
    expect(primary()).toBe("");
    expect(root.dataset.surface).toBe("public");
  });
});
