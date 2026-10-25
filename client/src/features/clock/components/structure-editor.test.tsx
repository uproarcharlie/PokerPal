import { useEffect, useState, type MutableRefObject } from "react";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { clockDto, liveDisplayDto, mockClockTabReads, recordClockChanges, resetServerTime, runningClock, shortStructure } from "@test/helpers/clock-dto";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import type { ClockDto } from "@shared/api/clock";
import { presetStructure, type BlindPresetKey } from "@shared/domain/blind-structures";
import { structureHash, type ClockStructure } from "@shared/domain/clock";
import { StructureEditor } from "./structure-editor";

/** The editor over a clock the test can change, as a poll would. */
function Host({ initial, currentLevelId, swapRef }: { initial: ClockDto; currentLevelId: string | null; swapRef: MutableRefObject<(clock: ClockDto) => void> }) {
  const [clock, setClock] = useState(initial);
  useEffect(() => {
    swapRef.current = setClock;
  }, [swapRef]);
  return <StructureEditor tournamentId="t1" clubId="c1" clock={clock} currentLevelId={currentLevelId} timeZone="Pacific/Auckland" />;
}

function showEditor(clock: ClockDto = clockDto(), currentLevelId: string | null = "l1") {
  const swapRef: MutableRefObject<(clock: ClockDto) => void> = { current: () => undefined };
  const view = renderWithApp(<Host initial={clock} currentLevelId={currentLevelId} swapRef={swapRef} />);
  return { ...view, showClock: (next: ClockDto) => act(() => swapRef.current(next)) };
}

const box = (name: string) => screen.getByRole("textbox", { name });
const rowTitles = () => within(screen.getByRole("list", { name: "Levels and breaks" })).getAllByRole("listitem").map((row) => row.querySelector("span")?.textContent);

/** The display a save answers with: the clock on `structure`. */
const savedAs = (structure: ClockStructure, presetKey: BlindPresetKey | null = null) =>
  liveDisplayDto({ clock: clockDto({ structure, structureHash: structureHash(structure), presetKey }) });

beforeEach(() => {
  resetServerTime();
  mockSignedOut();
  mockClockTabReads();
});

