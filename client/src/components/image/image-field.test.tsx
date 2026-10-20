import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeXhr, type FakeXhr } from "@test/helpers/fake-xhr";
import { HEIC_MESSAGE, type ImageKind } from "@shared/domain/images";
import { Button } from "@/components/ui/button";
import { SEND_TIMEOUT_MS, TIMEOUT_ERROR_MESSAGE } from "@/lib/api/http";
import { ImageField } from "./image-field";

const LOGO = "/uploads/club_logo/0b9f6a6e-1d2c-4c39-9a4e-2f6f5e0c1a11/512.webp";
const NEW_LOGO = "/uploads/club_logo/1c2e3f40-5a6b-4c7d-8e9f-a0b1c2d3e4f5/512.webp";
const AVATAR = "/uploads/player_avatar/2d3e4f50-6a7b-4c8d-9e0f-b1c2d3e4f5a6/512.webp";

const stored = (kind: ImageKind, url: string) => ({ kind, url, variants: {}, width: 512, height: 512, dominantColor: null });
const picture = (name = "logo.png", type = "image/png") => new File([new Uint8Array(64)], name, { type });

let sent: FakeXhr[];
beforeEach(() => {
  sent = installFakeXhr();
});
afterEach(() => vi.unstubAllGlobals());

/** A form around the field, as a feature page uses it: Save waits for the upload. */
function ClubForm({ kind = "club_logo" as ImageKind, initial = LOGO as string | null, onSave = vi.fn() }) {
  const [imageUrl, setImageUrl] = useState<string | null>(initial);
  const [uploading, setUploading] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(imageUrl);
      }}
    >
      <ImageField kind={kind} value={imageUrl} onChange={setImageUrl} onUploadingChange={setUploading} label="Logo" />
      <p data-testid="value">{imageUrl ?? "none"}</p>
      <Button type="submit" disabled={uploading}>
        Save
      </Button>
    </form>
  );
}

