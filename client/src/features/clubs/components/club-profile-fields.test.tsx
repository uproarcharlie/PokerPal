/** The club form when the rich-text editor's script will not load (P3REV4-PERF-B). */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { CreateClubDialog } from "./create-club-dialog";

const editor = vi.hoisted(() => ({ available: false }));

vi.mock("./rich-text-editor", () => ({
  RichTextEditor: ({ label }: { label: string }) => {
    // As a lazy component whose script did not arrive: it throws where it is drawn.
    if (!editor.available) throw new TypeError("Failed to fetch dynamically imported module: /assets/rich-text-editor-abc.js");
    return <div role="textbox" aria-label={label} />;
  },
}));

beforeEach(() => {
  editor.available = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
});
afterEach(() => vi.restoreAllMocks());

describe("ClubProfileFields when the editor will not load", () => {
  it("loses only the Description box, keeps what was typed, and loads the editor on Try again", async () => {
    const user = userEvent.setup();
    renderWithApp(<CreateClubDialog open onOpenChange={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The editor could not be loaded");
    await user.type(screen.getByTestId("club-name"), "Central Stars");

    editor.available = true;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("textbox", { name: "Description" })).toBeInTheDocument();
    expect(screen.getByTestId("club-name")).toHaveValue("Central Stars");
  });
});