describe("StructureEditor", () => {
  it("saves an edited level with the structure the edit started from", async () => {
    const clock = clockDto();
    const edited = shortStructure();
    edited.levels[1] = { ...edited.levels[1], kind: "level", smallBlind: 300, bigBlind: 700 } as ClockStructure["levels"][number];
    const sent = recordClockChanges(() => savedAs(edited));
    showEditor(clock);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Save structure" })).toBeDisabled();
    await user.clear(box("Level 2 big blind"));
    await user.type(box("Level 2 big blind"), "700");
    await user.click(screen.getByRole("button", { name: "Save structure" }));

    expect(await screen.findByText("Blind structure saved")).toBeInTheDocument();
    expect(sent).toEqual([{ method: "PUT", path: "/api/tournaments/t1/clock", body: { structure: edited, presetKey: null, baseHash: clock.structureHash } }]);
    expect(screen.getByRole("button", { name: "Save structure" })).toBeDisabled();
  });

  it("puts a problem under its row and sends nothing", async () => {
    const sent = recordClockChanges(() => savedAs(shortStructure()));
    showEditor();
    const user = userEvent.setup();

    await user.clear(box("Level 1 big blind"));
    await user.type(box("Level 1 big blind"), "100");
    await user.click(screen.getByRole("button", { name: "Save structure" }));

    expect(await screen.findByText("The big blind must be at least the small blind")).toBeInTheDocument();
    expect(box("Level 1 big blind")).toHaveAttribute("aria-invalid", "true");
    expect(box("Level 1 big blind")).toHaveFocus();
    expect(sent).toEqual([]);
  });

  it("adds a level about a third up, and a break, numbering the rows as they go", async () => {
    showEditor();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add level" }));
    expect(box("Level 5 small blind")).toHaveValue("600");
    expect(box("Level 5 big blind")).toHaveValue("1200");
    expect(box("Level 5 big blind ante")).toHaveValue("1200");
    expect(box("Level 5 minutes")).toHaveValue("15");

    await user.click(screen.getByRole("button", { name: "More for Level 1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Insert a break below" }));
    expect(rowTitles()).toEqual(["Level 1", "Break 1", "Level 2", "Level 3", "Break 2", "Level 4", "Level 5"]);
    expect(box("Break 1 minutes")).toHaveValue("10");
  });

  it("is folded away once the clock has started, and opens and folds when asked (TDN2-TV-CARD-BURIED)", async () => {
    const { showClock } = showEditor();
    const toggle = screen.getByRole("button", { name: "Hide the blind structure" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "Levels and breaks" })).toBeVisible();

    // The clock starts: the editor folds, unless the TD is in the middle of an edit.
    showClock(runningClock(Date.now(), { levelIndex: 1 }));
    expect(screen.getByRole("button", { name: "Show and edit the blind structure" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("form", { name: "Blind structure", hidden: true })).not.toBeVisible();
    expect(screen.getByText(/^4 levels ·/)).toBeVisible();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show and edit the blind structure" }));
    await user.clear(box("Level 1 big blind"));
    await user.type(box("Level 1 big blind"), "500");
    // Unsaved: still open whatever the clock does.
    showClock(runningClock(Date.now(), { levelIndex: 2 }));
    expect(box("Level 1 big blind")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide the blind structure" }));
    expect(screen.getByRole("form", { name: "Blind structure", hidden: true })).not.toBeVisible();
  });

  it("moves and deletes rows, but keeps the level the clock is on", async () => {
    showEditor(runningClock(Date.now(), { levelIndex: 1 }), "l2");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show and edit the blind structure" }));

    await user.click(screen.getByRole("button", { name: "More for Level 2" }));
    expect(await screen.findByRole("menuitem", { name: "The clock is on this level" })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "More for Break 1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move up" }));
    expect(rowTitles()).toEqual(["Level 1", "Level 2", "Break 1", "Level 3", "Level 4"]);

    await user.click(screen.getByRole("button", { name: "More for Level 4" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(rowTitles()).toEqual(["Level 1", "Level 2", "Break 1", "Level 3"]);
    expect(screen.getByText("now")).toBeInTheDocument();
  });

  it("hides the ante boxes, and drops the antes, when the structure has none", async () => {
    const sent = recordClockChanges(({ body }) => savedAs((body as { structure: ClockStructure }).structure));
    showEditor();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "Antes" }), "No ante");
    expect(screen.queryByRole("textbox", { name: "Level 3 big blind ante" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save structure" }));
    expect(await screen.findByText("Blind structure saved")).toBeInTheDocument();
    const saved = (sent[0].body as { structure: ClockStructure }).structure;
    expect(saved.anteMode).toBe("none");
    expect(saved.levels.map((level) => (level.kind === "level" ? level.ante : null))).toEqual([0, 0, 0, null, 0]);
  });

  it("reloads the latest structure when someone else saved first", async () => {
    const theirs = shortStructure({ startingStack: 60_000 });
    recordClockChanges(() => apiError(409, "STRUCTURE_CHANGED", "Someone else changed the structure", { display: savedAs(theirs) }));
    showEditor();
    const user = userEvent.setup();

    await user.clear(box("Starting stack"));
    await user.type(box("Starting stack"), "90000");
    await user.click(screen.getByRole("button", { name: "Save structure" }));

    expect(await screen.findByText("Someone else edited the structure — reloaded")).toBeInTheDocument();
    expect(box("Starting stack")).toHaveValue("60000");
  });

  it("says when the structure changed on another device, and loads it when asked", async () => {
    const { showClock } = showEditor();
    const user = userEvent.setup();
    await user.clear(box("Level 1 minutes"));
    await user.type(box("Level 1 minutes"), "25");

    const theirs = shortStructure({ startingStack: 70_000 });
    showClock(clockDto({ structure: theirs, structureHash: structureHash(theirs) }));
    expect(screen.getByText("The structure was changed on another device.")).toBeInTheDocument();
    expect(box("Level 1 minutes")).toHaveValue("25");

    await user.click(screen.getByRole("button", { name: "Load the latest (drops your changes)" }));
    expect(box("Starting stack")).toHaveValue("70000");
    expect(box("Level 1 minutes")).toHaveValue("20");
    expect(screen.queryByText("The structure was changed on another device.")).not.toBeInTheDocument();
  });

  it("replaces the levels with a preset, saved with its key", async () => {
    const preset = presetStructure("central_stars_one_life_line");
    const sent = recordClockChanges(() => savedAs(preset, "central_stars_one_life_line"));
    showEditor();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Replace structure…" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace the structure" });
    await user.click(within(dialog).getByRole("button", { name: "Load: Central Stars · One Life Line" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rowTitles()).toHaveLength(27);

    await user.click(screen.getByRole("button", { name: "Save structure" }));
    expect(await screen.findByText("Blind structure saved")).toBeInTheDocument();
    expect(sent[0].body).toEqual({ structure: preset, presetKey: "central_stars_one_life_line", baseHash: clockDto().structureHash });
  });
});