function choose(file: File) {
  const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImageField", () => {
  it("shows the image the form holds now, following it when it changes", () => {
    const { rerender } = render(<ImageField kind="club_logo" value={LOGO} onChange={() => {}} />);
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", LOGO);

    rerender(<ImageField kind="club_logo" value={NEW_LOGO} onChange={() => {}} />);
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", NEW_LOGO);

    rerender(<ImageField kind="club_logo" value="" onChange={() => {}} />);
    expect(screen.queryByRole("img", { name: "Upload preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("uploads a logo as it is (logos are never cropped), keeping Save disabled until it is stored", async () => {
    const onSave = vi.fn();
    render(<ClubForm onSave={onSave} />);

    choose(picture());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe("/api/images/club_logo");
    expect(sent[0].field("crop")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    act(() => sent[0].progress(30, 100));
    expect(screen.getByRole("progressbar", { name: "Uploading the picture" })).toHaveAttribute("aria-valuenow", "30");

    act(() => sent[0].respond(201, stored("club_logo", NEW_LOGO)));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.getByTestId("value")).toHaveTextContent(NEW_LOGO);
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", NEW_LOGO);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(NEW_LOGO);
  });

  it("frames a player photo before uploading it", async () => {
    render(<ClubForm kind="player_avatar" initial={null} />);

    choose(picture("me.jpg", "image/jpeg"));

    const crop = await screen.findByRole("dialog", { name: "Position your picture" });
    expect(sent).toHaveLength(0);
    // The page behind the modal is hidden from the accessibility tree while it is open.
    expect(screen.getByRole("button", { name: "Save", hidden: true })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Use this" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(crop).not.toBeInTheDocument();
    expect(sent[0].url).toBe("/api/images/player_avatar");
    act(() => sent[0].respond(201, stored("player_avatar", AVATAR)));

    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(AVATAR));
  });

  it("puts everything back when the framing is cancelled", async () => {
    render(<ClubForm kind="player_avatar" initial={AVATAR} />);

    choose(picture("me.jpg", "image/jpeg"));
    await screen.findByRole("dialog", { name: "Position your picture" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(sent).toHaveLength(0);
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", AVATAR);
  });

  it("shows the server's reason under the field and keeps the stored image", async () => {
    render(<ClubForm />);

    choose(picture());
    await waitFor(() => expect(sent).toHaveLength(1));
    act(() => sent[0].respond(415, { error: "That file is not a picture we can read.", code: "INVALID_IMAGE" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That file is not a picture we can read.");
    expect(screen.getByTestId("value")).toHaveTextContent(LOGO);
    expect(screen.getByRole("img", { name: "Upload preview" })).toHaveAttribute("src", LOGO);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("cancels an upload still running when another picture is chosen", async () => {
    render(<ClubForm />);

    choose(picture("first.png"));
    await waitFor(() => expect(sent).toHaveLength(1));
    choose(picture("second.png"));
    await waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[0].aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    act(() => sent[1].respond(201, stored("club_logo", NEW_LOGO)));

    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(NEW_LOGO));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes the picture by sending null, with the buttons always on screen (no hover needed)", async () => {
    render(<ClubForm kind="player_avatar" initial={AVATAR} />);

    expect(screen.getByRole("button", { name: "Retake" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByTestId("value")).toHaveTextContent("none");
    expect(screen.getByRole("button", { name: "Take Photo" })).toBeInTheDocument();
  });

  it("keeps focus in the field when Remove takes itself away, on what picks a new picture (P3REV-MA-FOCUS-AFTER-REMOVE)", async () => {
    render(<ClubForm kind="club_logo" initial={LOGO} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toHaveFocus();
  });

  it("lets go of every preview it made when it goes away while a picture is still being prepared (P3REV-IMG-OBJURL-UNMOUNT)", async () => {
    let decoded: (bitmap: ImageBitmap) => void = () => {};
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => (decoded = resolve)));
    const created = vi.mocked(URL.createObjectURL);
    const revoked = vi.mocked(URL.revokeObjectURL);
    const [createdBefore, revokedBefore] = [created.mock.calls.length, revoked.mock.calls.length];
    const { unmount } = render(<ImageField kind="player_avatar" value={null} onChange={() => {}} />);

    choose(picture("me.jpg", "image/jpeg"));
    unmount();
    await act(async () => decoded({ width: 800, height: 800, close: () => {} } as ImageBitmap));

    const made = created.mock.results.slice(createdBefore).map((result) => result.value as string);
    const freed = revoked.mock.calls.slice(revokedBefore).map(([url]) => url);
    expect(made.filter((url) => !freed.includes(url))).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("refuses an iPhone HEIC photo up front where the browser cannot convert it", async () => {
    render(<ClubForm kind="player_avatar" initial={null} />);

    choose(picture("IMG_0001.HEIC", "image/heic"));

    expect(await screen.findByRole("alert")).toHaveTextContent(HEIC_MESSAGE);
    expect(sent).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("opens the live camera from Take Photo, for player photos only by default", async () => {
    const { unmount } = render(<ClubForm kind="player_avatar" initial={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Take Photo" }));
    expect(await screen.findByRole("dialog", { name: "Take a photo" })).toBeInTheDocument();
    unmount();

    render(<ClubForm kind="club_logo" />);
    expect(screen.queryByRole("button", { name: /Take Photo|Retake/ })).not.toBeInTheDocument();
  });

  it("tells the form the upload is over when the field goes away mid-upload", async () => {
    const onUploadingChange = vi.fn();
    const { unmount } = render(<ImageField kind="club_logo" value={null} onChange={() => {}} onUploadingChange={onUploadingChange} />);

    choose(picture());
    await waitFor(() => expect(sent).toHaveLength(1));
    unmount();

    expect(sent[0].aborted).toBe(true);
    expect(onUploadingChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps focus on the photo field after a picture is framed and uploaded (MA-P3REV1-01)", async () => {
    render(<ClubForm kind="player_avatar" initial={null} />);
    const upload = screen.getByRole("button", { name: "Upload" });
    upload.focus();

    choose(picture("me.jpg", "image/jpeg"));
    // Waiting, but never disabled: disabling the focused button threw focus to the top of the page.
    expect(upload).not.toBeDisabled();
    await screen.findByRole("dialog", { name: "Position your picture" });
    await userEvent.click(screen.getByRole("button", { name: "Use this" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Change" })).toHaveFocus());
    act(() => sent[0].respond(201, stored("player_avatar", AVATAR)));
    await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(AVATAR));
    expect(screen.getByRole("button", { name: "Change" })).toHaveFocus();
  });

  it("returns focus to the field when the framing is cancelled or the camera is closed", async () => {
    render(<ClubForm kind="player_avatar" initial={null} />);
    screen.getByRole("button", { name: "Upload" }).focus();
    choose(picture("me.jpg", "image/jpeg"));
    await screen.findByRole("dialog", { name: "Position your picture" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload" })).toHaveFocus());

    await userEvent.click(screen.getByRole("button", { name: "Take Photo" }));
    await screen.findByRole("dialog", { name: "Take a photo" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Take Photo" })).toHaveFocus());
  });

  it("marks the pick buttons as waiting while a picture is prepared, and frees them after", async () => {
    render(<ClubForm kind="club_logo" initial={null} />);
    const upload = screen.getByRole("button", { name: "Upload" });
    choose(picture());

    expect(upload).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Change" })).not.toHaveAttribute("aria-disabled");
  });

  it("waits as every busy button does: a press while the picture is prepared opens neither the camera nor the files (P3REV6-CQ-06)", async () => {
    let decoded: (bitmap: ImageBitmap) => void = () => {};
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => (decoded = resolve)));
    const openFiles = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<ClubForm kind="player_avatar" initial={null} />);
    choose(picture("me.jpg", "image/jpeg"));

    const takePhoto = screen.getByRole("button", { name: "Take Photo" });
    const upload = screen.getByRole("button", { name: "Upload" });
    for (const button of [takePhoto, upload]) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveClass("cursor-wait");
      fireEvent.click(button);
    }

    expect(openFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Take a photo" })).not.toBeInTheDocument();
    openFiles.mockRestore();
    await act(async () => decoded({ width: 800, height: 800, close: () => {} } as ImageBitmap));
    expect(await screen.findByRole("dialog", { name: "Position your picture" })).toBeInTheDocument();
  });

  it("opens the framing step at its full size, so the cropper measures the box it is drawn in (IMG-REV3-01)", async () => {
    render(<ClubForm kind="player_avatar" initial={null} />);
    choose(picture("me.jpg", "image/jpeg"));

    const framing = await screen.findByTestId("crop-dialog");
    // The other dialogs open from 95% and slightly lower; this one only fades in (the e2e spec measures it).
    expect(framing.style.getPropertyValue("--tw-enter-scale")).toBe("1");
    expect(framing.style.getPropertyValue("--tw-enter-translate-y")).toBe("-50%");
  });

  it("gives up on an upload that stopped moving, says why and frees the form's Save (P3REV5-CQ-15)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ClubForm />);
      choose(picture());
      await waitFor(() => expect(sent).toHaveLength(1));
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

      await act(() => vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 10));

      expect(await screen.findByRole("alert")).toHaveTextContent(TIMEOUT_ERROR_MESSAGE);
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      expect(screen.getByTestId("value")).toHaveTextContent(LOGO);
    } finally {
      vi.useRealTimers();
    }
  });
});

