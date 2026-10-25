import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeController, ThemeScope, useTheme, type ThemeLayer } from "./theme";

const STAFF: ThemeLayer = { colorScheme: "preference", surface: "admin" };
const PUBLIC: ThemeLayer = { colorScheme: "light", surface: "public" };
const CLUB: ThemeLayer = { colorScheme: "dark", surface: "club", variables: { "--primary": "30 123 255" } };

const root = document.documentElement;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  root.className = "";
  root.removeAttribute("style");
  delete root.dataset.surface;
});

function Toggle() {
  const { preference, setPreference } = useTheme();
  return <button onClick={() => setPreference(preference === "light" ? "dark" : "light")}>{preference}</button>;
}

describe("ThemeController", () => {
  it("follows the saved preference on staff screens and remembers a change", async () => {
    window.localStorage.setItem("theme", "dark");
    render(
      <ThemeController>
        <ThemeScope layer={STAFF}>
          <Toggle />
        </ThemeScope>
      </ThemeController>,
    );

    expect(root).toHaveClass("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.dataset.surface).toBe("admin");

    await userEvent.click(screen.getByRole("button", { name: "dark" }));

    expect(root).not.toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("light");
  });

  it("keeps public pages light whatever the staff preference, so dark mode never leaks onto them", () => {
    window.localStorage.setItem("theme", "dark");
    function App() {
      const [where, setWhere] = useState<"staff" | "public">("staff");
      return (
        <ThemeController>
          <button onClick={() => setWhere(where === "staff" ? "public" : "staff")}>go</button>
          {where === "staff" ? <ThemeScope layer={STAFF}>staff</ThemeScope> : <ThemeScope layer={PUBLIC}>public</ThemeScope>}
        </ThemeController>
      );
    }
    render(<App />);
    expect(root).toHaveClass("dark");

    act(() => screen.getByRole("button", { name: "go" }).click());

    expect(root).not.toHaveClass("dark");
    expect(root.dataset.surface).toBe("public");
  });

  it("lets a scope inside another (a club's theme) win while mounted, then puts the outer one back", () => {
    function App() {
      const [club, setClub] = useState(true);
      return (
        <ThemeController>
          <button onClick={() => setClub(!club)}>club</button>
          <ThemeScope layer={PUBLIC}>{club ? <ThemeScope layer={CLUB}>club page</ThemeScope> : "home"}</ThemeScope>
        </ThemeController>
      );
    }
    render(<App />);

    expect(root).toHaveClass("dark");
    expect(root.dataset.surface).toBe("club");
    expect(root.style.getPropertyValue("--primary")).toBe("30 123 255");

    act(() => screen.getByRole("button", { name: "club" }).click());

    expect(root).not.toHaveClass("dark");
    expect(root.dataset.surface).toBe("public");
    expect(root.style.getPropertyValue("--primary")).toBe("");
  });

  it("keeps the enclosing scope's scheme and surface for whatever an inner scope leaves out (a club's colours on the TV)", () => {
    const DISPLAY: ThemeLayer = { colorScheme: "dark", surface: "display" };
    const COLOURS: ThemeLayer = { variables: { "--primary": "63 169 255" } };
    render(
      <ThemeController>
        <ThemeScope layer={DISPLAY}>
          <ThemeScope layer={COLOURS}>clock</ThemeScope>
        </ThemeScope>
      </ThemeController>,
    );

    expect(root).toHaveClass("dark");
    expect(root.dataset.surface).toBe("display");
    expect(root.style.getPropertyValue("--primary")).toBe("63 169 255");
  });

  it("works out scheme-aware variables for the scheme on screen, again when the person switches it", async () => {
    window.localStorage.setItem("theme", "dark");
    const COLOURS: ThemeLayer = { variables: (scheme) => ({ "--primary": scheme === "dark" ? "63 169 255" : "26 108 224" }) };
    render(
      <ThemeController>
        <ThemeScope layer={STAFF}>
          <ThemeScope layer={COLOURS}>
            <Toggle />
          </ThemeScope>
        </ThemeScope>
      </ThemeController>,
    );

    expect(root).toHaveClass("dark");
    expect(root.dataset.surface).toBe("admin");
    expect(root.style.getPropertyValue("--primary")).toBe("63 169 255");

    await userEvent.click(screen.getByRole("button", { name: "dark" }));

    expect(root).not.toHaveClass("dark");
    expect(root.style.getPropertyValue("--primary")).toBe("26 108 224");
  });

  it("keeps the enclosing scope's variables when an inner scope sets none, and clears them for an empty set", () => {
    const EMPTY: ThemeLayer = { variables: {} };
    function App({ inner }: { inner: ThemeLayer }) {
      return (
        <ThemeController>
          <ThemeScope layer={CLUB}>
            <ThemeScope layer={inner}>page</ThemeScope>
          </ThemeScope>
        </ThemeController>
      );
    }
    const { rerender } = render(<App inner={PUBLIC} />);
    expect(root.style.getPropertyValue("--primary")).toBe("30 123 255");
    expect(root.dataset.surface).toBe("public");

    rerender(<App inner={EMPTY} />);
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(root.dataset.surface).toBe("club");
  });

  it("uses the device's setting when nothing is saved, and works without storage", () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    try {
      render(
        <ThemeController>
          <ThemeScope layer={STAFF}>
            <Toggle />
          </ThemeScope>
        </ThemeController>,
      );
      // The test environment's matchMedia matches nothing: the device says light.
      expect(screen.getByRole("button", { name: "light" })).toBeInTheDocument();
      expect(root).not.toHaveClass("dark");
    } finally {
      window.localStorage.getItem = original;
    }
  });
});
