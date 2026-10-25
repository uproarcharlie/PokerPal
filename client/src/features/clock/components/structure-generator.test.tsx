import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { BLIND_PRESETS } from "@shared/domain/blind-structures";
import { StructureGenerator } from "./structure-generator";

const preview = () => screen.getByRole("table", { name: "Generated levels" });
const levelRows = () => within(preview()).getAllByRole("row").slice(1);

function showGenerator() {
  const onUse = vi.fn();
  renderWithApp(<StructureGenerator actionLabel="Create the clock" onUse={onUse} />);
  return { onUse, user: userEvent.setup() };
}

beforeEach(() => {
  mockSignedOut();
});

describe("StructureGenerator", () => {
  it("previews the levels the settings make, starting from the standard preset", () => {
    showGenerator();
    expect(screen.getByRole("textbox", { name: /Starting stack/ })).toHaveValue("25000");
    const standard = BLIND_PRESETS.find((preset) => preset.key === "standard_15");
    expect(levelRows()).toHaveLength(standard?.structure.levels.length ?? 0);
    expect(levelRows()[0]).toHaveTextContent("1100/20015");
  });

  it("updates the preview as the settings change, and loads a preset's settings", async () => {
    const { user } = showGenerator();
    await user.clear(screen.getByRole("textbox", { name: /Number of levels/ }));
    // Eight levels with a break after the fifth.
    await user.type(screen.getByRole("textbox", { name: /Number of levels/ }), "8");
    expect(levelRows()).toHaveLength(9);

    await user.click(screen.getByRole("button", { name: "Turbo · 10-minute levels" }));
    expect(screen.getByRole("textbox", { name: /Starting stack/ })).toHaveValue("10000");
    expect(levelRows()[0]).toHaveTextContent("125/5010");
  });

  it("makes later levels a different length after the first break", async () => {
    const { user, onUse } = showGenerator();
    await user.click(screen.getByRole("switch", { name: "Later levels are a different length" }));
    await user.clear(screen.getByRole("textbox", { name: /Minutes per later level/ }));
    await user.type(screen.getByRole("textbox", { name: /Minutes per later level/ }), "12");
    await user.click(screen.getByRole("button", { name: "Create the clock" }));

    await vi.waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    const [structure] = onUse.mock.calls[0] as [{ levels: Array<{ kind: string; durationMinutes: number }> }];
    const firstBreak = structure.levels.findIndex((level) => level.kind === "break");
    expect(structure.levels.slice(0, firstBreak).every((level) => level.durationMinutes === 15)).toBe(true);
    expect(structure.levels.slice(firstBreak + 1).filter((level) => level.kind === "level").every((level) => level.durationMinutes === 12)).toBe(true);
  });

  it("says what is wrong, on the box or the part, and makes nothing", async () => {
    const { user, onUse } = showGenerator();
    await user.clear(screen.getByRole("textbox", { name: /Level 1 big blind/ }));
    await user.type(screen.getByRole("textbox", { name: /Level 1 big blind/ }), "50");
    expect(screen.getByText("Fix the settings above to see the levels.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create the clock" }));
    expect(await screen.findByText("The big blind must be at least the small blind")).toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: /Level 1 big blind/ }));
    await user.type(screen.getByRole("textbox", { name: /Level 1 big blind/ }), "200");
    await user.selectOptions(screen.getByRole("combobox", { name: "Each level" }), "Adds the same to the big blind");
    await user.type(screen.getByRole("textbox", { name: /Add to the big blind/ }), "150");
    await user.click(screen.getByRole("button", { name: "Create the clock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The step must be a whole number of two smallest chips (so each small blind is exact)");
    expect(onUse).not.toHaveBeenCalled();
  });

  it("sets the antes from a level, in the chosen mode", async () => {
    const { user, onUse } = showGenerator();
    await user.selectOptions(screen.getByRole("combobox", { name: "Ante" }), "Ante (every player)");
    await user.clear(screen.getByRole("textbox", { name: /From level/ }));
    await user.type(screen.getByRole("textbox", { name: /From level/ }), "2");
    await user.click(screen.getByRole("button", { name: "Create the clock" }));

    await vi.waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    const [structure] = onUse.mock.calls[0] as [{ anteMode: string; levels: Array<{ kind: string; ante?: number }> }];
    expect(structure.anteMode).toBe("everyone");
    const plays = structure.levels.filter((level) => level.kind === "level");
    expect(plays[0].ante).toBe(0);
    expect(plays[1].ante).toBeGreaterThan(0);
  });
});
