import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { AVATARS } from "@shared/domain/avatars";
import { installFakeXhr, type FakeXhr } from "@test/helpers/fake-xhr";
import { PlayerPhotoField, type PlayerPhotoFieldProps } from "./player-photo-field";

const PHOTO = "/uploads/player_avatar/2d3e4f50-6a7b-4c8d-9e0f-b1c2d3e4f5a6/512.webp";
const stored = (url: string) => ({ kind: "player_avatar", url, variants: {}, width: 512, height: 512, dominantColor: null });
const getUserMedia = () => vi.mocked(navigator.mediaDevices.getUserMedia);

let sent: FakeXhr[];
beforeEach(() => {
  sent = installFakeXhr();
});
afterEach(() => {
  vi.unstubAllGlobals();
  getUserMedia().mockClear();
});

/** The field in a form, as the sign-up and the staff sheet hold it: the value and whether it is uploading. */
function Harness({ initial = null as string | null, ...props }: Partial<PlayerPhotoFieldProps> & { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <PlayerPhotoField label="Photo" value={value} onChange={setValue} onUploadingChange={setUploading} {...props} />
      <p data-testid="value">{value ?? "none"}</p>
      <p data-testid="uploading">{String(uploading)}</p>
    </>
  );
}

function chooseFile() {
  const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(64)], "me.jpg", { type: "image/jpeg" })] } });
}

/** What the viewport of a 390 × 844 phone answers to media queries. */
function onPhone() {
  const width = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  const matchMedia = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    return { ...matchMedia(query), matches: (max ? 390 <= Number(max[1]) : true) && (min ? 390 >= Number(min[1]) : true) };
  });
  onTestFinished(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    vi.mocked(window.matchMedia).mockRestore();
  });
}

