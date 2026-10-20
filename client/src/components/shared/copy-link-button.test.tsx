import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { CopyLinkButton, useCopyLink } from "./copy-link-button";

const LINK = "https://lovepoker.club/register/t1";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
});

describe("CopyLinkButton", () => {
  it("says Copied once the link is on the clipboard", async () => {
    mockSignedOut();
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    renderWithApp(<CopyLinkButton value={LINK} label="Copy sign-up link" />);

    await userEvent.click(screen.getByRole("button", { name: "Copy sign-up link" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it("never claims a copy that failed, and shows the link to copy by hand", async () => {
    mockSignedOut();
    stubClipboard(async () => {
      throw new DOMException("Denied", "NotAllowedError");
    });
    // jsdom has no execCommand; a browser that refuses answers false.
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    renderWithApp(<CopyLinkButton value={LINK} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument();
    expect(screen.getByText(`Select it and copy it yourself: ${LINK}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument());
  });
});

/** A menu item's copy, as the tournament list's row menu and the desk's player link use it. */
function CopyFromMenu() {
  const copy = useCopyLink();
  return (
    <button type="button" onClick={() => void copy(LINK, "Registration")}>
      Copy registration link
    </button>
  );
}

describe("useCopyLink (P3REV3-CQ-08)", () => {
  it("says what was copied, or gives the link to copy by hand, in the button's own words", async () => {
    mockSignedOut();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    stubClipboard(writeText);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    renderWithApp(<CopyFromMenu />);

    await userEvent.click(screen.getByRole("button", { name: "Copy registration link" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(screen.getByText("Registration link copied to the clipboard")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Copy registration link" }));
    expect(await screen.findByText("Couldn't copy the link")).toBeInTheDocument();
    expect(screen.getByText(`Select it and copy it yourself: ${LINK}`)).toBeInTheDocument();
  });
});
