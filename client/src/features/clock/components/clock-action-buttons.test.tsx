import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { undoDto } from "@test/helpers/clock-dto";
import { ClockActionButtons, undoLabel } from "./clock-action-buttons";

// The staff page's buttons must not bring the TV screen, its QR code library and overlays with them (R2-CQ-03).
vi.mock("./public/clock-screen", () => {
  throw new Error("ClockActionButtons loaded the TV screen");
});
vi.mock("qrcode.react", () => {
  throw new Error("ClockActionButtons loaded the QR code library");
});

function showButtons(props: Partial<Parameters<typeof ClockActionButtons>[0]> = {}) {
  const onAct = vi.fn();
  render(<ClockActionButtons status="running" busy={new Set()} onAct={onAct} alsoStartTournament={false} undo={null} layout="bar" {...props} />);
  return onAct;
}

describe("ClockActionButtons", () => {
  it("words Undo by the change it takes back, or puts back once undone (R2-CQ-01)", () => {
    expect(undoLabel(null)).toBe("Undo");
    expect(undoLabel(undoDto())).toBe("Undo: Moved to Level 2 (300/600)");
    expect(undoLabel(undoDto({ redo: true }))).toBe("Redo: Moved to Level 2 (300/600)");
  });

  it("sends Undo when there is something to undo", async () => {
    const onAct = showButtons({ undo: undoDto() });
    await userEvent.click(screen.getByRole("button", { name: "Undo: Moved to Level 2 (300/600)" }));
    expect(onAct).toHaveBeenCalledWith({ action: "undo" });
  });

  it("greys Undo out with nothing to undo", () => {
    showButtons();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("greys every control out on a finished clock, Undo included", () => {
    showButtons({ status: "finished", undo: undoDto() });
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
