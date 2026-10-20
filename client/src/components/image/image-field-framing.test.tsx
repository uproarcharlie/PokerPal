/**
 * ImageField with a cropper that reports a frame (jsdom lays nothing out, so the real one never does):
 * what is sent once a picture is framed.
 */
import { useEffect, type HTMLAttributes } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeXhr, type FakeXhr } from "@test/helpers/fake-xhr";
import { ImageField } from "./image-field";

vi.mock("react-easy-crop", () => ({
  // As react-easy-crop draws its frame once the picture is measured: a box given `cropperProps`.
  default: function FakeCropper({
    onCropComplete,
    cropperProps,
  }: {
    onCropComplete: (percentages: object, pixels: object) => void;
    cropperProps?: HTMLAttributes<HTMLDivElement>;
  }) {
    useEffect(() => onCropComplete({ x: 25, y: 0, width: 50, height: 100 }, { x: 0, y: 0, width: 0, height: 0 }), [onCropComplete]);
    return <div data-testid="cropper" {...cropperProps} />;
  },
}));

const AVATAR = "/uploads/player_avatar/2d3e4f50-6a7b-4c8d-9e0f-b1c2d3e4f5a6/512.webp";

let sent: FakeXhr[];
beforeEach(() => {
  sent = installFakeXhr();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function choosePhoto() {
  const input = document.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(64)], "me.jpg", { type: "image/jpeg" })] } });
}

describe("ImageField framing (P3REV4-PERF-05)", () => {
  it("sends only the framed part of a player photo, at the size the server keeps, with no frame left to apply", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2048, height: 1024, close: () => {} }) as unknown as ImageBitmap),
    );
    const drawn: Array<{ width: number; height: number }> = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function toBlob(this: HTMLCanvasElement, callback: BlobCallback, type) {
      drawn.push({ width: this.width, height: this.height });
      callback(new Blob([new Uint8Array(30_000)], { type }));
    });
    render(<ImageField kind="player_avatar" value={null} onChange={() => {}} label="Photo" />);

    choosePhoto();
    await screen.findByRole("dialog", { name: "Position your picture" });
    await userEvent.click(screen.getByRole("button", { name: "Use this" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(drawn).toEqual([{ width: 512, height: 512 }]);
    expect(sent[0].field("crop")).toBeNull();
    expect((sent[0].field("image") as Blob).size).toBe(30_000);
    act(() => sent[0].respond(201, { kind: "player_avatar", url: AVATAR, variants: {}, width: 512, height: 512, dominantColor: null }));
  });

  it("previews the framed part while it uploads, not the middle of the whole picture (P3REV3-IMG-02)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2048, height: 1024, close: () => {} }) as unknown as ImageBitmap),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback, type) => {
      callback(new Blob([new Uint8Array(30_000)], { type }));
    });
    const urls = new Map<string, Blob | MediaSource>();
    const create = URL.createObjectURL.bind(URL);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const url = create(blob);
      urls.set(url, blob);
      return url;
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    render(<ImageField kind="player_avatar" value={null} onChange={() => {}} label="Photo" />);

    choosePhoto();
    await screen.findByRole("dialog", { name: "Position your picture" });
    const whole = Array.from(urls.keys()).at(-1);
    await userEvent.click(screen.getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(sent).toHaveLength(1));

    const preview = screen.getByRole("img", { name: "Upload preview" }).getAttribute("src") ?? "";
    expect(preview).not.toBe(whole);
    // The URL drawn is the framed picture's, the one sent; the whole picture is much smaller here.
    expect((urls.get(preview) as Blob).size).toBe((sent[0].field("image") as Blob).size);
    expect((urls.get(whole ?? "") as Blob).size).not.toBe((sent[0].field("image") as Blob).size);
    expect(revoke).toHaveBeenCalledWith(whole);
    act(() => sent[0].respond(201, { kind: "player_avatar", url: AVATAR, variants: {}, width: 512, height: 512, dominantColor: null }));
  });

  it("sends the whole picture with its frame where the browser cannot redraw it", async () => {
    render(<ImageField kind="player_avatar" value={null} onChange={() => {}} label="Photo" />);

    choosePhoto();
    await screen.findByRole("dialog", { name: "Position your picture" });
    await userEvent.click(screen.getByRole("button", { name: "Use this" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(String(sent[0].field("crop")))).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
  });

  it("names the frame, a keyboard control, and says how to move the picture with the keys (MA-12)", async () => {
    render(<ImageField kind="player_avatar" value={null} onChange={() => {}} label="Photo" />);

    choosePhoto();
    await screen.findByRole("dialog", { name: "Position your picture" });

    const frame = screen.getByRole("group", { name: "Picture frame" });
    expect(frame).toHaveAccessibleDescription(expect.stringContaining("arrow keys"));
  });

  it("reads its instructions out as the framing dialog opens, describing the dialog itself (P3REV-IMG-CROP-DESC)", async () => {
    const warn = vi.spyOn(console, "warn");
    render(<ImageField kind="player_avatar" value={null} onChange={() => {}} label="Photo" />);

    choosePhoto();
    const dialog = await screen.findByRole("dialog", { name: "Position your picture" });

    expect(dialog).toHaveAccessibleDescription(expect.stringContaining("arrow keys"));
    // Radix warns when the dialog's description points at no element.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("Missing `Description`"));
  });

  it("keeps the framing dialog within the screen, scrolling inside it, so Use this can always be reached (MA-10)", async () => {
    render(<ImageField kind="player_avatar" value={null} onChange={() => {}} label="Photo" />);

    choosePhoto();
    const dialog = await screen.findByRole("dialog", { name: "Position your picture" });

    expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]", "overflow-y-auto");
  });
});