describe("PlayerPhotoField", () => {
  it("leads with Take a selfie, then the upload and the avatars, all full width and at least 48 px tall", () => {
    onPhone();
    render(<Harness description="Shown on the standings." />);

    const group = screen.getByRole("group", { name: "Photo" });
    expect(group).toHaveAccessibleDescription("Shown on the standings.");
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Take a selfie", "Upload a photo instead", "Pick an avatar"]);
    expect(buttons[0]).toHaveClass("h-14", "w-full", "bg-primary");
    for (const button of buttons.slice(1)) expect(button).toHaveClass("h-12", "w-full");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("frames and uploads a chosen photo, then offers Retake, Change, an avatar or Remove, keeping focus on the field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const upload = screen.getByRole("button", { name: "Upload a photo instead" });
    upload.focus();

    chooseFile();
    expect(await screen.findByRole("dialog", { name: "Position your picture" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(screen.getByTestId("uploading")).toHaveTextContent("true");
    expect(screen.getByRole("progressbar", { name: "Uploading the picture" })).toBeInTheDocument();
    act(() => sent[0].respond(201, stored(PHOTO)));

    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(PHOTO));
    expect(screen.getByTestId("uploading")).toHaveTextContent("false");
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", PHOTO);
    const buttons = within(screen.getByRole("group", { name: "Photo" })).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Retake", "Change", "Pick an avatar", "Remove"]);
    // The same button the person used, its words changed: focus was never lost (MA-P3REV1-01).
    expect(screen.getByRole("button", { name: "Change" })).toBe(upload);
    expect(upload).toHaveFocus();
  });

  it("uses a picked avatar at once, uploading nothing, and marks it as the one chosen", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Pick an avatar" }));
    const picker = await screen.findByRole("dialog", { name: "Pick an avatar" });
    expect(within(picker).getAllByRole("button", { pressed: false }).map((button) => button.textContent)).toEqual(AVATARS.map(({ label }) => label));
    await user.click(within(picker).getByRole("button", { name: "Bluffer in sunglasses" }));

    expect(screen.queryByRole("dialog", { name: "Pick an avatar" })).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent("/avatars/bluffer.svg");
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", "/avatars/bluffer.svg");
    expect(sent).toHaveLength(0);
    const buttons = within(screen.getByRole("group", { name: "Photo" })).getAllByRole("button");
    // An avatar is not a photo: the camera and the upload say so, not "Retake" and "Change".
    expect(buttons.map((button) => button.textContent)).toEqual(["Take a selfie", "Upload a photo", "Change avatar", "Remove"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Change avatar" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    expect(within(await screen.findByRole("dialog", { name: "Pick an avatar" })).getByRole("button", { pressed: true })).toHaveTextContent(
      "Bluffer in sunglasses",
    );
  });

  it("drops an upload still running when an avatar is picked instead", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    chooseFile();
    await user.click(await screen.findByRole("button", { name: "Use this" }));
    await waitFor(() => expect(sent).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Pick an avatar" }));
    await user.click(await screen.findByRole("button", { name: "Rocket" }));
    act(() => sent[0].respond(201, stored(PHOTO)));

    expect(sent[0].aborted).toBe(true);
    expect(screen.getByTestId("value")).toHaveTextContent("/avatars/rocket.svg");
    expect(screen.getByTestId("uploading")).toHaveTextContent("false");
  });

  it("removes the picture by sending null, focus staying on what picks a new one", async () => {
    const user = userEvent.setup();
    render(<Harness initial={PHOTO} />);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByTestId("value")).toHaveTextContent("none");
    expect(screen.getByRole("button", { name: "Upload a photo instead" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("opens the front camera for a selfie, and the back one for staff photographing a player", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Take a selfie" }));
    expect(await screen.findByRole("dialog", { name: "Take a selfie" })).toBeInTheDocument();
    expect(getUserMedia()).toHaveBeenLastCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: "user" }) }));
    unmount();

    render(<Harness taker="staff" />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Take a photo", "Upload a photo", "Pick an avatar"]);
    await user.click(screen.getByRole("button", { name: "Take a photo" }));
    expect(await screen.findByRole("dialog", { name: "Take a photo" })).toBeInTheDocument();
    expect(getUserMedia()).toHaveBeenLastCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: "environment" }) }));
    expect(document.querySelector('input[type="file"][capture]')).toHaveAttribute("capture", "environment");
  });

  it("keeps every choice shut while disabled (a sign-up already saved with its picture)", () => {
    render(<Harness initial="/avatars/star.svg" disabled />);

    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", "/avatars/star.svg");
  });

  it("says why a picture could not be used", async () => {
    render(<Harness />);
    chooseFile();
    await userEvent.click(await screen.findByRole("button", { name: "Use this" }));
    await waitFor(() => expect(sent).toHaveLength(1));

    act(() => sent[0].respond(413, { error: "That picture is too big", code: "FILE_TOO_LARGE" }));

    expect(await screen.findByTestId("image-upload-error")).toHaveTextContent("That picture is too big");
    expect(screen.getByTestId("value")).toHaveTextContent("none");
  });
});

describe("AvatarPickerDialog on a phone", () => {
  it("fills the screen with a 4 × 4 grid of captioned avatars, each a big target", async () => {
    onPhone();
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Pick an avatar" }));
    const picker = await screen.findByRole("dialog", { name: "Pick an avatar" });

    expect(picker).toHaveClass("h-dvh", "max-w-none", "sm:max-w-lg");
    expect(within(picker).getByRole("list", { name: "Avatars" })).toHaveClass("grid-cols-4");
    const avatars = within(picker).getAllByRole("button", { name: (name) => AVATARS.some(({ label }) => label === name) });
    expect(avatars).toHaveLength(16);
    for (const avatar of avatars) {
      expect(avatar).toHaveClass("min-h-[96px]", "w-full");
      const image = avatar.querySelector("img") as HTMLImageElement;
      expect(image).toHaveAttribute("alt", "");
      expect(image).toHaveClass("max-w-[72px]");
    }
  });
});
