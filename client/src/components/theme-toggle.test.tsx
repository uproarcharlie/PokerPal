import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeController, ThemeScope, type ThemeLayer } from "@/app/theme";
import { ThemeToggle } from "./theme-toggle";

const STAFF: ThemeLayer = { colorScheme: "preference", surface: "admin" };
const root = document.documentElement;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  root.className = "";
  root.removeAttribute("style");
  delete root.dataset.surface;
});

describe("ThemeToggle", () => {
  it("says what it switches to, switches the staff screens, and remembers the choice", async () => {
    window.localStorage.setItem("theme", "light");
    render(
      <ThemeController>
        <ThemeScope layer={STAFF}>
          <ThemeToggle />
        </ThemeScope>
      </ThemeController>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Dark Mode" }));

    expect(root).toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: "Light Mode" }));
    expect(root).not.toHaveClass("dark");
  });
});
