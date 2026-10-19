import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError } from "@test/helpers/web";
import { ImageUpload } from "./image-upload";

const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "photo.jpg", { type: "image/jpeg" });

describe("ImageUpload", () => {
  it("uploads to POST /api/images/:kind and hands back the stored URL", async () => {
    // jsdom's File cannot be streamed through Node's fetch, so the body itself is not read back here.
    let contentType: string | null = null;
    server.use(
      http.post("/api/images/club_logo", ({ request }) => {
        contentType = request.headers.get("content-type");
        return HttpResponse.json(
          { kind: "club_logo", url: "/uploads/club_logo/abc/1024.webp", variants: {}, width: 1024, height: 512, dominantColor: null },
          { status: 201 },
        );
      }),
    );
    const onImageUpload = vi.fn();
    const user = userEvent.setup();
    render(<ImageUpload kind="club_logo" onImageUpload={onImageUpload} />);

    await user.upload(screen.getByLabelText("Choose an image"), photo());

    await waitFor(() => expect(onImageUpload).toHaveBeenCalledWith("/uploads/club_logo/abc/1024.webp"));
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    [413, "FILE_TOO_LARGE", "That image is too big. The limit is 5 MB."],
    [415, "INVALID_IMAGE", "That file is not an image we can read."],
    [429, "RATE_LIMITED", "Too many uploads. Try again in a few minutes."],
  ] as const)("shows the server's sentence for a %i, with no alert()", async (status, code, sentence) => {
    server.use(http.post("/api/images/player_avatar", () => apiError(status, code, sentence)));
    const alert = vi.spyOn(window, "alert");
    const onImageUpload = vi.fn();
    const user = userEvent.setup();
    render(<ImageUpload kind="player_avatar" onImageUpload={onImageUpload} />);

    await user.upload(screen.getByLabelText("Choose an image"), photo());

    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
    expect(onImageUpload).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("refuses HEIC photos before uploading, saying what to do instead", async () => {
    const onImageUpload = vi.fn();
    const user = userEvent.setup({ applyAccept: false });
    render(<ImageUpload kind="player_avatar" onImageUpload={onImageUpload} />);

    await user.upload(screen.getByLabelText("Choose an image"), new File(["x"], "IMG_1.HEIC", { type: "image/heic" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("HEIC photos can't be uploaded yet");
    expect(onImageUpload).not.toHaveBeenCalled();
  });
});
